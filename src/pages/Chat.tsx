// Signed-in, discussion-style view of the open issues and pull requests in the
// upstream browser-agent repo.
//
// This is a read-only discussion UI; it does not write to the upstream repository.
// Each issue or PR is a thread you can browse; the list is filtered by the
// search box, and clicking one opens the thread detail. The page uses the live
// GitHub API and does not write to the backend or upstream repository.
//
// All data is pulled from the GitHub REST API.

import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router";
import { AppShell } from "@/components/AppShell";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Code2,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Search,
  TrendingUp,
} from "lucide-react";
import type { FreebuffIssue, FreebuffPr } from "@/lib/frebbuff-data";
import { fetchFreebuffData, sortIssues, sortPrs } from "@/lib/frebbuff-data";

const LABEL_CLASSES: Record<string, string> = {
  bug: "bg-[#c85a50] text-white",
  enhancement: "bg-[#4aa06e] text-white",
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
  return LABEL_CLASSES[name.toLowerCase()] ?? "bg-surface-2 text-ink-4";
}

interface ThreadView {
  id: string;
  type: "issue" | "pr";
  number: number;
  title: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
  state: "open" | "closed";
  labels: string[];
  html_url: string;
  body?: string;
}

function toThreads(issues: FreebuffIssue[], prs: FreebuffPr[]): ThreadView[] {
  const root: ThreadView[] = [];

  for (const i of issues) {
    root.push({
      id: `issue-${i.number}`,
      type: "issue",
      number: i.number,
      title: i.title,
      user: i.user.login,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      comments: i.comments,
      state: i.state,
      labels: labelsOf(i.labels).map((l) => l.name),
      html_url: i.html_url,
      body: i.body ?? "",
    });
  }

  for (const p of prs) {
    root.push({
      id: `pr-${p.number}`,
      type: "pr",
      number: p.number,
      title: p.title,
      user: p.user.login,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      comments: p.comments,
      state: p.state,
      labels: labelsOf(p.labels).map((l) => l.name),
      html_url: p.html_url,
      body: p.body ?? "",
    });
  }

  return root.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/** Minimal markdown renderer for the issue body. */
function renderBody(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} />;
    if (line.startsWith("```")) {
      return (
        <pre
          key={i}
          className="my-3 overflow-x-auto rounded-lg border border-border bg-[var(--bg-2)] p-4 font-mono text-[12px] leading-[1.7] text-ink-2"
        >
          {trimmed}
        </pre>
      );
    }
    if (/^\s*#/.test(line)) {
      const Tag = line.startsWith("###") ? "h3" : line.startsWith("##") ? "h2" : "h1";
      const sizeClass = line.startsWith("##") ? "sm:text-[20px]" : line.startsWith("###") ? "text-[15px]" : "text-[16px]";
      return (
        <Tag
          key={i}
          className={`mt-4 text-${sizeClass} font-semibold text-ink-1`}
        >
          {trimmed.slice(line.search(/\s/) + 1)}
        </Tag>
      );
    }
    if (/^\s*[-*]\s/.test(line)) {
      return (
        <p key={i} className="mt-2 flex gap-2.5">
          <span className="mt-[8px] size-1 shrink-0 rounded-full bg-ink-4" />
          {renderInline(trimmed.slice(2))}
        </p>
      );
    }
    if (/^\s*\d+\.\s/.test(line)) {
      return (
        <p key={i} className="mt-2 flex gap-2.5">
          <span className="mt-[8px] size-1 shrink-0 rounded-full bg-ink-4" />
          {renderInline(trimmed.slice(3))}
        </p>
      );
    }
    return <p key={i} className="leading-[1.75] text-ink-2">{renderInline(trimmed)}</p>;
  });
}

function renderInline(value: string): React.ReactNode {
  return value.split(/(`[^`]+`|__[^*]+__|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, k) => {
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={k}
          className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ember"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={k} className="font-semibold text-ink-1">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={k}>{p}</span>;
  });
}

interface Props {
  /** Optional pre-seeded threads. The public route fetches its own. */
  threads?: ThreadView[];
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

function stateBadge(state: "open" | "closed"): string {
  return state === "open"
    ? "bg-[rgba(74,160,110,0.14)] text-[#4aa06e]"
    : "bg-[rgba(200,90,80,0.12)] text-[#c85a50]";
}

function ThreadCard({ thread }: { thread: ThreadView }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2">
          {thread.type === "pr" ? (
            <GitPullRequest className="size-4 text-[#4aa06e]" />
          ) : (
            <GitBranch className="size-4 text-ember" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] ${stateBadge(thread.state)}`}
            >
              <Check className="size-3" />
              {thread.state === "open" ? "open" : "closed"}
            </span>
            {thread.labels.map((l) => (
              <span
                key={l}
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] uppercase ${labelClass(l)}`}
              >
                {l}
              </span>
            ))}
          </div>

          <h3 className="mt-1 truncate font-mono text-[15px] text-ink-1">
            {thread.title}
          </h3>

          <p className="mt-1 truncate font-mono text-[11.5px] text-ink-4">
            by {thread.user} · {formatDate(thread.createdAt)} · {thread.comments} comments
          </p>
        </div>

        <ChevronDown
          className={`size-3.5 shrink-0 text-ink-4 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4">
          <p className="scrollbar-thin max-h-72 overflow-y-auto text-[13.5px] leading-[1.8] text-ink-2">
            {renderBody(thread.body ?? "")}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-ink-4">
              created {formatDate(thread.createdAt)}
            </span>
            {thread.updatedAt !== thread.createdAt && (
              <span className="font-mono text-[10px] text-ink-4">
                updated {formatDate(thread.updatedAt)}
              </span>
            )}
            <span className="font-mono text-[10.5px] text-[#4aa06e]">
              {thread.comments} {thread.comments === 1 ? "comment" : "comments"}
            </span>
            <Link
              to={thread.html_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-ember transition-colors hover:text-ember/80"
            >
              <ArrowRight className="size-3" />
              GitHub
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Chat({ threads: seeded }: Props) {
  const [threads, setThreads] = useState<ThreadView[]>(seeded ?? []);
  const [query, setQuery] = useState("");
  const [activeId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  // Public route: read the open issues and PRs straight from the GitHub API.
  useEffect(() => {
    if (seeded && seeded.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchFreebuffData();
        if (cancelled) return;
        setThreads(toThreads(sortIssues(d.issues.items), sortPrs(d.prs.items)));
      } catch {
        // The list stays empty and the page still renders; the copy above the
        // fold explains what this view is either way.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seeded]);

  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.body ?? "").toLowerCase().includes(q) ||
      t.user.toLowerCase().includes(q),
    );
  }, [threads, query]);

  const openThreads = visibleThreads.filter((t) => t.state === "open");
  const closedThreads = visibleThreads.filter((t) => t.state === "closed");

  return (
    <AppShell>
      <div className="flex h-full w-full gap-3 px-3 pt-3 sm:px-5 sm:pt-4 2xl:px-7">
        {/* History rail */}
        <aside className={`scrollbar-thin absolute inset-y-0 left-0 z-40 flex w-[320px] shrink-0 flex-col overflow-y-auto pb-4 pr-2 transition-transform duration-300 lg:relative lg:z-auto lg:translate-x-0 ${railOpen ? "translate-x-0" : "-translate-x-full"}`}>
          {railOpen && (
            <button
              type="button"
              aria-label="Tutup daftar"
              onClick={() => setRailOpen(false)}
              className="fixed inset-0 -z-10 cursor-default bg-black/40 backdrop-blur-[2px] lg:hidden"
            />
          )}

          <div className="flex items-center gap-2 px-3 pt-2">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex size-[26px] items-center justify-center">
                <svg className="size-[58%] overflow-hidden rounded-[16%] bg-ember">
                  <rect className="absolute inset-[12%] rounded-[10%] bg-background" />
                </svg>
              </div>
              <span className="text-[14px] font-medium tracking-tight text-ink-1">
                jev-ultrafast
              </span>
            </Link>
          </div>

          <div className="mt-3 flex items-center gap-2 px-3">
            <Search className="size-3.5 shrink-0 text-ink-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari issue/PR…"
              className="w-full rounded-lg border border-transparent bg-surface-2/60 py-2 pl-8 pr-3 text-[13px] text-ink-1 outline-none transition-colors placeholder:text-ink-4 focus:border-line-strong"
            />
          </div>

          <p className="mono-label mt-5 mb-2 px-3">threads</p>

          <div className="space-y-0.5">
            {visibleThreads.length === 0 && (
              <p className="px-3 py-2 text-[12.5px] leading-relaxed text-ink-4">
                {query ? "Tidak ada yang cocok." : "Belum ada thread."}
              </p>
            )}

            {openThreads.map((t) => (
              <ThreadCard key={t.id} thread={t} />
            ))}

            {closedThreads.length > 0 && (
              <div className="mt-2 px-3">
                <p className="mono-label mb-2 px-3 text-[11px] uppercase tracking-[0.1em] text-ink-4">
                  closed ({closedThreads.length})
                </p>
                {closedThreads.map((t) => (
                  <ThreadCard key={t.id} thread={t} />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Detail */}
        {activeId ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1">
            <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                className="rounded-full p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
                aria-label="Tutup daftar"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-ember/10">
                  <svg className="size-2.5 text-ember" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="truncate text-[13px] text-ink-1">
                  {activeId.startsWith("issue-") ? "GitHub Issue" : "GitHub PR"}
                </span>
                <span className="font-mono text-[10.5px] text-ink-4">
                  #{activeId.split("-")[1]}
                </span>
              </div>
            </header>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-7">
              <div className="mx-auto w-full max-w-[780px]">
                {/* placeholder thread body */}
                <div className="space-y-4">
                  <h1 className="display text-[28px] leading-[1.15] text-ink-1">
                    welcome to jev-ultrafast
                  </h1>
                  <p className="max-w-[46ch] text-[14px] leading-[1.7]">
                    This public chat is the open threads of
                    browser-use/jev-ultrafast. The detail view for the active
                    thread is shown in the left rail.
                  </p>
                </div>
              </div>
            </div>

            <footer className="shrink-0 border-t border-border px-4 py-3.5 sm:px-6">
              <div className="mx-auto w-full max-w-[780px]">
                <div className="relative rounded-[12px] border border-border bg-background/50 p-2.5 transition-colors focus-within:border-ember/50">
                  <textarea
                    rows={2}
                    placeholder="Kilang thread di GitHub…"
                    className="scrollbar-thin max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-[14px] leading-[1.6] text-ink-1 outline-none placeholder:text-ink-4"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-ember">#</span>
                    <input
                      placeholder="github.com/browser-use/jev-ultrafast/issues/123"
                      className="flex-1 bg-transparent font-mono text-[12px] text-ink-2 outline-none placeholder:text-ink-4"
                    />
                    <button
                      type="button"
                      className="btn-primary px-3 py-1.5 text-[12px]"
                    >
                      Buka di GitHub
                    </button>
                  </div>
                </div>
              </div>
            </footer>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center border border-border bg-surface-1">
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full border border-border bg-surface-2">
                <MessageSquare className="size-7 text-ember" />
              </div>
              <h1 className="display mt-6 text-[34px] text-ink-1">
                jev-ultrafast Chat
              </h1>
              <p className="mt-3 max-w-[46ch] text-[14px] leading-[1.75] text-ink-3">
                The public threads of browser-use/jev-ultrafast, open for anyone
                to read. The left rail holds the list; this panel is the detail
                view of whichever thread you pick.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link to="/web/" className="btn-ghost">
                  <Code2 className="size-3.5" />
                  File tree
                </Link>
                <Link to="/dashboard/" className="btn-primary">
                  <TrendingUp className="size-3.5" />
                  Analytics
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
