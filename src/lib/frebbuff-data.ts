// freebuff repo data layer.
//
// Public, read-only metadata about CodebuffAI/freebuff, fetched from the GitHub
// API. This is used by the public /web/, /chat/, /panel/ and /dashboard/
// pages so visitors can browse the repository, its open issues and its PRs
// without signing in.
//
// The value is the GitHub REST API, not a proxy: every endpoint here is a
// plain fetch against github.com so the page can cache, re-fetch and display
// the numbers the owner publishes. Nothing in this module reads or writes the
// freebuff/ source folder in the repo, and nothing it returns is fed into the
// existing api.ts seam.

export type FreebuffRepo = {
  owner: string;
  repo: string;
  name: string;
  blog: string;
  email: string;
  bio: string;
  stars: number;
  forks: number;
  openIssues: number;
  prs: number;
  languages?: string[];
  size: string;
  defaultBranch: string;
  htmlUrl: string;
  description: string;
};

export type FreebuffFile = {
  name: string;
  path: string;
  size: number;
  url: string;
  htmlUrl: string;
  type: "file" | "dir";
  sha: string;
  downloadedAt?: number;
};

export type FreebuffRepoFile = {
  name: string;
  path: string;
  size: number;
  url: string;
  htmlUrl: string;
  type: "file" | "dir";
  sha: string;
  downloadedAt?: number;
};

/**
 * The presence and shape of GitHub's `pull_request` field is what distinguishes
 * a pull request from an issue in a search result — it is an object, not a
 * boolean, and it is where `merged_at` actually lives.
 */
export type FreebuffPullRef = {
  url: string;
  html_url: string;
  merged_at: string | null;
};

/** GitHub returns the author as an object; only `login` is ever displayed. */
export type FreebuffUser = {
  login: string;
  avatar_url?: string;
  html_url?: string;
};

export type FreebuffIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  user: FreebuffUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  comments: number;
  pull_request?: FreebuffPullRef;
  labels: Array<{ name: string }>;
  body?: string;
};

export type FreebuffPr = FreebuffIssue & {
  pull_request: FreebuffPullRef;
};

/** The PR's merge time, or null when it is still open. */
export function mergedAt(pr: FreebuffPr): string | null {
  return pr.pull_request.merged_at ?? null;
}

export type FreebuffGithubResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: Array<FreebuffIssue | FreebuffPr | Record<string, unknown>>;
};

// ── Plucked from the GitHub API at build time ─────────────────────────────

export const FREEbuff: FreebuffRepo = {
  owner: "CodebuffAI",
  repo: "freebuff",
  name: "Freebuff",
  blog: "https://freebuff.com",
  email: "hello@codebuff.com",
  bio: "The free coding agent",
  stars: 13100,
  forks: 1399,
  openIssues: 310,
  prs: 113,
  size: "172 MB",
  defaultBranch: "main",
  htmlUrl: "https://github.com/CodebuffAI/freebuff",
  description:
    "A free, self-hosted coding agent with a deterministic guardrail layer, a pooled model router and a per-project data space. Public data about the repo and its open issues/PRs is served from these pages.",
};

/** Tabular view of the open issues, used to render the issue list. */
export type IssueView = {
  number: number;
  title: string;
  state: "open" | "closed";
  user: string;
  createdAt: string;
  comments: number;
  isPr: boolean;
  labels: string[];
};

/** Tabular view of the open PRs. */
export type PrView = {
  number: number;
  title: string;
  state: "open" | "closed";
  user: string;
  createdAt: string;
  mergedAt: string | null;
  comments: number;
  isPr: boolean;
  labels: string[];
};

// ── Paged pull of every open issue and open PR from GitHub ────────────────

const GITHUB_TOKEN = (import.meta.env.VITE_GITHUB_TOKEN as string | undefined) ?? "";

function authHeader(): Record<string, string> {
  if (GITHUB_TOKEN) {
    return { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };
  }
  return { Accept: "application/vnd.github+json" };
}

const EMPTY_SEARCH: FreebuffGithubResponse = { total_count: 0, incomplete_results: true, items: [] };
const EMPTY_TREE: FreebuffTreeResponse = { sha: "", tree: [], truncated: false };

/**
 * One endpoint, one fallback. This never rejects: GitHub throttles anonymous
 * callers hard (60 core req/hour, 10 search req/minute, per IP) and all four
 * pages share this batch, so a single 403 must degrade one section instead of
 * blanking the whole site.
 */
async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    // Offline, DNS failure, CORS — same treatment as a throttle.
    return fallback;
  }
}

function prUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}`;
}

function issueUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`;
}

/** Pull every open issue and open PR in one go. GitHub returns a single page
 *  of up to 100 items, so this pages through pages 1..5 for the 113 PRs we
 *  expect. */
/**
 * The four public pages all need the same payload. Without this, mounting
 * `/web/` fires four requests and every page visit repeats them, which is how
 * the anonymous search cap gets exhausted. One in-flight promise is shared by
 * every caller and settled after it resolves.
 */
let inflight: Promise<FreebuffPayload> | null = null;
let cached: FreebuffPayload | null = null;

/**
 * The in-memory cache above dies on reload, but the anonymous quota does not —
 * it resets hourly per IP. Persisting the batch to sessionStorage means a
 * visitor who reloads or bounces between the four pages still sees the same
 * data, and costs GitHub nothing.
 */
const CACHE_KEY = "freebuff-public-data:v1";
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

function readPersisted(): FreebuffPayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at: number; data: FreebuffPayload };
    if (!entry?.data || Date.now() - entry.at > CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function persist(data: FreebuffPayload): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Private-mode quota exceeded; the in-memory cache still covers this visit.
  }
}

/** The repository endpoint's own field names, which differ from FreebuffRepo's. */
type FreebuffRepoRaw = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  size: number;
  default_branch: string;
};

/** GitHub's git/trees endpoint wraps the entries in an object, not a bare array. */
type FreebuffTreeResponse = {
  sha: string;
  // A tree entry carries `path`, not `name` — the basename has to be derived.
  tree: Array<{ path: string; size: number; type: string; url: string; sha: string }>;
  truncated: boolean;
};

type FreebuffPayload = {
  repo: FreebuffRepo;
  files: FreebuffFile[];
  issues: FreebuffGithubResponse;
  prs: FreebuffGithubResponse;
};

async function fetchFreebuffDataOnce(page: number, perPage: number): Promise<FreebuffPayload> {
  const [repoRaw, treeRes, issuesRes, prsRes] = await Promise.all([
    // Falls back to the published constants below so the stat cards still
    // render a real number when the repo endpoint is throttled.
    getJson<FreebuffRepoRaw>("https://api.github.com/repos/CodebuffAI/freebuff", {
      name: FREEbuff.name,
      full_name: `${FREEbuff.owner}/${FREEbuff.repo}`,
      description: FREEbuff.description,
      html_url: FREEbuff.htmlUrl,
      homepage: FREEbuff.blog || null,
      stargazers_count: FREEbuff.stars,
      forks_count: FREEbuff.forks,
      size: 172531,
      default_branch: FREEbuff.defaultBranch,
    }),
    getJson<FreebuffTreeResponse>(
      "https://api.github.com/repos/CodebuffAI/freebuff/git/trees/main?recursive=1",
      EMPTY_TREE,
    ),
    // Search is the most aggressively rate-limited surface (10/min, per IP) and
    // is the one most likely to be exhausted by a visitor clicking around.
    getJson<FreebuffGithubResponse>(
      `https://api.github.com/search/issues?q=repo:CodebuffAI/freebuff+is:issue+is:open&per_page=${perPage}&page=${page}`,
      EMPTY_SEARCH,
    ),
    getJson<FreebuffGithubResponse>(
      `https://api.github.com/search/issues?q=repo:CodebuffAI/freebuff+is:pr+is:open&per_page=${perPage}&page=${page}`,
      EMPTY_SEARCH,
    ),
  ]);

  const repo: FreebuffRepo = {
    owner: repoRaw.full_name.split("/")[0] ?? "",
    repo: repoRaw.full_name.split("/")[1] ?? repoRaw.name,
    name: repoRaw.name,
    blog: repoRaw.homepage ?? "",
    email: "",
    bio: repoRaw.description ?? "",
    stars: repoRaw.stargazers_count,
    forks: repoRaw.forks_count,
    // Search reports 0 under throttling, but the repo object always knows how
    // many are open. Prefer the live count, fall back to the published one so
    // the cards never read "0 issues".
    openIssues: issuesRes.total_count || FREEbuff.openIssues,
    prs: prsRes.total_count || FREEbuff.prs,
    size: `${repoRaw.size} kB`,
    defaultBranch: repoRaw.default_branch,
    htmlUrl: repoRaw.html_url,
    description: repoRaw.description ?? "",
  };

  const files = (Array.isArray(treeRes?.tree) ? treeRes.tree : [])
    .filter((f): f is FreebuffRepoFile => f.type === "blob")
    .map((f) => ({
      name: f.path.split("/").pop() ?? f.path,
      path: f.path,
      size: f.size,
      url: f.url,
      htmlUrl: `https://github.com/CodebuffAI/freebuff/blob/main/${f.path}`,
      type: "file" as const,
      sha: f.sha,
    }));

  return { repo, files, issues: issuesRes, prs: prsRes };
}

/**
 * Public entry point. Concurrent callers share one request batch; the result is
 * reused for the rest of the session so revisiting the pages costs nothing.
 */
export function fetchFreebuffData(page = 1, perPage = 100): Promise<FreebuffPayload> {
  if (page !== 1 || perPage !== 100) return fetchFreebuffDataOnce(page, perPage);
  cached ??= readPersisted();
  if (cached) return Promise.resolve(cached);
  inflight ??= fetchFreebuffDataOnce(page, perPage)
    .then((d) => {
      // getJson no longer rejects, so this always resolves. Only a batch that
      // actually reached GitHub is persisted — otherwise a throttled empty
      // result would be cached for 30 minutes.
      if (d.files.length || d.issues.items.length || d.prs.items.length) persist(d);
      cached = d;
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Sort issues newest-first. */
export function sortIssues(issues: FreebuffGithubResponse["items"]): FreebuffIssue[] {
  return issues
    .filter((i): i is FreebuffIssue => !i.pull_request)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

/** Sort PRs most-recently-updated first. */
export function sortPrs(prs: FreebuffGithubResponse["items"]): FreebuffPr[] {
  return prs
    .filter((p): p is FreebuffPr => Boolean(p.pull_request))
    .sort((a, b) => +new Date(a.updated_at) - +new Date(b.updated_at));
}

/** Collapse duplicate label arrays to plain strings for the UI. */
function labelsOf(item: FreebuffIssue | FreebuffPr): string[] {
  const labels = "labels" in item && Array.isArray(item.labels) ? item.labels : [];
  return labels.map((l) => l.name);
}

/** Build the tabular issue view (used by the issue list panels). */
export function toIssueView(issue: FreebuffIssue): IssueView {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    user: issue.user.login,
    createdAt: issue.created_at,
    comments: issue.comments,
    isPr: false,
    labels: labelsOf(issue),
  };
}

/** Build the tabular PR view. */
export function toPrView(pr: FreebuffPr): PrView {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    user: pr.user.login,
    createdAt: pr.created_at,
    mergedAt: mergedAt(pr),
    comments: pr.comments,
    isPr: true,
    labels: labelsOf(pr),
  };
}
