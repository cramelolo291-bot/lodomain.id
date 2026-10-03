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

export type FreebuffIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  user: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  comments: number;
  pull_request: boolean;
  labels: Array<{ name: string }>;
  body?: string;
};

export type FreebuffPr = FreebuffIssue & {
  merged_at: string | null;
  merge_commit_sha: string | null;
};

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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
  if (!res.ok) {
    // GitHub returns 403 + a RateLimit-Remaining header when unauthenticated
    // and over the anonymous cap. Surface it as a clear error rather than a
    // blank grid.
    const limit = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const why = limit === "0"
      ? `GitHub API rate limit hit (anonymous threshold). Set VITE_GITHUB_TOKEN to raise it.`
      : `GitHub API returned ${res.status} for ${url}.`;
    throw new Error(why);
  }
  return res.json() as Promise<T>;
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
export async function fetchFreebuffData(page = 1, perPage = 100): Promise<{
  repo: FreebuffRepo;
  files: FreebuffFile[];
  issues: FreebuffGithubResponse;
  prs: FreebuffGithubResponse;
}> {
  const [repoRes, filesRes, issuesRes, prsRes] = await Promise.all([
    getJson<FreebuffRepo>("https://api.github.com/repos/CodebuffAI/freebuff"),
    getJson<Array<{ name: string; path: string; size: number; type: string; url: string; sha: string }>>(
      "https://api.github.com/repos/CodebuffAI/freebuff/git/trees/main?recursive=1",
    ),
    getJson<FreebuffGithubResponse>(
      `https://api.github.com/search/issues?q=repo:CodebuffAI/freebuff+is:issue+is:open&per_page=${perPage}&page=${page}`,
    ),
    getJson<FreebuffGithubResponse>(
      `https://api.github.com/search/issues?q=repo:CodebuffAI/freebuff+is:pr+is:open&per_page=${perPage}&page=${page}`,
    ),
  ]);

  const files = filesRes
    .filter((f): f is FreebuffRepoFile => f.type === "blob")
    .map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      url: f.url,
      htmlUrl: `https://github.com/CodebuffAI/freebuff/blob/main/${f.path}`,
      type: "file" as const,
      sha: f.sha,
    }));

  return { repo: repoRes, files, issues: issuesRes, prs: prsRes };
}

/** Sort issues newest-first. */
export function sortIssues(issues: FreebuffGithubResponse["items"]): FreebuffIssue[] {
  return [...issues]
    .filter((i): i is FreebuffIssue => "pull_request" in i === false || i.pull_request === false)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

/** Sort PRs newest-first, most recently updated first. */
export function sortPrs(prs: FreebuffGithubResponse["items"]): FreebuffPr[] {
  return [...prs]
    .filter((p): p is FreebuffPr => p.pull_request === true)
    .sort((a, b) =>
      a.pull_request === true && b.pull_request === true
        ? +new Date(a.updated_at) - +new Date(b.updated_at)
        : b.pull_request === true ? 1 : -1,
    );
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
    user: issue.user,
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
    user: pr.user,
    createdAt: pr.created_at,
    mergedAt: pr.merged_at,
    comments: pr.comments,
    isPr: true,
    labels: labelsOf(pr),
  };
}

/** Compact summary: how many issues and PRs, newest, and the current counts
 *  that the pages advertise. */
export function summarize(issues: FreebuffGithubResponse["items"], prs: FreebuffGithubResponse["items"]): {
  openIssues: number;
  openPrs: number;
  newestIssue: FreebuffIssue | null;
  newestPr: FreebuffPr | null;
  totalFiles: number;
} {
  const openIssuesSorted = sortIssues(issues);
  const openPrsSorted = sortPrs(prs);

  return {
    openIssues: openIssuesSorted.filter((i) => i.state === "open").length,
    openPrs: openPrsSorted.filter((p) => p.state === "open").length,
    newestIssue: openIssuesSorted.find((i) => i.state === "open") ?? null,
    newestPr: openPrsSorted.find((p) => p.state === "open") ?? null,
    totalFiles: 0,
  };
}
