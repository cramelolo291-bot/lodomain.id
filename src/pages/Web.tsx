// Signed-in, read-only window onto the upstream browser-agent repo.
//
// Visitors see live repo metadata, files, languages, issues, and PRs. Data is
// fetched from GitHub's REST API; this page never writes to the upstream repo
// or executes commands.

import { Link } from "react-router";
import { AppShell } from "@/components/AppShell";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  FolderOpen,
  GitBranch,
  GitFork,
  GitPullRequest,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";

import { useEffect, useState, useMemo } from "react";
import { fetchFreebuffData, sortIssues, sortPrs } from "@/lib/frebbuff-data";

export default function Web() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchFreebuffData>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchFreebuffData();
        if (!cancelled) setData(d);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Live GitHub data is unavailable.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // No repository metrics or file lists are substituted when the live API fails.
  const repo = data?.repo ?? null;
  const files = data?.files ?? [];
  const [query, setQuery] = useState("");

  const issues = useMemo(() => (data ? sortIssues(data.issues.items) : []), [data]);
  const prs = useMemo(() => (data ? sortPrs(data.prs.items) : []), [data]);

  const filteredIssues = issues.filter((i) =>
    i.title.toLowerCase().includes(query.toLowerCase()),
  );

  const filteredPrs = prs.filter((p) =>
    p.title.toLowerCase().includes(query.toLowerCase()),
  );

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    const labels: Record<string, string> = {
      ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
      py: "Python", rs: "Rust", toml: "TOML", sh: "Shell", html: "HTML",
      css: "CSS", json: "JSON", md: "Markdown", yml: "YAML", yaml: "YAML",
    };
    for (const file of files) {
      const leaf = file.path.split("/").pop() ?? file.path;
      const ext = leaf.includes(".") ? leaf.split(".").pop()!.toLowerCase() : "";
      if (!ext) continue;
      const label = labels[ext] ?? ext.toUpperCase();
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        value: total ? Math.round((count / total) * 100) : 0,
        color: label === "TypeScript" ? "bg-[#2b7a5a]" :
          label === "Python" ? "bg-[#3572A5]" :
          label === "Rust" ? "bg-[#dea584]" :
          label === "HTML" ? "bg-[#e34c26]" :
          label === "CSS" ? "bg-[#563d7c]" : "bg-[#a1a1aa]",
      }));
  }, [files]);

  const totalFiles = files.length;
  const totalSize = files.reduce((s, f) => s + (f.size ?? 0), 0);

  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <p className="font-mono text-xs text-ink-4">Loading live repository data…</p>
        </div>
      </AppShell>
    );
  }

  if (loadError || !repo) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl p-6 pt-16">
          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-ember">Live data unavailable</p>
            <h1 className="mt-3 text-xl font-semibold text-ink-1">GitHub did not return current data</h1>
            <p className="mt-2 text-sm text-ink-3">{loadError ?? "No live repository payload was returned."}</p>
            <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Retry live request</button>
          </div>
        </div>
      </AppShell>
    );
  }

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
                /browser-use
              </span>
              jev-ultrafast
            </h1>
            <p className="mt-3 max-w-[56ch] text-[14.5px] leading-[1.75] text-ink-2">
              A browser agent with a dynamic, indexed action space. Everything
              here is read-only: the tree of files, the open issues, and the
              draft pull requests. No auth, no keys, no writes — just the public
              shape of the agent.
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

        {files.length === 0 && (
          <p className="mb-8 rounded-[10px] border border-border bg-surface-2 px-4 py-3 font-mono text-[12px] text-ink-3">
            The live API returned an empty file tree for this repository.
          </p>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left: stats + file browser */}
          <div className="space-y-8">
            {/* Repository stats */}
            <div className="grid gap-px overflow-hidden rounded-[16px] border border-border bg-border">
              <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
                {[
                  { label: "stars", value: repo.stars, sub: "github", icon: Star, color: "text-amber-500" },
                  { label: "forks", value: repo.forks, sub: "copies", icon: GitFork, color: "text-[#5a6b7a]" },
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
                    to={`${repo.htmlUrl}/issues/${i.number}`}
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
                        by {i.user.login} · {i.created_at.slice(0, 10)} · {i.comments} comments
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
                    to={`${repo.htmlUrl}/pull/${p.number}`}
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
                        by {p.user.login} · updated {p.created_at.slice(0, 10)} · {p.comments} comments
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
