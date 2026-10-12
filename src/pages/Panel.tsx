// Public issues & PRs dashboard.
//
// A single read-only surface for the public repo state: the open issues and
// draft pull requests in one list, the top contributors, the label breakdown
// and the oldest-open threads. Everything is fetched from the GitHub REST API
// and nothing is written, cached in the repo folder, or fed through the
// existing api.ts seam.
//
// Public route: no auth, no keys, no backend.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AppShell } from "@/components/AppShell";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Filter,
  GitBranch,
  GitPullRequest,
  GitPullRequestClosed,
  ListTodo,
  Search,
  Star,
  Users,
} from "lucide-react";
import type { FreebuffIssue, FreebuffPr, FreebuffRepo } from "@/lib/frebbuff-data";
import { fetchFreebuffData, sortIssues, sortPrs, mergedAt } from "@/lib/frebbuff-data";

const LABEL_COLORS: Record<string, string> = {
  bug: "bg-[#c85a50] text-white",
  "enhancement": "bg-[#4aa06e] text-white",
  documentation: "bg-[#5a6b7a] text-white",
  "good first issue": "bg-[rgba(74,160,110,0.16)] text-[#4aa06e]",
  "help wanted": "bg-[rgba(157,180,168,0.16)] text-[#9db4a8]",
  question: "bg-[rgba(200,90,80,0.14)] text-[#c85a50]",
  maintenance: "bg-[#5a6b7a] text-white",
  hacktoberfest: "bg-[#b388ff] text-white",
};

function labelsOf(raw: unknown): { name: string }[] {
  if (Array.isArray(raw)) return raw as { name: string }[];
  return [];
}

function labelClass(name: string): string {
  return LABEL_COLORS[name.toLowerCase()] ?? "bg-surface-2 text-ink-4";
}

interface PanelIssue {
  id: string;
  number: number;
  title: string;
  user: string;
  createdAt: string;
  comments: number;
  state: "open" | "closed";
  labels: string[];
  html_url: string;
}

interface PanelPr {
  id: string;
  number: number;
  title: string;
  user: string;
  createdAt: string;
  mergedAt: string | null;
  comments: number;
  state: "open" | "closed";
  labels: string[];
  html_url: string;
}

type PanelRow = PanelIssue | PanelPr;

function stateClass(s: "open" | "closed"): string {
  return s === "open"
    ? "bg-[rgba(74,160,110,0.14)] text-[#4aa06e]"
    : "bg-[rgba(200,90,80,0.12)] text-[#c85a50]";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today.getTime() - date.getTime()) / 86400000;
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} weeks ago`;
  if (diff < 365) return `${Math.floor(diff / 30)} months ago`;
  return `${Math.floor(diff / 365)} years ago`;
}

function PanelCard({
  title,
  icon,
  value,
  sub,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "ember" | "teal";
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">{title}</p>
          <p className={`display mt-2 text-[34px] leading-none ${tone === "ember" ? "text-ember" : tone === "teal" ? "text-[#4aa06e]" : "text-ink-1"}`}>
            {value}
          </p>
          {sub && <p className="mt-1.5 font-mono text-[11px] text-ink-4">{sub}</p>}
        </div>
        <div className={`flex size-10 items-center justify-center rounded-[12px] border border-border bg-surface-2 ${tone === "ember" ? "bg-ember-soft" : ""}`}>
          {icon}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function RowCard({
  row,
}: {
  row: PanelRow;
}) {
  const isPr = "mergedAt" in row;
  const date = isPr && row.mergedAt
    ? row.mergedAt
    : row.createdAt;

  return (
    <Link
      to={isPr ? row.html_url : row.html_url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-surface-2 group"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2">
        {isPr ? (
          row.state === "open" ? (
            <GitPullRequest className="size-3.5 text-ember" />
          ) : (
            <GitPullRequestClosed className="size-3.5 text-[#c85a50]" />
          )
        ) : (
          <GitBranch className="size-3.5 text-[#9db4a8]" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] ${stateClass(row.state)}`}>
            <Check className="size-3" />
            {row.state === "open" ? "open" : "closed"}
          </span>
          {row.labels.map((l) => (
            <span
              key={l}
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-[0.04em] uppercase ${labelClass(l)}`}
            >
              {l}
            </span>
          ))}
        </div>
        <p className="truncate font-mono text-[13.5px] text-ink-1">{row.title}</p>
        <p className="mt-0.5 font-mono text-[11px] text-ink-4">
          by {row.user} · {formatDate(date)}
        </p>
      </div>

      {isPr && row.mergedAt && (
        <span className="font-mono text-[10.5px] text-[#4aa06e]">merged {formatDate(row.mergedAt)}</span>
      )}

      <ArrowRight className="size-3 shrink-0 text-ink-4/30 transition-colors group-hover:text-ember" />
    </Link>
  );
}

interface Props {
  issues?: FreebuffIssue[];
  prs?: FreebuffPr[];
}

function toIssueView(i: FreebuffIssue): PanelIssue {
  return {
    id: `issue-${i.number}`,
    number: i.number,
    title: i.title,
    user: i.user.login,
    createdAt: i.created_at,
    comments: i.comments,
    state: i.state,
    labels: labelsOf(i.labels).map((l) => l.name),
    html_url: i.html_url,
  };
}

function toPrView(p: FreebuffPr): PanelPr {
  return {
    id: `pr-${p.number}`,
    number: p.number,
    title: p.title,
    user: p.user.login,
    createdAt: p.created_at,
    mergedAt: mergedAt(p),
    comments: p.comments,
    state: p.state,
    labels: labelsOf(p.labels).map((l) => l.name),
    html_url: p.html_url,
  };
}

export default function Panel({ issues, prs }: Props) {
  const [tab, setTab] = useState<"all" | "issues" | "prs">("all");
  const [query, setQuery] = useState("");
  const [filterLabel, setFilterLabel] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [repoStats, setRepoStats] = useState<FreebuffRepo | null>(null);

  const [allIssues, setAllIssues] = useState<PanelIssue[]>(
    (issues ?? []).map(toIssueView),
  );
  const [allPrs, setAllPrs] = useState<PanelPr[]>((prs ?? []).map(toPrView));

  // Public route: pull the open issues and PRs from the GitHub REST API.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchFreebuffData();
        if (cancelled) return;
        setAllIssues(sortIssues(d.issues.items).map(toIssueView));
        setAllPrs(sortPrs(d.prs.items).map(toPrView));
        setRepoStats(d.repo);
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

  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    const label = filterLabel.trim().toLowerCase();
    return allIssues.filter((i) => {
      const matchesQ =
        !q ||
        i.title.toLowerCase().includes(q) ||
        i.user.toLowerCase().includes(q);
      const matchesL = !label || i.labels.some((l) => l.toLowerCase().includes(label));
      return matchesQ && matchesL;
    });
  }, [allIssues, query, filterLabel]);

  const filteredPrs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const label = filterLabel.trim().toLowerCase();
    return allPrs.filter((p) => {
      const matchesQ =
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q);
      const matchesL = !label || p.labels.some((l) => l.toLowerCase().includes(label));
      return matchesQ && matchesL;
    });
  }, [allPrs, query, filterLabel]);

  const openIssueRows = filteredIssues.filter((i) => i.state === "open");
  const openPrRows = filteredPrs.filter((p) => p.state === "open");

  // Tally labels across every open issue / pr.
  const labelTally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of allIssues) for (const l of i.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    for (const p of allPrs) for (const l of p.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [allIssues, allPrs]);

  // Top contributors by number of open threads.
  const contributors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of allIssues) counts.set(i.user, (counts.get(i.user) ?? 0) + 1);
    for (const p of allPrs) counts.set(p.user, (counts.get(p.user) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [allIssues, allPrs]);

  const tabs = [
    { key: "all" as const, label: "all" },
    { key: "issues" as const, label: "issues" },
    { key: "prs" as const, label: "prs" },
  ] as const;

  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <p className="font-mono text-xs text-ink-4">Loading live GitHub data…</p>
        </div>
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl p-6 pt-16">
          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-ember">Live data unavailable</p>
            <h1 className="mt-3 text-xl font-semibold text-ink-1">GitHub did not return current data</h1>
            <p className="mt-2 text-sm text-ink-3">{loadError}</p>
            <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Retry live request</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="scrollbar-thin h-full overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-5 pt-9 pb-16">
          {/* Hub */}
          <div className="mb-12 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mono-label mb-2 font-mono text-[11px] tracking-[0.1em] text-ink-4 uppercase">
                public dashboard
              </p>
              <h1 className="display mt-2 text-[clamp(32px,5vw,62px)] leading-[1.08] text-ink-1">
                <span className="mr-2 font-mono text-[12px] tracking-[0.14em] text-ember]">/browser-use</span>
                jev-ultrafast
              </h1>
              <p className="mt-3 max-w-[56ch] text-[14.5px] leading-[1.75] text-ink-2">
                The public repo state: open issues, draft pull requests, labels,
                and the people talking in them. Everything here is read-only and
                no token is required.
              </p>
            </div>

            <div className="flex gap-2">
              <Link to="/dashboard" className="btn-ghost">
                <Star className="size-3.5" />
                Stars & forks
              </Link>
              <Link to="/web" className="btn-primary">
                <ListTodo className="size-3.5" />
                Files & issues
              </Link>
            </div>
          </div>

          {/* Cards */}
          <div className="grid gap-px overflow-hidden rounded-[16px] border border-border bg-border mb-8 lg:grid-cols-[0.85fr_1.15fr]">
            <PanelCard
              title="open issues"
              icon={<GitBranch className="size-4.5 text-[#9db4a8]" />}
              value={openIssueRows.length}
              sub={`of ${allIssues.length} total threads`}
              tone="neutral"
            >
              <p className="text-right font-mono text-[11px] text-ink-4">{contributors.length} authors in loaded threads</p>
            </PanelCard>

            <PanelCard
              title="draft pull requests"
              icon={<GitPullRequest className="size-4.5 text-ember" />}
              value={openPrRows.length}
              sub={`of ${allPrs.length} total threads`}
              tone="ember"
            >
              <p className="text-right font-mono text-[11px] text-ink-4">{repoStats ? `${repoStats.stars.toLocaleString()} stars` : "—"}</p>
            </PanelCard>

            <PanelCard
              title="labels"
              icon={<ListTodo className="size-4.5 text-[#5a6b7a]" />}
              value={labelTally.length}
              sub="across all threads"
              tone="neutral"
            >
              <div className="flex flex-wrap gap-2">
                {labelTally.slice(0, 8).map(([l, c]) => (
                  <span
                    key={l}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] ${labelClass(l)}`}
                  >
                    {l}
                    <span className="font-mono text-[10px] opacity-60">{c}</span>
                  </span>
                ))}
              </div>
            </PanelCard>

            <PanelCard
              title="top contributors"
              icon={<Users className="size-4.5 text-[#5a6b7a]" />}
              value={contributors[0]?.[1] ?? 0}
              sub={`${contributors.length} authors in loaded threads`}
              tone="neutral"
            >
              <div className="flex flex-wrap gap-2">
                {contributors.map(([name, c]) => (
                  <span
                    key={name}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 font-mono text-[11px] text-ink-2"
                  >
                    <span className="size-1.5 rounded-full bg-[#5a6b7a]" />
                    {name}
                    <span className="font-mono text-[10px] text-ink-4">{c}</span>
                  </span>
                ))}
              </div>
            </PanelCard>
          </div>

          {/* Filters */}
          <div className="panel p-5 mb-8">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="search title, user, body…"
                  className="w-full rounded-lg border border-border bg-surface-1 py-2 pl-8 pr-3 text-[13px] text-ink-1 outline-none placeholder:text-ink-4 focus:border-ember/50"
                />
              </div>

              <div className="relative">
                <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
                <select
                  value={filterLabel}
                  onChange={(e) => setFilterLabel(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-1 py-2 pl-8 pr-3 text-[13px] text-ink-1 outline-none appearance-none focus:border-ember/50"
                >
                  <option value="">all labels</option>
                  {labelTally.slice(0, 12).map(([l]) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
              </div>

              <div className="ml-auto flex gap-1">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] transition-colors ${
                      tab === t.key
                        ? "border-line-strong bg-surface-2 text-ink-1 shadow-[inset_0_1px_0_0_var(--spec)]"
                        : "border-border text-ink-4 hover:border-[rgba(244,241,234,0.2)] hover:text-ink-2"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Thread list */}
          <div className="space-y-6">
            {tab === "all" && (
              <>
                {openIssueRows.length > 0 && (
                  <section className="panel p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <GitBranch className="size-4 text-[#9db4a8]" />
                      <h2 className="font-semibold text-ink-1">open issues</h2>
                      <span className="font-mono text-[11px] text-ink-4">{openIssueRows.length}</span>
                    </div>
                    <div className="max-h-[480px] space-y-1 overflow-y-auto scrollbar-thin">
                      {openIssueRows.map((r) => (
                        <RowCard key={r.id} row={r} />
                      ))}
                    </div>
                  </section>
                )}

                {openPrRows.length > 0 && (
                  <section className="panel p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <GitPullRequest className="size-4 text-ember" />
                      <h2 className="font-semibold text-ink-1">open pull requests</h2>
                      <span className="font-mono text-[11px] text-ink-4">{openPrRows.length}</span>
                    </div>
                    <div className="max-h-[480px] space-y-1 overflow-y-auto scrollbar-thin">
                      {openPrRows.map((r) => (
                        <RowCard key={r.id} row={r} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === "issues" && (
              <section className="panel p-5">
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="size-4 text-[#9db4a8]" />
                  <h2 className="font-semibold text-ink-1">issues</h2>
                  <span className="font-mono text-[11px] text-ink-4">{filteredIssues.length}</span>
                </div>
                <div className="max-h-[480px] space-y-1 overflow-y-auto scrollbar-thin">
                  {filteredIssues.map((r) => (
                    <RowCard key={r.id} row={r} />
                  ))}
                </div>
              </section>
            )}

            {tab === "prs" && (
              <section className="panel p-5">
                <div className="mb-3 flex items-center gap-2">
                  <GitPullRequest className="size-4 text-ember" />
                  <h2 className="font-semibold text-ink-1">pull requests</h2>
                  <span className="font-mono text-[11px] text-ink-4">{filteredPrs.length}</span>
                </div>
                <div className="max-h-[480px] space-y-1 overflow-y-auto scrollbar-thin">
                  {filteredPrs.map((r) => (
                    <RowCard key={r.id} row={r} />
                  ))}
                </div>
              </section>
            )}
          </div>

          {openIssueRows.length === 0 && openPrRows.length === 0 && (
            <div className="panel p-12 text-center">
              <p className="mono-label mb-2 font-mono text-[11px] text-ink-4 uppercase">no rows</p>
              <p className="font-mono text-[13px] text-ink-4">no threads match your search.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
