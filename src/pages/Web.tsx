// Freebuff Web, rebuilt: describe what you want, get a working app on its own
// URL.
//
// The shape is borrowed from freebuff.com/web — a grid of projects you own,
// each with its own URL, and one composer that takes you straight into a
// build. No onboarding tour, no template gallery, no "what do you want to
// create?" chips before you have typed anything.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  ArrowUp,
  Clock,
  ExternalLink,
  Globe,
  Plus,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { api, MODELS } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL = MODELS[0]!.id;

/** Suggestions shown only in the empty state, so they never crowd a draft. */
const STARTERS = [
  "Toko online dengan keranjang dan checkout",
  "Dasbor analitik dengan grafik penjualan",
  "Halaman login dengan validasi form",
  "API CRUD untuk blog dengan komentar",
];

function projectSlug(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  const base = words.join("-") || "my-app";
  const suffix = Math.random().toString(36).slice(2, 5);
  return `${base}-${suffix}`;
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Web() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; url: string; updatedAt: number; files: number }>
  >([]);
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void (async () => {
      const [convs, project] = await Promise.all([
        api.listConversations(),
        api.getProject(),
      ]);
      const fileCount = Object.keys(project.files).length;
      setProjects(
        convs.map((c, i) => ({
          id: c.id,
          name: projectSlug(c.title),
          url: `${projectSlug(c.title)}.lolo.app`,
          updatedAt: c.updatedAt,
          files: i === 0 ? fileCount : 0,
        })),
      );
    })();
  }, []);

  const canSend = prompt.trim().length > 2 && !busy;

  async function start() {
    if (!canSend) return;
    setBusy(true);
    try {
      const conversation = await api.createConversation("lolo", DEFAULT_MODEL);
      await api.runTurn({
        conversationId: conversation.id,
        prompt: prompt.trim(),
        agent: "lolo",
        model: DEFAULT_MODEL,
      });
      navigate(`/web/${conversation.id}`);
    } finally {
      setBusy(false);
    }
  }

  const sorted = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1100px] px-5 pb-24 pt-10 sm:px-8">
        {/* Composer */}
        <div className="mx-auto max-w-[720px]">
          <h1 className="font-display text-[clamp(30px,4.5vw,44px)] leading-[1.1] tracking-[-0.02em] text-ink-1">
            What do you want to build?
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-3">
            Describe it. Lolo reads the request, writes the code, and puts the
            result on its own URL.
          </p>

          <div className="mt-7 rounded-[16px] border border-border bg-surface-1 p-2 transition-colors focus-within:border-ember/40">
            <textarea
              ref={textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void start();
                }
              }}
              rows={3}
              placeholder="Ask Lolo…"
              className="w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-ink-1 outline-none placeholder:text-ink-4"
            />
            <div className="flex items-center gap-2 px-2 pb-1">
              <span className="font-mono text-[10.5px] text-ink-4">
                ⌘↵ to build
              </span>
              <button
                type="button"
                onClick={() => void start()}
                disabled={!canSend}
                aria-label="Build"
                className="ml-auto flex size-8 items-center justify-center rounded-full bg-ember text-[#17120f] transition-all hover:bg-[var(--accent-warm-hover)] disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>

          {prompt.trim().length <= 2 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPrompt(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:border-ember/40 hover:text-ink-1"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Projects */}
        <div className="mt-16">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-[13px] font-medium text-ink-2">Your projects</h2>
            <span className="font-mono text-[11px] text-ink-4">
              {sorted.length}
            </span>
          </div>

          {sorted.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-border px-6 py-14 text-center">
              <Globe className="mx-auto size-5 text-ink-4" />
              <p className="mt-3 text-[14px] text-ink-2">
                Nothing built yet.
              </p>
              <p className="mt-1.5 text-[13px] text-ink-4">
                Describe something above and it will show up here with its own
                URL.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((p) => (
                <Link
                  key={p.id}
                  to={`/web/${p.id}`}
                  className="group flex flex-col rounded-[14px] border border-border bg-surface-1 p-4 transition-colors hover:border-ember/35"
                >
                  <div className="flex items-start gap-2.5">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-1">
                      {p.name}
                    </span>
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <span className="mt-3 flex items-center gap-1.5 truncate font-mono text-[11.5px] text-ink-3">
                    <ExternalLink size={11} className="shrink-0" />
                    {p.url}
                  </span>

                  <span className="mt-auto flex items-center gap-2 pt-4 font-mono text-[10.5px] text-ink-4">
                    <Clock size={10.5} />
                    {timeAgo(p.updatedAt)}
                    {p.files > 0 && (
                      <>
                        <span>·</span>
                        {p.files} files
                      </>
                    )}
                  </span>
                </Link>
              ))}

              <button
                type="button"
                onClick={() => textarea.current?.focus()}
                className={cn(
                  "flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-[14px]",
                  "border border-dashed border-border text-ink-4 transition-colors",
                  "hover:border-ember/35 hover:text-ink-2",
                )}
              >
                <Plus className="size-4" />
                <span className="text-[13px]">New project</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
