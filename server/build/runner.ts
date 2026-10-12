// Running what the agent wrote.
//
// Until this existed, the agent could write a `package.json` and nothing would
// ever install or build it — the project was a pile of text. This materialises
// the project's virtual files into a real temporary workspace and runs the real
// toolchain over it, so "build me an app" ends with an app that actually built.
//
// ── What this is not ──────────────────────────────────────────────────────
// This is NOT a security boundary. The child runs as the server's user, on the
// server's machine, and `npm install` executes whatever lifecycle scripts the
// agent's package.json declares. It is a *build runner*, hardened to the point
// where a mistake cannot reach Lolo's own secrets:
//
//   · the command is chosen from a fixed table, never from user input
//   · `shell: false` — no interpolation, so no `;` or `&&` reaches a shell
//   · the environment is rebuilt from an allowlist, so DATABASE_URL,
//     RESEND_API_KEY and every session hash are absent
//   · HOME points at the temp workspace, not the operator's home directory
//   · the whole process group is killed on timeout
//
// For code you do not control at all, run the workspace inside a container
// (llm-sandbox / gVisor) and point this at it. That is a deployment decision,
// not something this file can fake.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";

export type BuildTarget = "install" | "build" | "typecheck" | "test";

export type BuildResult = {
  ok: boolean;
  target: BuildTarget;
  /** Exit code, or null when the process was killed on timeout. */
  code: number | null;
  /** Combined stdout+stderr, truncated. */
  output: string;
  ms: number;
  /** True when the run was cut short by the timeout. */
  timedOut: boolean;
  /** What actually ran, for the log. Never a user-supplied string. */
  command: string;
  /** Set when the project is not something this runner can build. */
  skipped?: string;
};

// ── Limits ────────────────────────────────────────────────────────────────
const MAX_FILES = 400;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 20_000_000;
const MAX_OUTPUT_CHARS = 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const HARD_TIMEOUT_MS = 300_000;

/** Only one build at a time. They are CPU-bound and they touch the same disk. */
let running = false;

// ── Path safety ───────────────────────────────────────────────────────────

/**
 * Turns one virtual path into one real path inside `root`, or refuses.
 *
 * Three things have to be true at once: the path is relative, it does not climb
 * out with `..`, and after resolution it is still inside the root. Checking only
 * the first two is the classic mistake — `a/../../etc` passes a "no `..`" test
 * and a "starts with root" test applied to the un-normalised string.
 */
function safeJoin(root: string, virtualPath: string): string | null {
  if (!virtualPath || virtualPath.includes("\0")) return null;
  if (virtualPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(virtualPath)) return null;

  const normalised = normalize(virtualPath).replace(/\\/g, "/");
  if (normalised.startsWith("../") || normalised === "..") return null;

  const target = resolve(root, normalised);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/** True when any path escapes, so the whole build is refused rather than one file. */
export function validatePaths(files: Record<string, string>): string | null {
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) return `Project has ${entries.length} files, limit is ${MAX_FILES}.`;

  let total = 0;
  const root = resolve("/nonexistent-root");
  for (const [path, content] of entries) {
    if (safeJoin(root, path) === null) return `Unsafe path in project: ${path}`;
    total += Buffer.byteLength(content ?? "", "utf8");
  }
  if (total > MAX_TOTAL_BYTES) {
    return `Project is ${(total / 1e6).toFixed(1)}MB, limit is ${MAX_TOTAL_BYTES / 1e6}MB.`;
  }
  return null;
}

// ── Materialise ───────────────────────────────────────────────────────────

async function materialise(
  root: string,
  files: Record<string, string>,
): Promise<{ written: number; bytes: number }> {
  let written = 0;
  let bytes = 0;

  for (const [path, content] of Object.entries(files)) {
    const target = safeJoin(root, path);
    if (target === null) continue; // Already refused wholesale by validatePaths.

    const text = content ?? "";
    if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) continue;

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    written += 1;
    bytes += Buffer.byteLength(text, "utf8");
  }

  return { written, bytes };
}

// ── Toolchain ─────────────────────────────────────────────────────────────

type Step = { command: string; args: string[] };

function has(files: Record<string, string>, name: string): boolean {
  return Object.keys(files).some((p) => p === name || p.endsWith(`/${name}`));
}

function hasDir(files: Record<string, string>, name: string): boolean {
  return Object.keys(files).some((p) => p.split("/").includes(name));
}

/**
 * The fixed command table. A target maps to a list of steps; there is no path
 * through this function that runs a string the caller supplied.
 */
function stepsFor(
  target: BuildTarget,
  files: Record<string, string>,
): Step[] | { skip: string } {
  if (!has(files, "package.json")) {
    if (hasDir(files, "node_modules")) return { skip: "No package.json, but node_modules exists." };
    return { skip: "No package.json — nothing to install or build." };
  }

  // A package.json the agent wrote may not have any of these.
  const bun = has(files, "bun.lock") || has(files, "bun.lockb") || hasDir(files, ".bun");
  const pkg = has(files, "package-lock.json");
  const manager = bun ? "bun" : pkg ? "npm" : "npm";

  switch (target) {
    case "install":
      return [
        { command: manager, args: ["install", "--no-audit", "--no-fund"] },
      ];
    case "build":
      return [
        { command: manager, args: ["install", "--no-audit", "--no-fund"] },
        { command: manager, args: ["run", "build"] },
      ];
    case "typecheck":
      // `tsc` is resolved from node_modules by npm/bun, so install first.
      return [
        { command: manager, args: ["install", "--no-audit", "--no-fund"] },
        { command: "npx", args: ["--no-install", "tsc", "--noEmit"] },
      ];
    case "test":
      return [
        { command: manager, args: ["install", "--no-audit", "--no-fund"] },
        { command: manager, args: ["test"] },
      ];
  }
}

// ── Process ───────────────────────────────────────────────────────────────

/**
 * Runs one command with no shell and a rebuilt environment.
 *
 * `detached: true` puts the child in its own process group so a timeout can
 * kill the whole tree — `npm install` spawns children, and killing only the
 * parent leaves them running and holding the temp directory open.
 */
function run(
  step: Step,
  cwd: string,
  home: string,
  timeoutMs: number,
  onOutput?: (line: string) => void,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve_) => {
    // Only PATH and locale survive. Everything else in this process's
    // environment — the database URL, the mail key, session material — is
    // simply not inherited.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: home,
      TMPDIR: home,
      CI: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      NODE_ENV: "development",
      npm_config_fund: "false",
      npm_config_audit: "false",
    };

    const child = spawn(step.command, step.args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let truncated = false;
    // Lines are held back until a newline arrives, so a consumer never sees
    // half a line — a build log that reflows while you read it is worse than
    // one that arrives a beat late.
    let pending = "";
    const append = (chunk: Buffer) => {
      if (truncated) return;
      const text = chunk.toString("utf8");
      output += text;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(0, MAX_OUTPUT_CHARS) + "\n… output truncated …\n";
        truncated = true;
        pending = "";
        onOutput?.("… output truncated …");
        return;
      }
      if (!onOutput) return;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onOutput?.(line);
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Negative pid targets the process group created by `detached: true`.
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolve_({
        code: null,
        output: `${output}\n${e.message}`.trim(),
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending && onOutput) onOutput?.(pending);
      resolve_({ code, output, timedOut });
    });
  });
}

// ── Entry point ───────────────────────────────────────────────────────────

/** Where every project's workspace lives. One directory per project id. */
export function workspaceFor(projectId: string): string {
  return join(tmpdir(), "lolo-workspaces", projectId);
}

/** The built app, if the toolchain produced one. Checked in order. */
const OUTPUT_DIRS = ["dist", "build", "public", "out"] as const;

export function outputDirFor(projectId: string): string | null {
  for (const dir of OUTPUT_DIRS) {
    const candidate = join(workspaceFor(projectId), dir);
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export async function runBuild(
  projectId: string,
  files: Record<string, string>,
  target: BuildTarget,
  opts: { timeoutMs?: number; onOutput?: (line: string) => void } = {},
): Promise<BuildResult> {
  const started = Date.now();

  // The runner executes project-controlled lifecycle scripts on the server's
  // OS account. Until an isolated worker is configured, fail closed in
  // production rather than treating environment scrubbing as a sandbox.
  if (process.env.NODE_ENV === "production") {
    const reason = "Build execution is disabled in production until an isolated build worker is configured.";
    return {
      ok: false,
      target,
      code: null,
      output: reason,
      ms: 0,
      timedOut: false,
      command: "",
      skipped: reason,
    };
  }

  const unsafe = validatePaths(files);
  if (unsafe) {
    return {
      ok: false,
      target,
      code: null,
      output: unsafe,
      ms: 0,
      timedOut: false,
      command: "",
      skipped: unsafe,
    };
  }

  // The plan is computed before anything touches the disk, so a project with
  // nothing to build never leaves an empty workspace behind.
  const planned = stepsFor(target, files);
  if ("skip" in planned) {
    return {
      ok: true,
      target,
      code: 0,
      output: planned.skip,
      ms: Date.now() - started,
      timedOut: false,
      command: "",
      skipped: planned.skip,
    };
  }

  // Recreated from scratch each time so a build never sees a file the current
  // project no longer has.
  const root = workspaceFor(projectId);
  await rm(root, { recursive: true, force: true }).catch(() => {});
  await mkdir(root, { recursive: true });

  const home = join(root, ".home");
  await mkdir(home, { recursive: true });

  try {
    await materialise(root, files);

    if (running) {
      return {
        ok: false,
        target,
        code: null,
        output: "A build is already running. Wait for it to finish.",
        ms: 0,
        timedOut: false,
        command: "",
        skipped: "busy",
      };
    }

    const timeout = Math.min(
      Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000),
      HARD_TIMEOUT_MS,
    );
    const onOutput = opts.onOutput;

    running = true;
    let combined = "";
    let code: number | null = 0;
    let timedOut = false;

    try {
      for (const step of planned) {
        combined += `$ ${step.command} ${step.args.join(" ")}\n`;
        onOutput?.(`$ ${step.command} ${step.args.join(" ")}`);
        const result = await run(step, root, home, timeout, onOutput);
        combined += result.output;
        if (combined.length > MAX_OUTPUT_CHARS) {
          combined = combined.slice(0, MAX_OUTPUT_CHARS) + "\n… output truncated …\n";
        }

        if (result.timedOut) {
          timedOut = true;
          code = null;
          combined += `\nTimed out after ${Math.round(timeout / 1000)}s.\n`;
          break;
        }
        if (result.code !== 0) {
          code = result.code;
          break; // Stop at the first failure; later steps cannot help.
        }
      }
    } finally {
      running = false;
    }

    // A successful build keeps its workspace so the preview route can serve
    // the real output. A failed one is removed: a half-written dist is worse
    // than no dist.
    if (!(code === 0 && !timedOut)) {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    } else {
      // The home directory is a cache, not output. Dropping it keeps the
      // served tree free of anything that is not part of the app.
      await rm(home, { recursive: true, force: true }).catch(() => {});
    }

    return {
      ok: code === 0 && !timedOut,
      target,
      code,
      output: combined.trim(),
      ms: Date.now() - started,
      timedOut,
      command: planned.map((s) => `${s.command} ${s.args.join(" ")}`).join(" && "),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      target,
      code: null,
      output: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
      timedOut: false,
      command: "",
    };
  }
}

/** Resolves a preview path inside a built output directory, or refuses. */
export function safePreviewPath(root: string, requestPath: string): string | null {
  const relative = requestPath.replace(/^\/+/, "");
  const target = relative === "" ? "index.html" : relative;
  return safeJoin(root, target);
}
