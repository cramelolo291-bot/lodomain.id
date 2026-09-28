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
import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../auth/session";
import { db } from "../db/client";
import { projects, projectFiles } from "../db/schema";
import {
  outputDirFor,
  runBuild,
  safePreviewPath,
} from "../build/runner";
import { params } from "../http/validate";
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
  const input = runBody.parse(raw);

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
