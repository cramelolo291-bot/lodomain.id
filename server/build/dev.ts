// A long-lived dev server for a project, and a proxy in front of it.
//
// The build runner produces a `dist/` you can look at once. This keeps a
// process alive so the preview updates as the agent edits files — which is the
// difference between "here is a folder" and "here is your app, running".
//
// The same isolation rules as the build runner apply, and the same caveat: this
// is not a security boundary. The dev server is started as the server's user on
// the server's machine. What is enforced here is containment, not trust:
//  · bound to loopback only, and never reachable from outside
//  · the process group is killed on restart and on shutdown
//  · the environment is rebuilt from an allowlist, so no Lolo secret is exposed
//    to a dev server that is, by design, reachable over HTTP

import { spawn, type ChildProcess } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceFor } from "./runner";

export type DevServer = {
  projectId: string;
  pid: number;
  port: number;
  startedAt: number;
  /** Rolling tail of what the dev server printed, for the terminal pane. */
  log: string[];
  ready: boolean;
};

const servers = new Map<string, DevServer>();

/** Keep the log bounded; a dev server that chats all afternoon is not news. */
const MAX_LOG_LINES = 400;
const READY_TIMEOUT_MS = 30_000;
/** Hard ceiling, so a bad port guess cannot become an open relay. */
const MAX_PORT = 65_535;

const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/i,
  /\blocal:\s*(\d{2,5})\b/i,
  /:(\d{2,5})\b/,
];

function parsePort(text: string): number | null {
  for (const pattern of PORT_PATTERNS) {
    const m = text.match(pattern);
    const n = m?.[1] ? Number.parseInt(m[1], 10) : NaN;
    if (Number.isInteger(n) && n > 1024 && n <= MAX_PORT) return n;
  }
  return null;
}

export function devServer(projectId: string): DevServer | undefined {
  return servers.get(projectId);
}

export function isAlive(state: DevServer): boolean {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Rewrites the project's files into a fresh workspace. */
async function materialise(projectId: string, files: Record<string, string>) {
  // Reuse the runner's path rules by writing through the same validator.
  const { validatePaths } = await import("./runner");
  const unsafe = validatePaths(files);
  if (unsafe) throw new Error(unsafe);

  const root = workspaceFor(projectId);
  await rm(root, { recursive: true, force: true }).catch(() => {});
  return writeFiles(root, files);
}

/**
 * Writes the project's files into an existing workspace, touching only what
 * changed.
 *
 * This is the path a running dev server cares about: its file watcher sees the
 * writes and hot-reloads. Wiping the directory instead would delete
 * `node_modules` under a live process and leave it serving nothing.
 */
async function writeFiles(root: string, files: Record<string, string>) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname, resolve, sep, normalize } = await import("node:path");
  const { readFile, unlink } = await import("node:fs/promises");

  // node_modules is the process's, not the project's. Never write, and never
  // let a file path reach inside it.
  const guarded = (candidate: string): string | null => {
    const normalised = normalize(candidate).replace(/\\/g, "/");
    if (normalised.startsWith("/") || normalised.split("/").includes("..")) return null;
    if (normalised.split("/").includes("node_modules")) return null;
    const target = resolve(root, normalised);
    if (target !== root && !target.startsWith(root + sep)) return null;
    return target;
  };

  for (const [path, content] of Object.entries(files)) {
    const target = guarded(path);
    if (target === null) continue;
    await mkdir(dirname(target), { recursive: true });
    const current = await readFile(target, "utf8").catch(() => null);
    if (current === (content ?? "")) continue;
    await writeFile(target, content ?? "", "utf8");
  }

  // A file the agent deleted should disappear here too, or the dev server keeps
  // serving a stale import and the error never goes away.
  const wanted = new Set(
    Object.keys(files)
      .map((p) => normalize(p).replace(/\\/g, "/"))
      .filter((p) => !p.split("/").includes("node_modules")),
  );
  const { glob } = await import("node:fs/promises");
  for await (const entry of glob("**/*", { cwd: root, withFileTypes: true })) {
    if (entry.isDirectory() || entry.name.startsWith(".")) continue;
    const rel = entry.parentPath
      ? `${entry.parentPath.replace(`${root}/`, "")}/${entry.name}`
      : entry.name;
    const normalised = rel.replace(/\\/g, "/");
    if (normalised.includes("node_modules")) continue;
    if (wanted.has(normalised)) continue;
    await unlink(join(root, normalised)).catch(() => {});
  }

  return root;
}

/**
 * Pushes the current project files into a workspace that is already serving.
 *
 * Returns how many files changed, so a caller can tell a real edit from a no-op
 * and avoid waking the watcher for nothing.
 */
export async function syncDev(
  projectId: string,
  files: Record<string, string>,
): Promise<{ synced: boolean; changed: number }> {
  const state = servers.get(projectId);
  if (!state || !isAlive(state)) return { synced: false, changed: 0 };

  const { validatePaths } = await import("./runner");
  const unsafe = validatePaths(files);
  if (unsafe) return { synced: false, changed: 0 };

  const root = workspaceFor(projectId);
  if (!existsSync(root)) return { synced: false, changed: 0 };

  const { readFile } = await import("node:fs/promises");
  let changed = 0;
  for (const [path, content] of Object.entries(files)) {
    if (path.split("/").includes("node_modules")) continue;
    const current = await readFile(join(root, path), "utf8").catch(() => null);
    if (current !== (content ?? "")) changed += 1;
  }

  if (changed === 0) return { synced: true, changed: 0 };

  try {
    await writeFiles(root, files);
  } catch {
    return { synced: false, changed };
  }
  return { synced: true, changed };
}

export type StartResult =
  | { ok: true; port: number; reused: boolean }
  | { ok: false; reason: string };

export async function startDev(
  projectId: string,
  files: Record<string, string>,
  opts: { port?: number; force?: boolean } = {},
): Promise<StartResult> {
  // A project-controlled dev script is arbitrary code. Do not execute it as
  // the production server user; production requires a separately isolated worker.
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      reason: "Live dev servers are disabled in production until an isolated worker is configured.",
    };
  }

  const existing = servers.get(projectId);
  if (existing && isAlive(existing) && !opts.force) {
    return { ok: true, port: existing.port, reused: true };
  }
  if (existing) await stopDev(projectId);

  const pkgRaw = files["package.json"];
  if (!pkgRaw) {
    return { ok: false, reason: "No package.json — there is nothing to serve." };
  }

  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(pkgRaw) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return { ok: false, reason: "package.json is not valid JSON." };
  }

  // A project with a dev script gets it run. One without is not an error worth
  // guessing at — the message says exactly what to add.
  const script = scripts.dev ?? scripts.start;
  if (!script) {
    return {
      ok: false,
      reason:
        'No "dev" or "start" script in package.json. Add one — e.g. "dev": "vite --host 127.0.0.1" — and the preview will run live.',
    };
  }

  const port = opts.port ?? 0;
  let root: string;
  try {
    root = await materialise(projectId, files);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const state: DevServer = {
    projectId,
    pid: 0,
    port,
    startedAt: Date.now(),
    log: [],
    ready: false,
  };

  const note = (line: string) => {
    state.log.push(line);
    if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
    if (!state.port) {
      const found = parsePort(line);
      if (found) state.port = found;
    }
  };

  const child: ChildProcess = spawn("/bin/sh", ["-c", script], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: join(root, ".home"),
      TMPDIR: join(root, ".home"),
      CI: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      NODE_ENV: "development",
      // Force loopback. A dev server that binds 0.0.0.0 is now on the internet,
      // and nothing asked for that.
      HOST: "127.0.0.1",
      ...(port ? { PORT: String(port) } : {}),
    },
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (b: Buffer) => note(b.toString("utf8").replace(/\n$/, "")));
  child.stderr?.on("data", (b: Buffer) => note(b.toString("utf8").replace(/\n$/, "")));
  child.on("error", (e) => note(`failed to start: ${e.message}`));
  child.on("exit", (code) => {
    note(`exited with ${code ?? "signal"}`);
    state.ready = false;
  });

  state.pid = child.pid ?? 0;
  if (state.pid === 0) return { ok: false, reason: "Could not spawn the dev server." };
  servers.set(projectId, state);

  // Wait for the port to be announced. No port by the deadline is a failure,
  // not a silent hang — otherwise the preview would spin forever.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.port) {
      state.ready = true;
      return { ok: true, port: state.port, reused: false };
    }
    if (!isAlive(state)) {
      await stopDev(projectId);
      return { ok: false, reason: `The dev server exited. ${state.log.slice(-3).join(" ")}` };
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  await stopDev(projectId);
  return { ok: false, reason: "The dev server did not report a port within 30s." };
}

export async function stopDev(projectId: string): Promise<void> {
  const state = servers.get(projectId);
  if (!state) return;
  servers.delete(projectId);

  if (!state.pid) return;
  try {
    // Negative pid: the whole process group, so `npm run dev` and the bundler
    // it spawned both go.
    process.kill(-state.pid, "SIGTERM");
  } catch {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      return;
    }
  }

  // Give it a moment to close listeners, then insist.
  await new Promise((r) => setTimeout(r, 400));
  try {
    process.kill(-state.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/** Called on shutdown so no dev server outlives the process that started it. */
export async function stopAllDev(): Promise<number> {
  const ids = [...servers.keys()];
  for (const id of ids) await stopDev(id);
  return ids.length;
}

export type ProxyOutcome =
  | { ok: true; response: Response }
  | { ok: false; reason: string };

/**
 * Forwards a request to the running dev server.
 *
 * The upstream is always `127.0.0.1` on the port the dev server announced, so a
 * request cannot choose where it goes — the path is rewritten, nothing else.
 */
export async function proxyToDev(
  projectId: string,
  subPath: string,
  init: RequestInit & { search?: string } = {},
): Promise<ProxyOutcome> {
  const state = servers.get(projectId);
  if (!state || !state.port) {
    return { ok: false, reason: "The dev server is not running." };
  }
  if (!isAlive(state)) {
    await stopDev(projectId);
    return { ok: false, reason: "The dev server is not running." };
  }

  const path = subPath.replace(/^\/+/, "");
  const target = `http://127.0.0.1:${state.port}/${path}${init.search ?? ""}`;

  try {
    const response = await fetch(target, {
      method: init.method ?? "GET",
      headers: { accept: "text/html,*/*" },
      body: init.body,
      redirect: "manual",
      // Node's fetch needs this for a request body.
      ...(init.body ? { duplex: "half" } : {}),
    } as RequestInit);

    return { ok: true, response };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
