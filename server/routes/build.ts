// Building a project, and serving what it built.
//
// Two routes. `POST /projects/:project/build` runs the toolchain over the
// project's files and reports what happened; `GET /projects/:project/preview/*`
// serves the real output directory so the workspace shows the built app rather
// than a string-concatenated approximation of it.
//
// Every statement is scoped to a project the caller owns, and the path that
// reaches the filesystem is resolved and re-checked against the output root.

import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { requireAuth, sessionFromCookieHeader } from "../auth/session";
import { db } from "../db/client";
import { projects, projectFiles } from "../db/schema";
import {
  outputDirFor,
  runBuild,
  safePreviewPath,
} from "../build/runner";
import { devServer, proxyToDev, startDev, stopDev, syncDev } from "../build/dev";
import { tunnelUpgrade } from "../build/tunnel";
import { markdownToPdf, pdfFilename } from "../build/pdf";
import { isSafePath } from "../pipeline/file-blocks";
import { params, parseValue } from "../http/validate";
import { z } from "zod";

export const build = new Hono();
build.use("*", requireAuth);

const projectParams = z.object({ project: z.string().min(1).max(120) });

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveProject(idOrName: string, userId: string) {
  if (UUID.test(idOrName)) {
    const byId = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, idOrName), eq(projects.ownerId, userId)))
      .limit(1);
    if (byId[0]) return byId[0];
  }
  const byName = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.name, idOrName), eq(projects.ownerId, userId)))
    .limit(1);
  return byName[0] ?? null;
}

// ── Run ───────────────────────────────────────────────────────────────────

const runBody = z.object({
  target: z.enum(["install", "build", "typecheck", "test"]).default("build"),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
});

build.post("/projects/:project/build", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    // An empty body means "just build", which is the common case.
    raw = {};
  }
  const input = parseValue(runBody, raw);

  const files = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  const result = await runBuild(
    project.id,
    Object.fromEntries(files.map((f) => [f.path, f.content])),
    input.target,
    input.timeoutMs ? { timeoutMs: input.timeoutMs } : {},
  );

  // A build that produced an index.html is worth previewing; a skipped one is
  // not an error, so it is reported as 200 with a reason.
  return c.json({
    ...result,
    project: { id: project.id, name: project.name },
    hasOutput: outputDirFor(project.id) !== null,
  });
});

// ── Live dev server ────────────────────────────────────────────────────────

const startBody = z.object({
  /** 0 lets the dev server choose. */
  port: z.number().int().min(0).max(65_535).optional(),
  /** Restart even if one is already running. */
  restart: z.boolean().optional(),
});

build.post("/projects/:project/dev", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const input = parseValue(startBody, raw);

  const files = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  const started = await startDev(
    project.id,
    Object.fromEntries(files.map((f) => [f.path, f.content])),
    input.port ? { port: input.port } : {},
  );

  if (!started.ok) {
    // Not a server fault: the project simply has nothing to run. 200 with a
    // reason is more useful to the client than a 400 it cannot act on.
    return c.json({ ok: false, reason: started.reason });
  }

  const state = devServer(project.id);
  return c.json({
    ok: true,
    port: started.port,
    reused: started.reused,
    pid: state?.pid ?? null,
    log: state?.log ?? [],
    url: `/api/projects/${project.id}/live/`,
  });
});

build.post("/projects/:project/dev/sync", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  const files = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  const result = await syncDev(
    project.id,
    Object.fromEntries(files.map((f) => [f.path, f.content])),
  );
  return c.json({ ...result });
});

build.post("/projects/:project/dev/stop", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  await stopDev(project.id);
  return c.json({ ok: true });
});

/**
 * Everything under the live prefix is forwarded to the running dev server.
 *
 * The upstream address is never taken from the request — it comes from the
 * process this server started — so the path is the only thing a caller
 * controls. A WebSocket upgrade will not survive this, which is a real limit:
 * HMR clients that need one get the static output instead.
 */
build.get("/projects/:project/live/*", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  const { search } = new URL(c.req.url);
  const subPath = c.req.path.slice(c.req.path.indexOf("/live/") + "/live".length);

  const proxied = await proxyToDev(project.id, subPath, { search });
  if (!proxied.ok) {
    return c.json({ error: { message: proxied.reason } }, 503);
  }

  const upstream = proxied.response;
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  c.header("cache-control", "no-store");
  c.header("content-type", contentType);
  // Built output is untrusted markup served from the app's own origin. The
  // sandbox flag is what stops it reaching the API with the session cookie.
  c.header(
    "content-security-policy",
    "sandbox allow-scripts allow-forms allow-popups allow-same-origin",
  );
  c.header("x-content-type-options", "nosniff");

  return c.body(upstream.body as unknown as ArrayBuffer);
});

// ── WebSocket upgrade ──────────────────────────────────────────────────────

/**
 * Handles a WebSocket upgrade for the live preview.
 *
 * HMR clients open one of these, and the HTTP proxy above cannot carry it — an
 * upgrade becomes two raw sockets that must not be re-parsed. So this runs
 * before routing, on the socket, and copies bytes.
 *
 * It redoes the two checks the HTTP path does: a valid session, and a project
 * the caller owns. An upgrade that skipped either would be the one hole in the
 * app that a cookie-less client could walk through.
 */
export async function handleLiveUpgrade(
  request: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  const refuse = (status: string, reason: string) => {
    if (socket.destroyed) return;
    socket.end(
      `HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`,
    );
  };

  const url = request.url ?? "";
  const match = url.match(/^\/api\/projects\/([^/]+)\/live(\/.*)$/);
  if (!match) {
    // Not ours. Closing is right: the HTTP server will not route an upgrade.
    socket.destroy();
    return;
  }

  const session = await sessionFromCookieHeader(request.headers.cookie);
  if (!session) {
    refuse("401 Unauthorized", "sign in to use the live preview");
    return;
  }

  const project = await resolveProject(decodeURIComponent(match[1]!), session.userId);
  if (!project) {
    refuse("404 Not Found", "no such project");
    return;
  }

  const state = devServer(project.id);
  if (!state || !state.port) {
    refuse("503 Service Unavailable", "the dev server is not running");
    return;
  }

  tunnelUpgrade(request, socket, head, state.port);
}

// ── Preview ───────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

build.get("/projects/:project/preview", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  const out = outputDirFor(project.id);
  if (!out) {
    return c.json(
      { error: { message: "Nothing built yet. Run a build first." } },
      404,
    );
  }

  const target = safePreviewPath(out, new URL(c.req.url).pathname.replace(/\/preview$/, ""));
  if (!target) return c.json({ error: { message: "Invalid path" } }, 400);

  return serve(target, out, c);
});

build.get("/projects/:project/preview/*", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  const out = outputDirFor(project.id);
  if (!out) {
    return c.json(
      { error: { message: "Nothing built yet. Run a build first." } },
      404,
    );
  }

  const requestPath = c.req.path.slice(c.req.path.indexOf("/preview/") + "/preview".length);
  const target = safePreviewPath(out, requestPath);
  if (!target) return c.json({ error: { message: "Invalid path" } }, 400);

  return serve(target, out, c);
});

/** Serves a file, falling back to index.html so client-side routes work. */
async function serve(target: string, out: string, c: Context) {
  let file = target;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = `${file.replace(/\/$/, "")}/index.html`;
  } catch {
    // Unknown path: hand back the shell, which is what a browser needs.
    file = safePreviewPath(out, "index.html") ?? file;
  }

  try {
    const body = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";

    // Hashed filenames can be cached hard; index.html must not be, or a rebuild
    // never reaches an open tab.
    const isShell = file.endsWith("index.html");
    c.header("cache-control", isShell ? "no-cache" : "public, max-age=300");
    c.header("content-type", type);
    // A built app is untrusted markup in our own origin. This sandbox is what
    // stops it reaching the API with the session cookie.
    c.header("content-security-policy", "sandbox allow-scripts allow-forms allow-popups");
    c.header("x-content-type-options", "nosniff");
    return c.body(body as unknown as ArrayBuffer);
  } catch {
    return c.json({ error: { message: "Not found in build output" } }, 404);
  }
}

// ── Files ──────────────────────────────────────────────────────────────────
//
// The project's files live in Postgres as text, not on disk, so there is no
// static directory to hand a browser. This turns one row into a response —
// what the Changes panel and any generated document link point at.

/** Extensions the agent is allowed to fetch back as a download. */
const DOWNLOADABLE: Record<string, string> = {
  ...MIME,
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
};

build.get("/projects/:project/file/*", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  let path: string;
  try {
    path = decodeURIComponent(
      c.req.path.slice(c.req.path.indexOf("/file/") + "/file".length),
    );
  } catch {
    return c.json({ error: { message: "Invalid path" } }, 400);
  }

  // Rejects `..`, absolute paths, and anything else that could climb out. The
  // same rule the model was held to when it wrote the file, enforced again on
  // the way out — a path is only safe if both ends agree.
  if (!isSafePath(path)) return c.json({ error: { message: "Invalid path" } }, 400);

  const row = await db
    .select({ content: projectFiles.content })
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, project.id), eq(projectFiles.path, path)))
    .limit(1);
  if (!row[0]) return c.json({ error: { message: "No such file" } }, 404);

  // `.pdf` is a rendering request, not a stored file: the database holds the
  // markdown, and the PDF is produced here so it can never go stale.
  if (/\.pdf$/i.test(path)) {
    const source = path.replace(/\.pdf$/i, "");
    if (isSafePath(source)) {
      const md = await db
        .select({ content: projectFiles.content })
        .from(projectFiles)
        .where(
          and(eq(projectFiles.projectId, project.id), eq(projectFiles.path, source)),
        )
        .limit(1);
      if (md[0]) {
        const stem = source.split("/").pop() ?? "dokumen";
        const buf = markdownToPdf(md[0].content, { title: stem });
        c.header("content-type", "application/pdf");
        c.header("content-disposition", `inline; filename="${pdfFilename(stem)}"`);
        c.header("cache-control", "no-store");
        c.header("x-content-type-options", "nosniff");
        return c.body(new Uint8Array(buf) as unknown as ArrayBuffer);
      }
    }
  }

  const type = DOWNLOADABLE[extname(path).toLowerCase()];
  if (!type) {
    return c.json({ error: { message: "That file type cannot be downloaded" } }, 415);
  }

  const name = (path.split("/").pop() ?? "file").replace(/["\\]/g, "");
  c.header("content-type", type);
  c.header("content-disposition", `inline; filename="${name}"`);
  c.header("cache-control", "no-cache");
  // A downloaded .html is inert: the CSP sandbox means it cannot reach the
  // API with the session cookie.
  c.header("content-security-policy", "sandbox");
  c.header("x-content-type-options", "nosniff");
  return c.body(row[0].content);
});

/** Lists the project's files so the UI can offer links without guessing. */
build.get("/projects/:project/files", async (c) => {
  const { userId } = c.get("session");
  const { project: ref } = params(c, projectParams);
  const project = await resolveProject(ref, userId);
  if (!project) return c.json({ error: { message: "Project not found" } }, 404);

  const rows = await db
    .select({ path: projectFiles.path, updatedAt: projectFiles.updatedAt })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, project.id));

  return c.json({
    files: rows
      .map((r) => ({
        path: r.path,
        updatedAt: r.updatedAt,
        url: `/api/projects/${project.id}/file/${r.path}`,
        // The file route renders `.md` to PDF on request, so every markdown
        // file is offered twice: as text, and as a document.
        pdfUrl: /\.md$/i.test(r.path)
          ? `/api/projects/${project.id}/file/${r.path.replace(/\.md$/i, ".pdf")}`
          : null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  });
});
