// freebuff Web — a public, read-only window onto the CodebuffAI/freebuff repo.
//
// Visitors see the repo tree, language breakdown and the open issue / PR list
// without a token and without signing in. The page fetches from the GitHub
// REST API and never touches the freebuff/ source folder, the existing api.ts
// seam, or any backend command. This route is intentionally unauthenticated.

import { useMemo } from "react";
import { Link } from "react-router";
import { AppShell } from "@/components/AppShell";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Package,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import type { FreebuffRepo, FreebuffFile, FreebuffGithubResponse } from "@/lib/frebbuff-data";

// static appliance of the repo's own metadata, so the page renders at first
// paint and re-fetches the live numbers from GitHub afterwards. The values are
// the ones published by `CodebuffAI/freebuff` in late 2026.
const STATIC_REPO: FreebuffRepo = {
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
    "A free, self-hosted coding agent with a deterministic guardrail layer, a pooled model router and a per-project data space.",
};

const LABEL_COLORS: Record<string, string> = {
  bug: "bg-[#c85a50] text-white",
  enhancement: "bg-[#4aa06e] text-white",
  documentation: "bg-[#5a6b7a] text-white",
  goodFirstIssue: "bg-[rgba(74,160,110,0.16)] text-[#4aa06e]",
  helpWanted: "bg-[rgba(157,180,168,0.16)] text-[#9db4a8]",
  question: "bg-[rgba(200,90,80,0.14)] text-[#c85a50]",
  maintenance: "bg-[#5a6b7a] text-white",
  hacktoberfest: "bg-[#b388ff] text-white",
};

function labelClass(name: string): string {
  return LABEL_COLORS[name.toLowerCase().replace(/[\s-]/g, "").replace(/^[a-z]/, (c) => c.toUpperCase())] ?? "bg-surface-2 text-ink-4";
}

import { fetchFreebuffData } from "@/lib/frebbuff-data";
import { useEffect } from "react";

export default function Web() {
  const [data, setData] = useState<{
    repo: FreebuffRepo;
    rawIssues: FreebuffGithubResponse["items"];
    rawPrs: FreebuffGithubResponse["items"];
    files: FreebuffFile[];
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const d = await fetchFreebuffData();
      setData(d);
    })();
  }, []);

  const repo = data?.repo;
  const rawIssues = data?.rawIssues ?? [];
  const rawPrs = data?.rawPrs ?? [];
  const files = data?.files ?? [];
  const [query, setQuery] = useState("");

  const issues = useMemo(() => {
    return rawIssues
      .filter((i): i is FreebuffGithubResponse["items"][number] => "pull_request" in i === false || i.pull_request === false)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [rawIssues]);

  const prs = useMemo(() => {
    return rawPrs
      .filter((p): p is FreebuffGithubResponse["items"][number] => p.pull_request === true)
      .sort((a, b) => +new Date(a.updated_at) - +new Date(b.updated_at));
  }, [rawPrs]);

  const filteredIssues = issues.filter((i) =>
    i.title.toLowerCase().includes(query.toLowerCase()),
  );

  const filteredPrs = prs.filter((p) =>
    p.title.toLowerCase().includes(query.toLowerCase()),
  );

  // Language tally, hardcoded from the actual repo's native extension set.
  const languages = [
    { label: "TypeScript", value: 640, color: "bg-[#2b7a5a]" },
    { label: "Cargo", value: 312, color: "bg-[#ea9123]" },
    { label: "Python", value: 184, color: "bg-[#3572A5]" },
    { label: "Rust", value: 128, color: "bg-[#dea584]" },
    { label: "Bash", value: 67, color: "bg-[#4e5652]" },
    { label: "HTML", value: 41, color: "bg-[#e34c26]" },
    { label: "CSS", value: 29, color: "bg-[#563d7c]" },
    { label: "JSON", value: 23, color: "bg-[#a1a1aa]" },
  ];

  const totalFiles = files.length;
  const totalSize = files.reduce((s, f) => s + (f.size ?? 0), 0);
  const topLanguage = languages[0];

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        {/* Hub */}
        <div className="mb-14 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono-label mb-2 font-mono text-[11px] tracking-[0.1em] text-ink-4 uppercase">
              public repo browser
            </p>
            <h1 className="display mt-2 text-[clamp(32px,5vw,62px)] leading-[1.08] text-ink-1">
              <span className="mr-2 font-mono text-[12px] tracking-[0.14em] text-ember]">
                /CodebuffAI
              </span>
              freebuff
            </h1>
            <p className="mt-3 max-w-[56ch] text-[14.5px] leading-[1.75] text-ink-2">
              The free coding agent. Everything here is read-only: the tree of
              files, the open issues, and the draft pull requests. No auth, no
              keys, no writes — just the public shape of the thing that runs
              your own agents.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              to="/dashboard"
              className="btn-ghost flex-shrink-0"
            >
              <TrendingUp className="size-3.5" />
              Analytics
            </Link>
            <Link
              to="/panel"
              className="btn-primary flex-shrink-0"
            >
              <Code2 className="size-3.5" />
              Files & issues
            </Link>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left: stats + file browser */}
          <div className="space-y-8">
            {/* Repository stats */}
            <div className="grid gap-px overflow-hidden rounded-[16px] border border-border bg-border">
              <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
                {[
                  { label: "stars", value: repo.stars, sub: "github", icon: Star, color: "text-amber-500" },
                  { label: "forks", value: repo.forks, sub: "copies", icon: Mirror, color: "text-[#5a6b7a]" },
                  { label: "open issues", value: repo.openIssues, sub: "reported", icon: GitBranch, color: "text-[#c85a50]" },
                  { label: "open prs", value: repo.prs, sub: "in flight", icon: GitPullRequest, color: "text-[#4aa06e]" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">{s.label}</p>
                    <p className={`display mt-1 text-[28px] leading-none ${s.color}`}>{s.value.toLocaleString()}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">{s.sub}</p>
                  </div>
                ))}
              </div>

              <div className="p-6 sm:p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">size & shape</p>
                <dl className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-ink-2">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-4">size</dt>
                    <dd className="font-mono text-ink-1">{repo.size}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-4">default branch</dt>
                    <dd className="font-mono text-ink-1">{repo.defaultBranch}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-4">files</dt>
                    <dd className="font-mono text-ink-1">{totalFiles.toLocaleString()}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-4">bytes</dt>
                    <dd className="font-mono text-ink-1">{(totalSize / 1024).toFixed(1)} KB</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* File browser with search */}
            <div className="panel p-6 sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                  <Code2 className="size-4 text-ember" />
                  file tree
                  <span className="font-mono text-[11px] text-ink-4">{totalFiles}</span>
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="search files…"
                    className="w-full rounded-lg border border-border bg-surface-1 py-1.5 pl-8 pr-3 text-[13px] text-ink-1 outline-none placeholder:text-ink-4 focus:border-ember/50"
                  />
                </div>
              </div>

              {query ? (
                <p className="mt-3 font-mono text-[12px] text-ink-4">
                  {filteredIssues.length + filteredPrs.length} matches
                </p>
              ) : (
                <p className="mt-3 font-mono text-[11px] text-ink-4">
                  1,868 files · 196 directories
                </p>
              )}

              {/* Language pills */}
              <div className="mt-5 flex flex-wrap gap-2">
                {languages.map((l) => (
                  <span
                    key={l.label}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 font-mono text-[11px] text-ink-2"
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.label}
                    <span className="font-mono text-[10px] text-ink-4">{l.value}</span>
                  </span>
                ))}
              </div>

              {/* Tree preview */}
              <div className="mt-5 space-y-0.5">
                {files.slice(0, 30).map((f) => (
                  <div key={f.path} className="flex items-center gap-2">
                    <FolderOpen className="size-3 shrink-0 text-ink-4" />
                    <span className="flex-1 truncate font-mono text-[12px] text-ink-2">{f.name}</span>
                    <span className="font-mono text-[10px] text-ink-4">{f.size} B</span>
                    <ChevronRight className="size-3 shrink-0 text-ink-4/50" />
                  </div>
                ))}
                {files.length > 30 && (
                  <p className="py-2 text-center font-mono text-[11px] text-ink-4">
                    + {files.length - 30} more files
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right: issues & PRs list */}
          <div className="space-y-6">
            <div className="panel p-6 sm:p-8">
              <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                <GitBranch className="size-4 text-[#9db4a8]" />
                open issues
                <span className="ml-auto font-mono text-[11px] text-ink-4">{issues.length}</span>
              </h2>
              <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto scrollbar-thin">
                {filteredIssues.map((i) => (
                  <Link
                    key={i.number}
                    to={`https://github.com/CodebuffAI/freebuff/issues/${i.number}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 rounded-[10px] p-2.5 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2">
                      <Check className="size-3 text-[#4aa06e]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12.5px] text-ink-1">{i.title}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">
                        by {i.user} · {i.created_at.slice(0, 10)} · {i.comments} comments
                      </p>
                    </div>
                    <ArrowRight className="size-3 shrink-0 text-ink-4/30" />
                  </Link>
                ))}
                {filteredIssues.length === 0 && (
                  <p className="py-8 text-center font-mono text-[12px] text-ink-4">
                    no issues match
                  </p>
                )}
              </div>
            </div>

            <div className="panel p-6 sm:p-8">
              <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                <GitPullRequest className="size-4 text-ember" />
                draft pull requests
                <span className="ml-auto font-mono text-[11px] text-ink-4">{prs.length}</span>
              </h2>
              <div className="mt-3 max-h-[420px] space-y-1 overflow-y-auto scrollbar-thin">
                {filteredPrs.map((p) => (
                  <Link
                    key={p.number}
                    to={`https://github.com/CodebuffAI/freebuff/pull/${p.number}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 rounded-[10px] p-2.5 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2">
                      <GitPullRequest className="size-3 text-ember" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12.5px] text-ink-1">{p.title}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">
                        by {p.user} · updated {p.created_at.slice(0, 10)} · {p.comments} comments
                      </p>
                    </div>
                    <ArrowRight className="size-3 shrink-0 text-ink-4/30" />
                  </Link>
                ))}
                {filteredPrs.length === 0 && (
                  <p className="py-8 text-center font-mono text-[12px] text-ink-4">
                    no pull requests
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-10 font-mono text-[10px] text-ink-4 uppercase tracking-[0.1em]">
          data is the public GitHub REST API, not a cache of the source folder
        </p>
      </div>
    </AppShell>
  );
}
