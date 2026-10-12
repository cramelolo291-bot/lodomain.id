// Projects — the working dashboard.
//
// One surface for the state of the thing you are building: the repository and
// its live numbers, open issues and PRs, the file tree you can actually open,
// and the files the chat has produced. Everything reads from the same live
// data layer the rest of the public pages use, so nothing here is a mock.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft, FileText, GitBranch, GitFork, Loader2, Search, Star,
  MessageSquare, FolderOpen, CircleDot, Download,
} from "lucide-react";
import { loadRepo, readFile, type RepoSnapshot } from "@/lib/repo-tools";
import { listArtifacts, exportBundle, download } from "@/lib/artifacts";

type Tab = "issues" | "prs" | "files" | "artifacts";

export default function Projects() {
  const [snap, setSnap] = useState<RepoSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("issues");
  const [q, setQ] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openBody, setOpenBody] = useState<string | null>(null);
  const [arts, setArts] = useState(listArtifacts());

  useEffect(() => {
    let dead = false;
    loadRepo()
      .then((s) => !dead && setSnap(s))
      .catch((e) => !dead && setErr(e instanceof Error ? e.message : String(e)));
    return () => { dead = true; };
  }, []);



  function selectTab(next: Tab) {
    setTab(next);
    if (next === "artifacts") setArts(listArtifacts());
  }

  async function open(path: string) {
    setOpenPath(path);
    setOpenBody(null);
    const body = await readFile(path);
    if (body === null) setOpenBody("(binary or unreadable)");
    else setOpenBody(body);
  }

  const needle = q.trim().toLowerCase();
  const issues = useMemo(
    () => (snap ? snap.issues.filter((i) => !needle || i.title.toLowerCase().includes(needle)) : []),
    [snap, needle],
  );
  const prs = useMemo(
    () => (snap ? snap.prs.filter((p) => !needle || p.title.toLowerCase().includes(needle)) : []),
    [snap, needle],
  );
  const files = useMemo(
    () => (snap ? snap.files.filter((f) => !needle || f.path.toLowerCase().includes(needle)) : []),
    [snap, needle],
  );

  const stats = snap
    ? [
        { label: "stars", value: snap.repo.stars, icon: Star, color: "text-amber-500" },
        { label: "forks", value: snap.repo.forks, icon: GitFork, color: "text-ink-2" },
        { label: "open issues", value: snap.repo.openIssues, icon: CircleDot, color: "text-[#c85a50]" },
        { label: "open PRs", value: snap.repo.prs, icon: GitBranch, color: "text-[#4aa06e]" },
        { label: "files", value: snap.files.length, icon: FileText, color: "text-ember" },
        { label: "chat files", value: arts.length, icon: MessageSquare, color: "text-[#b388ff]" },
      ]
    : [];

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <Link to="/" className="btn-ghost px-2 py-1" aria-label="Back"><ArrowLeft className="size-4" /></Link>
        <span className="text-[14px] font-medium tracking-tight text-ink-1">Projects</span>
        <span className="mono-label hidden text-[9px] sm:inline">dashboard</span>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/studio/" className="btn-primary px-2.5 py-1 text-[12px]">Open Studio</Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
          {/* Repo identity + live stats */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="mono-label font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
                project
              </p>
              <h1 className="display mt-1.5 text-[clamp(22px,3vw,34px)] text-ink-1">
                <span className="font-mono text-ink-4">/{snap?.repo.owner ?? "…"}</span>{" "}
                {snap?.repo.name ?? ""}
              </h1>
              {snap && <p className="mt-2 max-w-[70ch] text-[13.5px] leading-[1.7] text-ink-2">{snap.repo.description}</p>}
            </div>
            <a
              href={snap?.repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-2.5 py-1 text-[12px]"
            >
              Open on GitHub
            </a>
          </div>

          {/* Stats */}
          <div className="mt-6 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            {err ? (
              <div className="col-span-full bg-surface-1 p-4 font-mono text-[12px] text-[#c85a50]">
                {err}
              </div>
            ) : !snap ? (
              <div className="col-span-full flex items-center gap-2 bg-surface-1 p-4 font-mono text-[12px] text-ink-4">
                <Loader2 className="size-3.5 animate-spin" /> loading live repository data…
              </div>
            ) : (
              stats.map((s) => (
                <div key={s.label} className="bg-surface-1 px-4 py-3.5">
                  <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
                    <s.icon className={`size-3 ${s.color}`} /> {s.label}
                  </p>
                  <p className="display mt-1 text-[24px] leading-none text-ink-1">{fmt(s.value)}</p>
                </div>
              ))
            )}
          </div>

          {/* Tabs */}
          <div className="mt-8 flex flex-wrap items-center gap-2 border-b border-line pb-2">
            {(["issues", "prs", "files", "artifacts"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => selectTab(t)}
                className={`rounded-[9px] px-3 py-1.5 font-mono text-[12px] transition-colors ${
                  tab === t ? "bg-surface-3 text-ink-1" : "text-ink-4 hover:text-ink-2"
                }`}
              >
                {t}
                {t === "issues" && snap ? ` ${snap.issues.length}` : ""}
                {t === "prs" && snap ? ` ${snap.prs.length}` : ""}
                {t === "files" && snap ? ` ${snap.files.length}` : ""}
                {t === "artifacts" ? ` ${arts.length}` : ""}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-[9px] border border-line px-2.5 py-1">
                <Search className="size-3 text-ink-4" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="filter…"
                  className="w-36 bg-transparent font-mono text-[12px] text-ink-1 outline-none placeholder:text-ink-4"
                />
              </div>
              {tab === "artifacts" && arts.length > 0 && (
                <button
                  type="button"
                  onClick={() => download("lolo-artifacts.txt", exportBundle())}
                  className="btn-ghost px-2 py-1 text-[12px]"
                >
                  <Download className="mr-1 inline size-3" /> export
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              {tab === "issues" && <IssueList items={issues} kind="issues" />}
              {tab === "prs" && <IssueList items={prs} kind="prs" />}
              {tab === "files" && (
                <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                  {files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => void open(f.path)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <FolderOpen className="size-3.5 shrink-0 text-ink-4" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-1">{f.path}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-4">{fmt(f.size)} B</span>
                      </button>
                    </li>
                  ))}
                  {files.length === 0 && <li className="px-3 py-4 font-mono text-[12px] text-ink-4">no files match</li>}
                </ul>
              )}
              {tab === "artifacts" && (
                <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                  {arts.map((a) => (
                    <li key={a.id} className="px-3 py-2">
                      <p className="font-mono text-[12px] text-ink-1">{a.path}</p>
                      <p className="font-mono text-[10.5px] text-ink-4">{a.body.length} chars · {new Date(a.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                  {arts.length === 0 && (
                    <li className="px-3 py-4 font-mono text-[12px] text-ink-4">
                      No files yet. Create one in Studio.
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* File preview */}
            <div className="min-w-0">
              <div className="overflow-hidden rounded-[12px] border border-line">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <FileText className="size-3 text-ink-4" />
                  <span className="truncate font-mono text-[11.5px] text-ink-2">
                    {openPath ?? "select a file"}
                  </span>
                </div>
                <pre className="max-h-[70vh] overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
                  {openBody ?? (openPath ? "loading…" : "Pick a file from the Files tab to read its real contents.")}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function IssueList({
  items,
  kind,
}: {
  items: Array<{ number: number; title: string; user: string; createdAt: string; comments: number; labels: string[] }>;
  kind: "issues" | "prs";
}) {
  if (items.length === 0) {
    return <p className="font-mono text-[12px] text-ink-4">nothing to show</p>;
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
      {items.map((i) => (
        <li key={`${kind}-${i.number}`} className="px-3 py-2.5 transition-colors hover:bg-surface-2">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 font-mono text-[11px] text-ink-4">#{i.number}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-ink-1">{i.title}</p>
              <p className="mt-1 font-mono text-[10.5px] text-ink-4">
                {i.user} · {i.createdAt.slice(0, 10)} · {i.comments} comments
              </p>
              {i.labels.length > 0 && (
                <p className="mt-1 font-mono text-[10.5px] text-ink-3">{i.labels.join(" · ")}</p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}