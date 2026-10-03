// Live repository tools.
//
// This is the "server" side of the public pages: instead of the chat merely
// showing a file tree, it can actually *call* these functions — list the
// tracked repository, search file contents, read a file, and read issues/PRs.
// Everything is real data fetched from the GitHub API with a cache in front of
// it, so a conversation can do real work over the repo instead of describing it.
//
// No API key is required: every endpoint here is a public, unauthenticated
// read. Results are cached in memory and in sessionStorage so a long chat
// session does not burn the anonymous rate-limit quota.

import {
  fetchFreebuffData, sortIssues, sortPrs, toIssueView, toPrView,
  type FreebuffFile, type IssueView, type PrView,
} from "@/lib/frebbuff-data";

/** Cap on a single read so a huge asset never floods the chat transcript. */
const MAX_READ_CHARS = 20_000;
/** Binary/asset extensions we will not fetch as text. */
const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "mp4", "mov", "mp3",
  "wav", "zip", "gz", "tar", "pdf", "woff", "woff2", "ttf", "eot", "svgz",
]);

export type RepoSnapshot = {
  files: FreebuffFile[];
  issues: IssueView[];
  prs: PrView[];
  repo: Awaited<ReturnType<typeof fetchFreebuffData>>["repo"];
};

let snapshot: Promise<RepoSnapshot> | null = null;

/** Fetch the tracked repo's files, issues and PRs once and share the promise. */
export function loadRepo(): Promise<RepoSnapshot> {
  snapshot ??= fetchFreebuffData().then((d) => ({
    files: d.files,
    issues: sortIssues(d.issues.items).map(toIssueView),
    prs: sortPrs(d.prs.items).map(toPrView),
    repo: d.repo,
  })).catch((e) => {
    // Let the next call retry rather than caching the failure forever.
    snapshot = null;
    throw e;
  });
  return snapshot;
}

function isTextFile(file: FreebuffFile): boolean {
  const dot = file.name.lastIndexOf(".");
  if (dot <= 0) return true; // dotfiles and extensionless (uv.lock) are text
  return !BINARY_EXT.has(file.name.slice(dot + 1).toLowerCase());
}

const contentCache = new Map<string, string>();

/**
 * Read one file's real contents from the repository's default branch.
 * Returns null for binary assets rather than fetching them.
 */
export async function readFile(path: string): Promise<string | null> {
  const cached = contentCache.get(path);
  if (cached !== undefined) return cached;

  const { repo } = await loadRepo();
  const url = `${repo.htmlUrl}/raw/${repo.defaultBranch}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  const res = await fetch(url, { headers: { Accept: "text/plain" } });
  if (!res.ok) {
    contentCache.set(path, "");
    return null;
  }
  const text = (await res.text()).slice(0, MAX_READ_CHARS);
  contentCache.set(path, text);
  return text;
}

/** Result shape shared by every tool so the chat renders them uniformly. */
export type ToolResult = {
  ok: boolean;
  summary: string;
  lines: string[];
};

/** List the repository's files, optionally filtered by a path fragment. */
export async function listFiles(query?: string): Promise<ToolResult> {
  const { files, repo } = await loadRepo();
  const q = query?.trim().toLowerCase();
  const matches = q
    ? files.filter((f) => f.path.toLowerCase().includes(q))
    : files;
  return {
    ok: matches.length > 0,
    summary: `${matches.length} of ${files.length} files in ${repo.owner}/${repo.repo}`,
    lines: matches.slice(0, 200).map((f) => f.path),
  };
}

/** Find files whose contents mention a string, or whose path does. */
export async function searchFiles(query?: string): Promise<ToolResult> {
  const q = (query ?? "").trim();
  if (!q) return { ok: false, summary: "usage: /search_files <query>", lines: [] };

  const { files } = await loadRepo();
  const needle = q.toLowerCase();
  const pathHits = files.filter((f) => f.path.toLowerCase().includes(needle));

  // Only scan text files, and only the ones not already matched by path.
  const candidates = files.filter(
    (f) => isTextFile(f) && !pathHits.includes(f),
  );
  const contentHits: string[] = [];
  for (const f of candidates) {
    const body = await readFile(f.path);
    if (body && body.toLowerCase().includes(needle)) contentHits.push(f.path);
    // Bound the fan-out: this is a chat tool, not a CI grep.
    if (contentHits.length >= 25) break;
  }

  const lines = [
    // `pathHits` holds File objects, so map to `path` — stringifying the object
    // directly rendered "[object Object]" in the chat transcript.
    ...pathHits.map((f) => `${f.path}  (path match)`),
    ...contentHits.map((p) => `${p}  (content match)`),
  ];
  return {
    ok: lines.length > 0,
    summary: `${lines.length} match(es) for "${q}"`,
    lines: lines.slice(0, 100),
  };
}

/** Read a file and return a head excerpt, with a truncation notice. */
export async function openFile(path?: string): Promise<ToolResult> {
  if (!path || !path.trim()) {
    return { ok: false, summary: "usage: /open_file <path>", lines: [] };
  }
  const body = await readFile(path.trim());
  if (body === null) return { ok: false, summary: `cannot read ${path}`, lines: [] };
  const truncated = body.length > MAX_READ_CHARS;
  return {
    ok: true,
    summary: `${path} — ${body.length} chars${truncated ? " (truncated)" : ""}`,
    lines: body.slice(0, 400).split("\n").slice(0, 40),
  };
}

/** List open issues, optionally filtered by a title/body substring. */
export async function listIssues(query?: string): Promise<ToolResult> {
  const { issues } = await loadRepo();
  const q = query?.trim().toLowerCase();
  const matches = q ? issues.filter((i) => i.title.toLowerCase().includes(q)) : issues;
  return {
    ok: matches.length > 0,
    summary: `${matches.length} open issue(s)`,
    lines: matches.slice(0, 60).map((i) => `#${i.number}  ${i.title}  — ${i.user}`),
  };
}

/** List open pull requests, optionally filtered by title substring. */
export async function listPrs(query?: string): Promise<ToolResult> {
  const { prs } = await loadRepo();
  const q = query?.trim().toLowerCase();
  const matches = q ? prs.filter((p) => p.title.toLowerCase().includes(q)) : prs;
  return {
    ok: matches.length > 0,
    summary: `${matches.length} open PR(s) on this page`,
    lines: matches.slice(0, 60).map((p) => `#${p.number}  ${p.title}  — ${p.user}`),
  };
}

/** Repo-level stats, for the chat to quote without a round trip. */
export async function repoStats(): Promise<ToolResult> {
  const { repo, files, issues, prs } = await loadRepo();
  return {
    ok: true,
    summary: `${repo.owner}/${repo.repo}`,
    lines: [
      `stars: ${repo.stars}`,
      `forks: ${repo.forks}`,
      `open issues: ${repo.openIssues}`,
      `open PRs: ${repo.prs}`,
      `files indexed: ${files.length}`,
      `issues loaded: ${issues.length}`,
      `PRs loaded: ${prs.length}`,
    ],
  };
}

export type ToolName =
  | "listFiles" | "searchFiles" | "openFile"
  | "listIssues" | "listPrs" | "repoStats";

/** The tool manifest the chat UI renders and dispatches against. */
export const TOOLS: Array<{
  name: ToolName;
  label: string;
  blurb: string;
  run: (arg?: string) => Promise<ToolResult>;
}> = [
  { name: "listFiles", label: "list_files", blurb: "List repository files", run: listFiles },
  { name: "searchFiles", label: "search_files", blurb: "Grep file contents", run: searchFiles },
  { name: "openFile", label: "open_file", blurb: "Read one file", run: openFile },
  { name: "listIssues", label: "list_issues", blurb: "Open issues", run: listIssues },
  { name: "listPrs", label: "list_prs", blurb: "Open pull requests", run: listPrs },
  { name: "repoStats", label: "repo_stats", blurb: "Repository stats", run: repoStats },
];

/**
 * Parse a `/command` the user typed, e.g. `/search_files cache`.
 *
 * Matching is on the tool's snake_case `label` (what the user types), not its
 * camelCase `name`, and falls back to `name` so both spellings work.
 * Returns null when the text is not a tool invocation.
 */
export function parseCommand(text: string): { name: ToolName; arg: string } | null {
  const m = /^\s*\/([a-zA-Z_][a-zA-Z0-9_]*)\s*([\s\S]*)$/.exec(text);
  if (!m) return null;
  const token = m[1]!;
  const hit =
    TOOLS.find((t) => t.label === token) ?? TOOLS.find((t) => t.name === token);
  return hit ? { name: hit.name, arg: (m[2] ?? "").trim() } : null;
}