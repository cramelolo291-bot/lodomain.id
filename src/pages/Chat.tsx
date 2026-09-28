import { AppShell } from "@/components/AppShell";
import { api, AGENTS, MODELS, getAgent, getModel } from "@/lib/api";
import { GUARDRAIL_LABELS } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileCode2,
  GitBranch,
  History,
  Loader2,
  Plus,
  ShieldAlert,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

/** The workspace a run belongs to, mirroring the agent IDE's header. */
const WORKSPACE = { repo: "lolo/lolo-ai", branch: "main", port: 3000 };

type Panel = "preview" | "code" | "terminal" | "changes";

const PANELS: Array<{ key: Panel; label: string }> = [
  { key: "preview", label: "Preview" },
  { key: "code", label: "Code" },
  { key: "terminal", label: "Terminal" },
  { key: "changes", label: "Changes" },
];

/** Minimal markdown with code fences — the same one a CLI would print. */
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

/** One line of a unified diff, the way an editor shows it. */
function DiffRow({ kind, n, text }: { kind: "+" | "-" | " "; n: number; text: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[28px_28px_1fr] font-mono text-[11.5px] leading-[1.75]",
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
          kind === "+" ? "text-[#4aa06e]" : kind === "-" ? "text-[#c85a50]" : "text-ink-4/50",
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
    { kind: "+" as const, n: 13, text: '  const body = await req.json()' },
    { kind: "+" as const, n: 14, text: '  const session = await requireSession(req)' },
    { kind: "+" as const, n: 15, text: "" },
    { kind: "+" as const, n: 16, text: "  const finding = screen(body.prompt)" },
    { kind: "+" as const, n: 17, text: "  if (finding) return blocked(finding)" },
    { kind: "+" as const, n: 18, text: "" },
    { kind: "+" as const, n: 19, text: "  const account = await claimSlot()" },
    { kind: "+" as const, n: 20, text: "  return streamTurn(account, session)" },
    { kind: " " as const, n: 21, text: "}" },
  ],
};

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
  const [effort, setEffort] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>("preview");
  const [showList, setShowList] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [agentMenu, setAgentMenu] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeModel = getModel(model);

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const openConversation = useCallback(
    async (target: string) => {
      setActiveId(target);
      setShowList(false);
      const rows = await api.listConversations();
      const conv = rows.find((c) => c.id === target);
      if (conv) {
        setAgent(conv.agent);
        setModel(conv.model);
      }
      setMessages(await api.listMessages(target));
      navigate(`/chat/${target}`, { replace: true });
    },
    [navigate],
  );

  const newRun = useCallback(async () => {
    const c = await api.createConversation(agent, model);
    setConversations(await api.listConversations());
    setActiveId(c.id);
    setMessages([]);
    setShowList(false);
    navigate(`/chat/${c.id}`, { replace: true });
    inputRef.current?.focus();
  }, [agent, model, navigate]);

  const send = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;

    let target = activeId;
    if (!target) {
      const c = await api.createConversation(agent, model);
      target = c.id;
      setActiveId(c.id);
      setConversations(await api.listConversations());
      navigate(`/chat/${c.id}`, { replace: true });
    }

    setDraft("");
    setBusy(true);
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

    try {
      await api.runTurn({ conversationId: target, prompt, agent, model });
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          conversationId: target,
          role: "assistant",
          content: `Turn gagal: ${error instanceof Error ? error.message : "unknown error"}`,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
      setMessages(await api.listMessages(target));
      setConversations(await api.listConversations());
    }
  }, [activeId, agent, busy, draft, model, navigate]);

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
    if (!getModel(id).efforts.includes(effort as never)) setEffort("");
    if (activeId) void api.updateConversation(activeId, { model: id });
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-[1440px] gap-3 px-3 pt-3 sm:px-5 sm:pt-4">
        {/* Runs rail */}
        <aside
          className={cn(
            "scrollbar-thin hidden w-60 shrink-0 flex-col overflow-y-auto lg:flex",
            showList && "flex",
          )}
        >
          <button type="button" onClick={newRun} className="btn-primary w-full">
            <Plus className="size-4" />
            Run baru
          </button>
          <div className="mt-4 space-y-0.5">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors",
                  c.id === activeId
                    ? "bg-ember-soft"
                    : "hover:bg-surface-2",
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
                    {getAgent(c.agent).name}
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
          {/* Workspace header */}
          <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate font-mono text-[12.5px] text-ink-1">
                {WORKSPACE.repo}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
                <GitBranch className="size-3" />
                {WORKSPACE.branch}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowList((s) => !s)}
                className="btn-ghost !px-3 !py-1.5 lg:hidden"
              >
                <History className="size-3.5" />
              </button>
              <span className="tag tag-quiet">
                <span className="size-1.5 rounded-full bg-ember" />
                sandbox idle
              </span>
            </div>
          </header>

          {/* Transcript */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto max-w-[760px]">
              {messages.length === 0 && (
                <div className="flex min-h-full flex-col items-center justify-center py-12 text-center">
                  <h1 className="display text-[34px] leading-[1.1] text-ink-1 sm:text-[44px]">
                    Jelaskan apa yang mau
                    <br />
                    lo bangun.
                  </h1>
                  <p className="mt-5 max-w-[44ch] text-[15px] leading-[1.7] text-ink-2">
                    Lolo akan memetakan dulu, baru mengubah, lalu menjalankan
                    check. Semua langkahnya kelihatan di panel Trace.
                  </p>
                  <div className="mt-9 grid w-full gap-2 sm:grid-cols-2">
                    {AGENTS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => pickAgent(a.key)}
                        className="panel group p-4 text-left transition-colors hover:border-[rgba(244,241,234,0.2)] hover:bg-surface-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              a.accent === "warm" ? "bg-ember" : "bg-[#9db4a8]",
                            )}
                          />
                          <span className="text-[13px] font-medium text-ink-1">
                            {a.name}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-4">
                          {a.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-8">
                {messages.map((m) => {
                  const who = getAgent(m.agent ?? "lolo");
                  const isUser = m.role === "user";
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
                          "w-full rounded-[12px] border px-4 py-3.5 text-[14.5px] sm:px-5",
                          isUser
                            ? "max-w-[85%] border-ember/25 bg-ember-soft text-ink-1"
                            : m.blocked
                              ? "border-border bg-surface-2 text-ink-2"
                              : "border-border bg-background/40 text-ink-2",
                        )}
                      >
                        {m.blocked ? (
                          <p className="text-[14px] leading-[1.7]">{m.content}</p>
                        ) : (
                          renderBody(m.content)
                        )}
                      </div>

                      {!isUser && !m.blocked && (
                        <>
                          {/* Progress checklist, the way a coding agent reports */}
                          <ul className="mt-3.5 space-y-1.5">
                            {[
                              `Read the request · ${who.name} dispatched`,
                              `Screened 7 guardrail rules · clean`,
                              `Claimed a pool slot · ${m.model?.split("/")[0]}`,
                            ].map((line) => (
                              <li
                                key={line}
                                className="flex items-start gap-2 font-mono text-[11.5px] text-ink-4"
                              >
                                <Check className="mt-[3px] size-3 shrink-0 text-ember" />
                                {line}
                              </li>
                            ))}
                            {m.latencyMs ? (
                              <li className="flex items-start gap-2 font-mono text-[11.5px] text-ink-3">
                                <Check className="mt-[3px] size-3 shrink-0 text-ember" />
                                Done · {(m.latencyMs / 1000).toFixed(1)}s · ↑
                                {m.tokensIn ?? 0} ↓{m.tokensOut ?? 0} tokens
                              </li>
                            ) : null}
                          </ul>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>

              {busy && (
                <div className="mt-8 space-y-2.5">
                  {[
                    "Mapping the relevant files",
                    "Planning the change",
                    "Writing the diff",
                  ].map((line, i) => (
                    <div
                      key={line}
                      className="flex items-center gap-2.5 font-mono text-[11.5px] text-ink-4"
                      style={{ animation: `rise .5s var(--ease-cinema) ${i * 0.14}s backwards` }}
                    >
                      {i === 2 ? (
                        <Loader2 className="size-3 shrink-0 animate-spin text-ember" />
                      ) : (
                        <Check className="size-3 shrink-0 text-ember" />
                      )}
                      {line}
                    </div>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Panel tabs + composer */}
          <div className="shrink-0 border-t border-border">
            <div className="flex items-center gap-1 border-b border-border px-3">
              {PANELS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPanel(p.key)}
                  className={cn(
                    "relative px-3 py-2.5 text-[12.5px] transition-colors",
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
                    <span className="absolute inset-x-2 -bottom-px h-px bg-ember" />
                  )}
                </button>
              ))}
            </div>

            {panel === "code" && (
              <div className="max-h-56 overflow-y-auto border-b border-border bg-[var(--bg-2)]">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-[11px] text-ink-3">
                  <FileCode2 className="size-3.5" />
                  {SAMPLE_DIFF.path}
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

            {panel === "changes" && (
              <div className="max-h-56 overflow-y-auto border-b border-border bg-[var(--bg-2)]">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-[11px] text-ink-3">
                  <FileCode2 className="size-3.5" />
                  {SAMPLE_DIFF.path}
                </div>
                {SAMPLE_DIFF.rows.map((r, i) => (
                  <DiffRow key={i} kind={r.kind} n={r.n} text={r.text} />
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="px-3 py-3 sm:px-4">
              <div className="mx-auto max-w-[760px]">
                <div className="relative rounded-[12px] border border-border bg-background/50 p-2 transition-colors focus-within:border-ember/50">
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
                    className="scrollbar-thin max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-[14.5px] text-ink-1 outline-none placeholder:text-ink-4"
                  />

                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {/* Agent */}
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
                        <div className="absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-[10px] border border-border bg-surface-2 shadow-xl">
                          {AGENTS.map((a) => (
                            <button
                              key={a.key}
                              type="button"
                              onClick={() => pickAgent(a.key)}
                              className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-3"
                            >
                              <span className="text-[12.5px] text-ink-1">
                                {a.name}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-ink-4">
                                {a.tagline}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Model */}
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
                        <div className="scrollbar-thin absolute bottom-full left-0 z-20 mb-2 max-h-72 w-80 overflow-y-auto rounded-[10px] border border-border bg-surface-2 shadow-xl">
                          {MODELS.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => pickModel(m.id)}
                              className="block w-full border-b border-border px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-3"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[12.5px] text-ink-1">
                                  {m.label}
                                </span>
                                {m.unmetered ? (
                                  <span className="tag">unmetered</span>
                                ) : m.freeHours > 0 ? (
                                  <span className="tag tag-quiet">
                                    {m.freeHours}h/hari
                                  </span>
                                ) : (
                                  <span className="tag tag-quiet">paid</span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] leading-snug text-ink-4">
                                {m.bestFor}
                              </p>
                              <p className="mt-1 font-mono text-[10px] text-ink-4/70">
                                {m.id} ·{" "}
                                {m.efforts.length > 0
                                  ? m.efforts.join(" · ")
                                  : "effort dibuang"}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Effort, only when the model takes one */}
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
                      onClick={() => void send()}
                      disabled={!draft.trim() || busy}
                      aria-label="Kirim"
                      className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-ember text-[#17120f] transition-all hover:bg-[var(--accent-warm-hover)] disabled:opacity-30"
                    >
                      {busy ? <X className="size-4" /> : <ArrowUp className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* Status footer */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[10px] text-ink-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-ember" />
                    sandbox running
                  </span>
                  <span>dev server on :{WORKSPACE.port}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Terminal className="size-3" />
                    {activeModel.vendor}
                  </span>
                  <span className="text-ink-4/70">
                    {activeModel.unmetered
                      ? "tidak pakai jatah harian"
                      : activeModel.freeHours > 0
                        ? `${activeModel.freeHours}h dari jatah harian`
                        : "butuh paket berbayar"}
                  </span>
                  {lastAssistant?.latencyMs ? (
                    <span className="ml-auto">
                      last turn {(lastAssistant.latencyMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
