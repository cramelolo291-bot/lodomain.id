import { AppShell } from "@/components/AppShell";
import { api, AGENTS, MODELS, getAgent, getModel } from "@/lib/api";
import { GUARDRAIL_LABELS } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

const WORKSPACE = { repo: "lolo/lolo-ai", branch: "main", port: 3000 };

type Panel = "preview" | "code" | "terminal" | "changes";

const PANELS: Array<{ key: Panel; label: string }> = [
  { key: "preview", label: "Preview" },
  { key: "code", label: "Code" },
  { key: "terminal", label: "Terminal" },
  { key: "changes", label: "Changes" },
];

const SUGGESTIONS = [
  "Bikin skema Postgres untuk gateway agent multi-user",
  "Tambah rate limiting ke endpoint chat",
  "Audit guardrail rules kita, ada yang bolong?",
  "Jelaskan cara pool milih akun yang sehat",
];

/** Minimal markdown with fenced blocks. */
function renderBody(text: string) {
  return text.split(/```/).map((block, i) => {
    if (i % 2 === 1) {
      return (
        <pre
          key={i}
          className="scrollbar-thin my-3 overflow-x-auto rounded-lg border border-border bg-[var(--bg-2)] p-4 font-mono text-[12.5px] leading-[1.7] text-ink-2"
        >
          {block.trim()}
        </pre>
      );
    }
    return (
      <div key={i} className="space-y-2.5">
        {block.split("\n").map((line, j) => {
          if (!line.trim()) return null;
          const heading = /^\s*\*\*(.+?)\*\*/.exec(line);
          const bullet = /^\s*[-*]\s/.test(line);

          const inline = (value: string) =>
            value.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, k) => {
              if (p.startsWith("`") && p.endsWith("`"))
                return (
                  <code
                    key={k}
                    className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ember"
                  >
                    {p.slice(1, -1)}
                  </code>
                );
              if (p.startsWith("**") && p.endsWith("**"))
                return (
                  <strong key={k} className="font-semibold text-ink-1">
                    {p.slice(2, -2)}
                  </strong>
                );
              if (p.startsWith("*") && p.endsWith("*"))
                return (
                  <em key={k} className="italic text-ember">
                    {p.slice(1, -1)}
                  </em>
                );
              return <span key={k}>{p}</span>;
            });

          if (heading)
            return (
              <p key={j} className="pt-1.5 text-[15px] font-semibold text-ink-1">
                {heading[1]}
              </p>
            );
          if (bullet)
            return (
              <p key={j} className="flex gap-2.5">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-4" />
                <span className="flex-1">{inline(line.replace(/^\s*[-*]\s/, ""))}</span>
              </p>
            );
          return (
            <p key={j} className="leading-[1.75]">
              {inline(line)}
            </p>
          );
        })}
      </div>
    );
  });
}

function DiffRow({
  kind,
  n,
  text,
}: {
  kind: "+" | "-" | " ";
  n: number;
  text: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[30px_24px_1fr] font-mono text-[11.5px] leading-[1.75]",
        kind === "+" && "bg-[rgba(74,160,110,0.10)]",
        kind === "-" && "bg-[rgba(200,90,80,0.10)]",
      )}
    >
      <span className="select-none pr-2 text-right text-ink-4/50">
        {kind === "+" ? "" : n}
      </span>
      <span
        className={cn(
          "select-none text-center",
          kind === "+"
            ? "text-[#4aa06e]"
            : kind === "-"
              ? "text-[#c85a50]"
              : "text-ink-4/50",
        )}
      >
        {kind}
      </span>
      <span className="whitespace-pre-wrap break-words text-ink-2">{text}</span>
    </div>
  );
}

const SAMPLE_DIFF = {
  path: "server/routes/chat.ts",
  rows: [
    { kind: "-" as const, n: 12, text: "export async function POST(req: Request) {" },
    { kind: "-" as const, n: 13, text: "  const body = await req.json()" },
    { kind: "-" as const, n: 14, text: "  return runTurn(body)" },
    { kind: "+" as const, n: 12, text: "export async function POST(req: Request) {" },
    { kind: "+" as const, n: 13, text: "  const body = await req.json()" },
    { kind: "+" as const, n: 14, text: "  const session = await requireSession(req)" },
    { kind: "+" as const, n: 15, text: "" },
    { kind: "+" as const, n: 16, text: "  const finding = screen(body.prompt)" },
    { kind: "+" as const, n: 17, text: "  if (finding) return blocked(finding)" },
    { kind: "+" as const, n: 18, text: "" },
    { kind: "+" as const, n: 19, text: "  const account = await claimSlot()" },
    { kind: "+" as const, n: 20, text: "  return streamTurn(account, session)" },
    { kind: " " as const, n: 21, text: "}" },
  ],
};

/** One line of the agent's progress report, the way a CLI prints it. */
function Step({
  done = false,
  running = false,
  children,
}: {
  done?: boolean;
  running?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 font-mono text-[11.5px] text-ink-4">
      {running ? (
        <Loader2 className="mt-[2px] size-3 shrink-0 animate-spin text-ember" />
      ) : done ? (
        <Check className="mt-[3px] size-3 shrink-0 text-ember" />
      ) : (
        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4/40" />
      )}
      <span className={cn(done || running ? "text-ink-3" : undefined)}>
        {children}
      </span>
    </li>
  );
}

export default function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<
    Awaited<ReturnType<typeof api.listConversations>>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(id ?? null);
  const [messages, setMessages] = useState<
    Awaited<ReturnType<typeof api.listMessages>>
  >([]);
  const [agent, setAgent] = useState("lolo");
  const [model, setModel] = useState(MODELS[0]!.id);
  const [effort, setEffort] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>("preview");
  const [railOpen, setRailOpen] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [agentMenu, setAgentMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /** Reveals the newest assistant reply character by character. */
  const [revealId, setRevealId] = useState<string | null>(null);
  const [revealChars, setRevealChars] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const activeModel = useMemo(() => getModel(model), [model]);

  useEffect(() => {
    void (async () => {
      const rows = await api.listConversations();
      setConversations(rows);
      const target = id ?? rows[0]?.id;
      if (!target) return;
      setActiveId(target);
      const conv = rows.find((c) => c.id === target);
      if (conv) {
        setAgent(conv.agent);
        setModel(conv.model);
      }
      setMessages(await api.listMessages(target));
    })();
  }, [id]);

  // Keep the newest content in view as it streams or arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, revealChars, busy]);

  /** Types a message out, so a reply visibly arrives instead of snapping in. */
  const stream = useCallback((messageId: string, text: string) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setRevealId(messageId);
    setRevealChars(0);

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || text.length < 40) {
      setRevealChars(text.length);
      setRevealId(null);
      return;
    }

    // ~90 chars a second, with a floor so short replies still feel deliberate.
    const perFrame = Math.max(1.6, text.length / 150);
    let shown = 0;
    const tick = () => {
      shown += perFrame;
      if (shown >= text.length) {
        setRevealChars(text.length);
        setRevealId(null);
        rafRef.current = null;
        return;
      }
      setRevealChars(shown);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const openConversation = useCallback(
    async (target: string) => {
      setActiveId(target);
      setRailOpen(false);
      const rows = await api.listConversations();
      const conv = rows.find((c) => c.id === target);
      if (conv) {
        setAgent(conv.agent);
        setModel(conv.model);
      }
      setMessages(await api.listMessages(target));
      setRevealId(null);
      navigate(`/chat/${target}`, { replace: true });
    },
    [navigate],
  );

  const newRun = useCallback(async () => {
    const c = await api.createConversation(agent, model);
    setConversations(await api.listConversations());
    setActiveId(c.id);
    setMessages([]);
    setRevealId(null);
    setRailOpen(false);
    navigate(`/chat/${c.id}`, { replace: true });
    inputRef.current?.focus();
  }, [agent, model, navigate]);

  const run = useCallback(
    async (prompt: string, target: string) => {
      setBusy(true);
      try {
        await api.runTurn({ conversationId: target, prompt, agent, model });
      } finally {
        const fresh = await api.listMessages(target);
        setMessages(fresh);
        setConversations(await api.listConversations());
        setBusy(false);

        const reply = [...fresh].reverse().find((m) => m.role === "assistant");
        if (reply && !reply.blocked) stream(reply.id, reply.content);
      }
    },
    [agent, model, stream],
  );

  const send = useCallback(async () => {
    const prompt = draft.trim();
    // Also block while a reply is still being typed out, so a second turn
    // cannot interleave with the reveal of the first.
    if (!prompt || busy || revealId) return;

    let target = activeId;
    if (!target) {
      const c = await api.createConversation(agent, model);
      target = c.id;
      setActiveId(c.id);
      setConversations(await api.listConversations());
      navigate(`/chat/${c.id}`, { replace: true });
    }

    setDraft("");
    setMessages((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        conversationId: target,
        role: "user",
        content: prompt,
        agent,
        createdAt: Date.now(),
      },
    ]);
    await run(prompt, target);
  }, [activeId, agent, busy, draft, model, navigate, revealId, run]);

  const regenerate = useCallback(async () => {
    if (busy) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || !activeId) return;
    await run(lastUser.content, activeId);
  }, [activeId, busy, messages, run]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRevealId(null);
    setBusy(false);
  }, []);

  const remove = useCallback(
    async (target: string) => {
      await api.deleteConversation(target);
      const rows = await api.listConversations();
      setConversations(rows);
      if (target !== activeId) return;
      if (rows[0]) await openConversation(rows[0].id);
      else {
        setActiveId(null);
        setMessages([]);
        navigate("/chat", { replace: true });
      }
    },
    [activeId, navigate, openConversation],
  );

  const pickAgent = (key: string) => {
    setAgent(key);
    setAgentMenu(false);
    if (activeId) void api.updateConversation(activeId, { agent: key });
  };

  const pickModel = (id: string) => {
    setModel(id);
    setModelMenu(false);
    setEffort("");
    if (activeId) void api.updateConversation(activeId, { model: id });
  };

  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-[1680px] gap-3 px-3 pt-3 sm:px-5 sm:pt-4">
        {/* Runs rail */}
        <aside
          className={cn(
            "scrollbar-thin hidden w-64 shrink-0 flex-col overflow-y-auto lg:flex",
            railOpen && "flex",
          )}
        >
          <button type="button" onClick={newRun} className="btn-primary w-full">
            <Plus className="size-4" />
            Run baru
          </button>
          <p className="eyebrow mt-6 mb-2">riwayat</p>
          <div className="space-y-0.5">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2.5 py-2.5 transition-colors",
                  c.id === activeId ? "bg-ember-soft" : "hover:bg-surface-2",
                )}
              >
                <button
                  type="button"
                  onClick={() => void openConversation(c.id)}
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span
                    className={cn(
                      "w-full truncate text-[13px]",
                      c.id === activeId ? "text-ink-1" : "text-ink-3",
                    )}
                  >
                    {c.title}
                  </span>
                  <span className="truncate font-mono text-[10px] text-ink-4">
                    {getAgent(c.agent).name} · {c.model.split("/")[1] ?? c.model}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  aria-label="Hapus run"
                  className="shrink-0 rounded p-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ember"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Workspace */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1">
          <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              className="btn-ghost !px-2.5 !py-1.5 lg:hidden"
              aria-label="Riwayat"
            >
              <Plus className="size-3.5 rotate-45" />
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate font-mono text-[12.5px] text-ink-1">
                {WORKSPACE.repo}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
                <GitBranch className="size-3" />
                {WORKSPACE.branch}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="tag tag-quiet">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    busy ? "animate-pulse bg-ember" : "bg-ink-4",
                  )}
                />
                {busy ? "running" : "idle"}
              </span>
            </div>
          </header>

          {/* Transcript */}
          <div
            ref={scrollRef}
            className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
          >
            <div className="mx-auto w-full max-w-[880px]">
              {messages.length === 0 && (
                <div className="flex min-h-full flex-col items-center justify-center py-10 text-center">
                  <h1 className="display text-[36px] leading-[1.1] text-ink-1 sm:text-[48px]">
                    Apa yang mau
                    <br />
                    lo kerjakan?
                  </h1>
                  <p className="mt-5 max-w-[46ch] text-[15.5px] leading-[1.75] text-ink-2">
                    Lolo memetakan dulu, lalu mengubah, lalu menjalankan check.
                    Semua langkahnya kelihatan — dan bisa dilacak di tab Trace.
                  </p>
                  <div className="mt-8 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setDraft(s);
                          inputRef.current?.focus();
                        }}
                        className="rounded-full border border-border px-3.5 py-2 text-left text-[12.5px] text-ink-3 transition-colors hover:border-[rgba(244,241,234,0.2)] hover:text-ink-1"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="mt-12 grid w-full max-w-[640px] gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-2">
                    {AGENTS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => pickAgent(a.key)}
                        className="bg-surface-1 p-4 text-left transition-colors hover:bg-surface-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              a.accent === "warm" ? "bg-ember" : "bg-[#9db4a8]",
                            )}
                          />
                          <span className="text-[12.5px] font-medium text-ink-1">
                            {a.name}
                          </span>
                          <span className="ml-auto font-mono text-[9.5px] tracking-[0.08em] text-ink-4 uppercase">
                            {a.tagline}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11.5px] leading-[1.6] text-ink-4">
                          {a.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-9">
                {messages.map((m) => {
                  const who = getAgent(m.agent ?? "lolo");
                  const isUser = m.role === "user";
                  const streaming = m.id === revealId;
                  const text = streaming
                    ? m.content.slice(0, Math.floor(revealChars))
                    : m.content;

                  return (
                    <article
                      key={m.id}
                      className={cn(
                        "flex flex-col",
                        isUser ? "items-end" : "items-start",
                      )}
                    >
                      {!isUser && (
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              who.accent === "warm" ? "bg-ember" : "bg-[#9db4a8]",
                            )}
                          />
                          <span className="font-mono text-[12px] text-ink-2">
                            {who.name}
                          </span>
                          <span className="font-mono text-[10.5px] text-ink-4">
                            {m.model}
                          </span>
                          {m.guardrail && (
                            <span className="tag">
                              <ShieldAlert className="size-3" />
                              {GUARDRAIL_LABELS[m.guardrail]}
                            </span>
                          )}
                        </div>
                      )}

                      <div
                        className={cn(
                          "max-w-full rounded-[14px] border px-4 py-3.5 text-[15px] sm:px-5",
                          isUser
                            ? "max-w-[85%] border-ember/25 bg-ember-soft text-ink-1"
                            : m.blocked
                              ? "border-border bg-surface-2 text-ink-2"
                              : "border-border bg-background/40 text-ink-2",
                        )}
                      >
                        {m.blocked ? (
                          <p className="text-[14px] leading-[1.7]">{text}</p>
                        ) : (
                          renderBody(text)
                        )}
                        {streaming && (
                          <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] animate-pulse bg-ember align-middle" />
                        )}
                      </div>

                      {!isUser && !m.blocked && (
                        <>
                          <ul className="mt-4 space-y-1.5">
                            <Step done>
                              Read the request · {who.name} dispatched
                            </Step>
                            <Step done>
                              Screened 7 guardrail rules · clean
                            </Step>
                            <Step done>
                              Claimed a pool slot ·{" "}
                              {m.model?.split("/")[0] ?? "pool"}
                            </Step>
                            {m.latencyMs ? (
                              <Step done>
                                Done · {(m.latencyMs / 1000).toFixed(1)}s · ↑
                                {m.tokensIn ?? 0} ↓{m.tokensOut ?? 0} tokens
                              </Step>
                            ) : (
                              <Step running>Generating…</Step>
                            )}
                          </ul>

                          {!streaming && (
                            <div className="mt-3.5 flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => copy(m.id, m.content)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 font-mono text-[10.5px] text-ink-4 transition-colors hover:text-ink-1"
                              >
                                {copiedId === m.id ? (
                                  <Check className="size-3" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                                {copiedId === m.id ? "tersalin" : "salin"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void regenerate()}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 font-mono text-[10.5px] text-ink-4 transition-colors hover:text-ink-1"
                              >
                                <RefreshCw className="size-3" />
                                ulang
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  );
                })}
              </div>

              {busy && messages[messages.length - 1]?.role === "user" && (
                <ul className="mt-9 space-y-2">
                  <Step done>Read the request · {getAgent(agent).name} dispatched</Step>
                  <Step done>Screened 7 guardrail rules · clean</Step>
                  <Step running>Claiming a pool slot…</Step>
                  <Step>Generating…</Step>
                </ul>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Panels + composer */}
          <div className="shrink-0 border-t border-border">
            <div className="flex items-center gap-1 border-b border-border px-3">
              {PANELS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPanel(p.key)}
                  className={cn(
                    "relative px-3.5 py-2.5 text-[12.5px] transition-colors",
                    panel === p.key ? "text-ink-1" : "text-ink-4 hover:text-ink-2",
                  )}
                >
                  {p.label}
                  {p.key === "changes" && (
                    <span className="ml-1.5 rounded-full bg-ember-soft px-1.5 py-0.5 font-mono text-[9.5px] text-ember">
                      1
                    </span>
                  )}
                  {panel === p.key && (
                    <span className="absolute inset-x-2.5 -bottom-px h-px bg-ember" />
                  )}
                </button>
              ))}
            </div>

            {(panel === "code" || panel === "changes") && (
              <div className="scrollbar-thin max-h-64 overflow-y-auto border-b border-border bg-[var(--bg-2)]">
                <div className="sticky top-0 flex items-center gap-2 border-b border-border bg-[var(--bg-2)] px-4 py-2 font-mono text-[11px] text-ink-3">
                  <FileCode2 className="size-3.5 shrink-0" />
                  <span className="truncate">{SAMPLE_DIFF.path}</span>
                  <span className="ml-auto shrink-0 text-ink-4">
                    +7 −3
                  </span>
                </div>
                {SAMPLE_DIFF.rows.map((r, i) => (
                  <DiffRow key={i} kind={r.kind} n={r.n} text={r.text} />
                ))}
              </div>
            )}

            {panel === "terminal" && (
              <div className="scrollbar-thin max-h-56 overflow-y-auto border-b border-border bg-[var(--bg-2)] p-4 font-mono text-[11.5px] leading-[1.9] text-ink-3">
                <p>
                  <span className="text-ink-4">$</span> bun run dev
                </p>
                <p className="text-ink-4">$ tsc -b --noEmit</p>
                <p className="text-[#4aa06e]">✓ 0 errors</p>
                <p>
                  <span className="text-ink-4">$</span> node server/index.ts
                </p>
                <p className="text-ink-4">
                  listening on {WORKSPACE.port} · postgres connected · pool 5
                  accounts
                </p>
              </div>
            )}

            {panel === "preview" && (
              <div className="flex items-center gap-2 border-b border-border bg-[var(--bg-2)] px-4 py-2.5 font-mono text-[11px] text-ink-4">
                <span className="size-1.5 rounded-full bg-ember" />
                dev server on :{WORKSPACE.port} — belum ada preview
              </div>
            )}

            {/* Composer */}
            <div className="px-3 py-3 sm:px-6 sm:py-4">
              <div className="mx-auto w-full max-w-[880px]">
                <div className="relative rounded-[14px] border border-border bg-background/50 p-2.5 transition-colors focus-within:border-ember/50">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={2}
                    placeholder="Ask Lolo…"
                    className="scrollbar-thin max-h-44 w-full resize-none bg-transparent px-1.5 py-1 text-[15px] leading-[1.6] text-ink-1 outline-none placeholder:text-ink-4"
                  />

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setAgentMenu((v) => !v);
                          setModelMenu(false);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-[rgba(244,241,234,0.2)] hover:text-ink-1"
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            getAgent(agent).accent === "warm"
                              ? "bg-ember"
                              : "bg-[#9db4a8]",
                          )}
                        />
                        {getAgent(agent).name}
                        <ChevronDown className="size-3" />
                      </button>
                      {agentMenu && (
                        <>
                          <button
                            type="button"
                            aria-label="Tutup"
                            className="fixed inset-0 z-10 cursor-default"
                            onClick={() => setAgentMenu(false)}
                          />
                          <div className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-[12px] border border-border bg-surface-2 shadow-2xl">
                            {AGENTS.map((a) => (
                              <button
                                key={a.key}
                                type="button"
                                onClick={() => pickAgent(a.key)}
                                className="block w-full border-b border-border px-3.5 py-3 text-left transition-colors last:border-0 hover:bg-surface-3"
                              >
                                <span className="text-[13px] text-ink-1">
                                  {a.name}
                                </span>
                                <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-4">
                                  {a.description}
                                </span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setModelMenu((v) => !v);
                          setAgentMenu(false);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-[rgba(244,241,234,0.2)] hover:text-ink-1"
                      >
                        {activeModel.label}
                        <ChevronDown className="size-3" />
                      </button>
                      {modelMenu && (
                        <>
                          <button
                            type="button"
                            aria-label="Tutup"
                            className="fixed inset-0 z-10 cursor-default"
                            onClick={() => setModelMenu(false)}
                          />
                          <div className="scrollbar-thin absolute bottom-full left-0 z-20 mb-2 max-h-80 w-96 overflow-y-auto rounded-[12px] border border-border bg-surface-2 shadow-2xl">
                            {MODELS.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => pickModel(m.id)}
                                className="block w-full border-b border-border px-3.5 py-3 text-left transition-colors last:border-0 hover:bg-surface-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13px] text-ink-1">
                                    {m.label}
                                  </span>
                                  {m.unmetered ? (
                                    <span className="tag">unmetered</span>
                                  ) : m.freeHours > 0 ? (
                                    <span className="tag tag-quiet">
                                      {m.freeHours} jam/hari
                                    </span>
                                  ) : (
                                    <span className="tag tag-quiet">berbayar</span>
                                  )}
                                </div>
                                <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
                                  {m.bestFor}
                                </p>
                                <p className="mt-1 font-mono text-[10px] text-ink-4">
                                  {m.id} ·{" "}
                                  {m.efforts.length > 0
                                    ? m.efforts.join(" · ")
                                    : "effort dibuang"}
                                </p>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {activeModel.efforts.length > 0 && (
                      <div className="flex gap-1">
                        {activeModel.efforts.map((lv) => (
                          <button
                            key={lv}
                            type="button"
                            onClick={() => setEffort(effort === lv ? "" : lv)}
                            className={cn(
                              "rounded-full border px-2 py-1 font-mono text-[10.5px] transition-colors",
                              effort === lv
                                ? "border-ember/50 bg-ember-soft text-ember"
                                : "border-border text-ink-4 hover:text-ink-2",
                            )}
                          >
                            {lv}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => (busy ? stop() : void send())}
                      disabled={!busy && (!draft.trim() || Boolean(revealId))}
                      aria-label={busy ? "Berhenti" : "Kirim"}
                      className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-ember text-[#17120f] transition-all hover:bg-[var(--accent-warm-hover)] disabled:opacity-30"
                    >
                      {busy ? (
                        <Square className="size-3 fill-current" />
                      ) : (
                        <ArrowUp className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[10px] text-ink-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        busy ? "animate-pulse bg-ember" : "bg-[#4aa06e]",
                      )}
                    />
                    {busy ? "generating" : "sandbox running"}
                  </span>
                  <span>dev server on :{WORKSPACE.port}</span>
                  <span>{activeModel.vendor}</span>
                  <span className="text-ink-4/70">
                    {activeModel.unmetered
                      ? "unmetered"
                      : activeModel.freeHours > 0
                        ? `${activeModel.freeHours} jam/hari`
                        : "paket berbayar"}
                  </span>
                  <span className="ml-auto">
                    Enter kirim · Shift+Enter baris baru
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
