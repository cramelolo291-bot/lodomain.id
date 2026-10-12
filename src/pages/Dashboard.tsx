// Public analytics view of the upstream browser-agent repo.
//
// A read-only dashboard that reads the published GitHub metrics: stars, forks,
// open issues, in-flight pull requests, and a language breakdown computed from
// the real file tree. No auth, no keys, no writes. This route is intentionally
// unauthenticated and remote from the repo's source folder.
//

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AppShell } from "@/components/AppShell";
import {
  ArrowRight,
  Code2,
  Download,
  Eye,
  GitBranch,
  GitBranchPlus,
  Star,
  Users,
  GitFork,
} from "lucide-react";
import { fetchFreebuffData, type FreebuffFile, type FreebuffRepo } from "@/lib/frebbuff-data";

/** Display colour per file extension. */
const LANG_COLORS: Record<string, string> = {
  py: "bg-[#3572A5]",
  md: "bg-[#2b7a5a]",
  json: "bg-[#b388ff]",
  js: "bg-[#dea584]",
  html: "bg-[#e34c26]",
  css: "bg-[#563d7c]",
  toml: "bg-[#9c4221]",
  lock: "bg-[#5a6b7a]",
  svg: "bg-[#ff9900]",
};

/** Extensions that are source or markup rather than binary assets. */
const CODE_EXTS = new Set(["py", "md", "json", "js", "html", "css", "toml", "lock", "svg", "yml", "yaml", "sh", "example"]);

/** Group a repo's files into a size-by-extension mix, biggest first. */
function languageMix(files: FreebuffFile[]): Array<{ name: string; size: number; color: string }> {
  const totals = new Map<string, number>();
  for (const f of files) {
    const dot = f.name.lastIndexOf(".");
    // Dotfiles (".gitignore") have no extension, and `uv.lock` has none either.
    const ext = dot > 0 ? f.name.slice(dot + 1).toLowerCase() : "";
    // Demo screenshots and videos dominate this repo's byte count but say
    // nothing about what it is written in, so the chart counts code only.
    if (!ext || !CODE_EXTS.has(ext)) continue;
    totals.set(ext, (totals.get(ext) ?? 0) + f.size);
  }
  return [...totals]
    .map(([ext, size]) => ({
      name: ext === "lock" ? "Lockfile" : ext === "py" ? "Python" : ext === "md" ? "Markdown"
        : ext === "js" ? "JavaScript" : ext === "html" ? "HTML" : ext === "css" ? "CSS"
        : ext === "json" ? "JSON" : ext === "toml" ? "TOML" : ext === "svg" ? "SVG"
        : ext.toUpperCase(),
      size,
      color: LANG_COLORS[ext] ?? "bg-[#5a6b7a]",
    }))
    .sort((a, b) => b.size - a.size);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: "ember" | "teal" | "ink" | "amber";
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">{label}</p>
          <p
            className={`display mt-2 text-[30px] leading-none ${
              accent === "ember" ? "text-ember" : accent === "teal" ? "text-[#4aa06e]" : accent === "amber" ? "text-[#c85a50]" : "text-ink-1"
            }`}
          >
            {value}
          </p>
          {sub && <p className="mt-1.5 font-mono text-[11px] text-ink-4">{sub}</p>}
        </div>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-2 ${accent === "ember" ? "bg-ember-soft" : ""}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function BarChart({
  items,
  valueFormat,
}: {
  items: Array<{ name: string; value: number; color: string }>;
  valueFormat: (v: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.value));
  return (
    <div className="flex h-20 items-end gap-3 px-2">
      {items.map((i) => (
        <div key={i.name} className="flex flex-1 flex-col items-center justify-end gap-1">
          <div
            className="w-full rounded-t-md transition-all duration-700"
            style={{ height: `${(i.value / max) * 100}%`, backgroundColor: i.color }}
          />
          <span className="font-mono text-[10px] text-ink-4">{valueFormat(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stars, setStars] = useState<number | null>(null);
  const [forks, setForks] = useState<number | null>(null);
  const [openIssues, setOpenIssues] = useState<number | null>(null);
  const [openPrs, setOpenPrs] = useState<number | null>(null);
  const [files, setFiles] = useState<FreebuffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    // The dashboard is public and read-only: it reads the published GitHub
    // numbers and renders them, it does not write anywhere and it never
    // touches the repo's source folder.
    //
    // This goes through the shared fetcher rather than its own requests so all
    // four public pages share one in-flight batch and one sessionStorage entry.
    // Rolling its own fetches doubled the anonymous rate-limit burn for no
    // benefit, and exhausted the anonymous rate limit sooner.
    void (async () => {
      try {
        const d = await fetchFreebuffData();
        const repo: FreebuffRepo = d.repo;
        if (cancelledRef.current) return;
        setStars(repo.stars);
        setForks(repo.forks);
        setOpenIssues(repo.openIssues);
        setOpenPrs(repo.prs);
        setFiles(d.files);
      } catch (error) {
        if (!cancelledRef.current) {
          setLoadError(error instanceof Error ? error.message : "Live GitHub data is unavailable.");
        }
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();
  }, []);

  const mix = languageMix(files);
  const totalBytes = mix.reduce((s, l) => s + l.size, 0);
  const languages = mix.map((l) => ({
    ...l,
    value: totalBytes ? Math.round((l.size / totalBytes) * 100) : 0,
  }));
  const totalFiles = files.length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        {/* Hub */}
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono-label mb-2 font-mono text-[11px] tracking-[0.1em] text-ink-4 uppercase">
              public analytics
            </p>
            <h1 className="display mt-2 text-[clamp(32px,5vw,62px)] leading-[1.08] text-ink-1">
              <span className="mr-2 font-mono text-[12px] tracking-[0.14em] text-ember]">/browser-use</span>
              jev-ultrafast
            </h1>
            <p className="mt-3 max-w-[56ch] text-[14.5px] leading-[1.75] text-ink-2">
              Published metrics about the repo: stars, forks, open issues, draft
              pull requests, the code mix and the people behind it. Nothing
              here is written; everything is read from the public API.
            </p>
          </div>
          <Link to="/" className="btn-ghost">
            <Eye className="size-3.5" />
            back to home
          </Link>
        </div>

        {loading ? (
          <div className="flex min-h-[280px] items-center justify-center">
            <span className="font-mono text-[12px] text-ink-4 animate-pulse">loading metrics…</span>
          </div>
        ) : loadError ? (
          <div className="panel mx-auto max-w-xl p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-ember">Live data unavailable</p>
            <h2 className="mt-3 text-xl font-semibold text-ink-1">GitHub did not return current data</h2>
            <p className="mt-2 text-sm text-ink-3">{loadError}</p>
            <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Retry live request</button>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            {/* Left: primary metrics */}
            <div className="space-y-6">
              <div className="grid gap-px overflow-hidden rounded-[16px] border border-border bg-border">
                <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
                  <StatCard
                    label="stars"
                    value={fmt(stars ?? 0)}
                    sub="on github"
                    icon={<Star className="size-4 text-amber-500" />}
                    accent="amber"
                  />
                  <StatCard
                    label="forks"
                    value={fmt(forks ?? 0)}
                    sub="copies of the repo"
                    icon={<GitFork className="size-4 text-[#5a6b7a]" />}
                    accent="ink"
                  />
                  <StatCard
                    label="open issues"
                    value={String(openIssues ?? 0)}
                    sub="still reported"
                    icon={<GitBranch className="size-4 text-[#9db4a8]" />}
                    accent="teal"
                  />
                  <StatCard
                    label="open prs"
                    value={String(openPrs ?? 0)}
                    sub="drafts in flight"
                    icon={<GitBranchPlus className="size-4 text-ember" />}
                    accent="ember"
                  />
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="panel p-6">
                  <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                    <Star className="size-4 text-amber-500" />
                    growth
                  </h2>
                  <p className="mt-2 font-mono text-[12px] text-ink-4">{fmt(stars ?? 0)} stars · {fmt(forks ?? 0)} forks</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-amber-500" />
                  </div>
                  <p className="mt-3 font-mono text-[11px] text-ink-4">total stars {fmt(stars ?? 0)}</p>
                </div>

                <div className="panel p-6">
                  <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                    <Users className="size-4 text-[#5a6b7a]" />
                    community
                  </h2>
                  <p className="mt-2 font-mono text-[12px] text-ink-4">{fmt(totalFiles)} files indexed</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {languages.slice(0, 4).map((l) => (
                      <span key={l.name} className="font-mono text-[10px] text-ink-4">{l.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: languages + activity */}
            <div className="space-y-6">
              <div className="panel p-6">
                <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                  <Code2 className="size-4 text-ember" />
                  code mix
                </h2>
                <BarChart
                  items={(languages.map((l) => ({
                    name: l.name,
                    value: l.value,
                    color: l.color,
                  })) as Array<{ name: string; value: number; color: string }>)}
                  valueFormat={(v) => v + "%"}
                />
                <p className="mt-3 font-mono text-[11px] text-ink-4">
                  {languages.length} file types · measured from {totalFiles} tracked files
                </p>
              </div>

              <div className="grid gap-px overflow-hidden rounded-[16px] border border-border bg-border">
                <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
                  <div className="text-center">
                    <p className="font-mono text-[11px] text-ink-4">open issues</p>
                    <p className="display mt-1 text-[26px] leading-none text-ember]">{fmt(openIssues ?? 0)}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">awaiting triage</p>
                  </div>
                  <div className="text-center">
                    <p className="font-mono text-[11px] text-ink-4">open PRs</p>
                    <p className="display mt-1 text-[26px] leading-none text-amber-500">{fmt(openPrs ?? 0)}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">in flight</p>
                  </div>
                  <div className="text-center">
                    <p className="font-mono text-[11px] text-ink-4">files</p>
                    <p className="display mt-1 text-[26px] leading-none text-[#9db4a8]">{fmt(totalFiles)}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">
                      {fmt(Math.round(totalBytes / 1024))} KB tracked
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="font-mono text-[11px] text-ink-4">largest type</p>
                    <p className="display mt-1 text-[26px] leading-none text-[#4aa06e]">{mix[0]?.name ?? "—"}</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-ink-4">from the GitHub API</p>
                  </div>
                </div>
              </div>

              <div className="panel p-6">
                <h2 className="flex items-center gap-2 font-semibold text-ink-1">
                  <Download className="size-4 text-[#5a6b7a]" />
                  open data
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                  The same numbers that power this page are the ones the owner
                  publishes on GitHub. No keys, no sign-in, no writes — the
                  metric set of the free coding agent.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    ["open issues", fmt(openIssues ?? 0)],
                    ["open prs", fmt(openPrs ?? 0)],
                    ["stars", fmt(stars ?? 0)],
                    ["forks", fmt(forks ?? 0)],
                  ].map(([label, value]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1.5 font-mono text-[12px] text-ink-2"
                    >
                      {label}
                      <span className="font-mono text-[11px] text-ink-4">{value}</span>
                      <ArrowRight className="size-3 text-ink-4/30" />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <p className="mt-10 font-mono text-[10px] text-ink-4 uppercase tracking-[0.1em]">
          metrics are read-only, from the public GitHub API
        </p>
      </div>
    </AppShell>
  );
}
