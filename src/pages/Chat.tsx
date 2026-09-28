import { AppShell } from "@/components/AppShell";
import { api, AGENTS, MODELS, getAgent } from "@/lib/api";
import { GUARDRAIL_LABELS } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  Check,
  Cpu,
  History,
  MessageSquare,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

/** Minimal markdown: enough for bold, inline code, and fenced blocks. */
function renderBody(text: string) {
  const blocks = text.split(/```/);
  return blocks.map((block, i) => {
    if (i % 2 === 1) {
      return (
        <pre
          key={i}
          className="scrollbar-thin my-3 overflow-x-auto rounded-lg border border-border bg-[var(--bg-2)] p-3.5 font-mono text-[12.5px] leading-relaxed text-ink-2"
        >
          {block.trim()}
        </pre>
      );
    }
    return (
      <div key={i} className="space-y-2.5">
        {block.split("\n").map((line, j) => {
          if (!line.trim()) return null;
          const isBullet = /^\s*[-*]\s/.test(line);
          const heading = /^\s*\*\*(.+?)\*\*/.exec(line);

          const inline = (value: string) =>
            value.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, k) => {
              if (part.startsWith("`") && part.endsWith("`")) {
                return (
                  <code
                    key={k}
                    className="rounded border border-border bg-white/5 px-1 py-0.5 font-mono text-[12px] text-cool"
                  >
                    {part.slice(1, -1)}
                  </code>
                );
              }
              if (part.startsWith("**") && part.endsWith("**")) {
                return (
                  <strong key={k} className="font-semibold text-ink-1">
                    {part.slice(2, -2)}
                  </strong>
                );
              }
              return <span key={k}>{part}</span>;
            });

          if (isBullet) {
            return (
              <p key={j} className="flex gap-2.5 pl-0.5">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-4" />
                <span className="flex-1">{inline(line.replace(/^\s*[-*]\s/, ""))}</span>
              </p>
            );
          }
          if (heading) {
            return (
              <p key={j} className="pt-1 text-[15px] font-semibold text-ink-1">
                {heading[1]}
              </p>
            );
          }
          return (
            <p key={j} className="leading-relaxed">
              {inline(line)}
            </p>
          );
        })}
      </div>
    );
  });
}

function AgentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const active = getAgent(value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {AGENTS.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onChange(a.key)}
          title={a.description}
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all",
            a.key === value
              ? a.accent === "cool"
                ? "border-[var(--accent-cool)]/40 bg-cool-soft text-cool"
                : "border-[var(--accent-warm)]/40 bg-warm-soft text-warm"
              : "border-border text-ink-4 hover:border-[var(--border-strong)] hover:text-ink-2",
          )}
        >
          {a.name}
        </button>
      ))}
      <span className="self-center pl-1 text-[11px] text-ink-4">
        {active.tagline}
      </span>
    </div>
  );
}

function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (tag: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODELS.map((m) => (
        <button
          key={m.tag}
          type="button"
          onClick={() => onChange(m.tag)}
          title={`${m.bestFor} · ${m.vramGb}GB VRAM`}
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all",
            m.tag === value
              ? m.accent === "cool"
                ? "border-[var(--accent-cool)]/40 bg-cool-soft text-cool"
                : "border-[var(--accent-warm)]/40 bg-warm-soft text-warm"
              : "border-border text-ink-4 hover:border-[var(--border-strong)] hover:text-ink-2",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
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
  const [model, setModel] = useState(MODELS[0]!.tag);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Open the newest run on first load, or start one.
  useEffect(() => {
    void (async () => {
      const rows = await api.listConversations();
      setConversations(rows);
      const target = id ?? rows[0]?.id;
      if (target) {
        setActiveId(target);
        const conv = rows.find((c) => c.id === target);
        if (conv) {
          setAgent(conv.agent);
          setModel(conv.model);
        }
        setMessages(await api.listMessages(target));
      }
    })();
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId],
  );

  const openConversation = useCallback(async (target: string) => {
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
  }, [navigate]);

  const newRun = useCallback(async () => {
    const c = await api.createConversation(agent, model);
    setConversations(await api.listConversations());
    setActiveId(c.id);
    setMessages([]);
    setShowList(false);
    navigate(`/chat/${c.id}`, { replace: true });
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
    // Show the user's message immediately; the server round-trip is the pause.
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

  const remove = useCallback(async (target: string) => {
    await api.deleteConversation(target);
    const rows = await api.listConversations();
    setConversations(rows);
    if (target === activeId) {
      if (rows[0]) await openConversation(rows[0].id);
      else {
        setActiveId(null);
        setMessages([]);
        navigate("/chat", { replace: true });
      }
    }
  }, [activeId, navigate, openConversation]);

  const pickAgent = (key: string) => {
    setAgent(key);
    if (activeId) void api.updateConversation(activeId, { agent: key });
  };

  const pickModel = (tag: string) => {
    setModel(tag);
    if (activeId) void api.updateConversation(activeId, { model: tag });
  };

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-[1400px] gap-3 px-3 pt-3 sm:px-5 sm:pt-4">
        {/* Conversation rail */}
        <aside
          className={cn(
            "panel scrollbar-thin hidden w-64 shrink-0 flex-col overflow-y-auto p-3 lg:flex",
            showList && "flex",
          )}
        >
          <button type="button" onClick={newRun} className="btn-primary w-full justify-center">
            <Plus className="size-4" />
            Run baru
          </button>

          <div className="mt-4 space-y-1">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                  c.id === activeId
                    ? "border-[var(--accent-cool)]/25 bg-cool-soft"
                    : "border-transparent hover:bg-white/5",
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
                      c.id === activeId ? "text-ink-1" : "text-ink-2",
                    )}
                  >
                    {c.title}
                  </span>
                  <span className="font-mono text-[10px] text-ink-4">
                    {getAgent(c.agent).name} · {c.model}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  aria-label="Hapus percakapan"
                  className="shrink-0 rounded p-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-warm"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex items-center gap-2 lg:hidden">
            <button type="button" onClick={() => setShowList((s) => !s)} className="btn-ghost">
              <History className="size-4" />
              Riwayat
            </button>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pb-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="max-w-lg">
                  <p className="eyebrow mb-5">Lolo AI · run baru</p>
                  <h1 className="text-4xl font-bold tracking-tight text-ink-1">
                    Mau ngerjain apa hari ini?
                  </h1>
                  <p className="mt-4 text-[15px] leading-relaxed text-ink-3">
                    Empat spesialis, satu pool model lokal. Lolo yang nyusun,
                    spesialis lain yang eksekusi — dan setiap giliran Leave jejak
                    di tab Trace.
                  </p>
                  <div className="mt-7 grid gap-2 sm:grid-cols-2">
                    {AGENTS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => setAgent(a.key)}
                        className="panel group p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              a.accent === "cool" ? "bg-cool" : "bg-warm",
                            )}
                          />
                          <span className="text-[13px] font-semibold text-ink-1">
                            {a.name}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-4">
                          {a.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => {
              const who = getAgent(m.agent ?? "lolo");
              const isUser = m.role === "user";
              return (
                <article
                  key={m.id}
                  className={cn("flex flex-col", isUser ? "items-end" : "items-start")}
                >
                  {!isUser && (
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          who.accent === "cool" ? "bg-cool" : "bg-warm",
                        )}
                      />
                      <span className="text-[12px] font-semibold text-ink-2">
                        {who.name}
                      </span>
                      {m.model && (
                        <span className="font-mono text-[10px] text-ink-4">
                          {m.model}
                        </span>
                      )}
                      {m.guardrail && (
                        <span className="tag tag-warm">
                          <ShieldAlert className="size-3" />
                          {GUARDRAIL_LABELS[m.guardrail]}
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl border px-4 py-3 text-[14.5px] leading-relaxed",
                      isUser
                        ? "border-[var(--accent-cool)]/25 bg-cool-soft text-ink-1"
                        : m.blocked
                          ? "border-[var(--accent-warm)]/30 bg-warm-soft text-ink-2"
                          : "border-border bg-[var(--surface-1)] text-ink-2",
                    )}
                  >
                    {m.blocked ? (
                      <p className="text-[14px] text-ink-2">{m.content}</p>
                    ) : (
                      renderBody(m.content)
                    )}
                  </div>

                  {!isUser && m.latencyMs ? (
                    <div className="mt-2 flex gap-3 pl-1 font-mono text-[10px] text-ink-4">
                      <span>{(m.latencyMs / 1000).toFixed(1)}s</span>
                      <span>↑{m.tokensIn ?? 0}</span>
                      <span>↓{m.tokensOut ?? 0}</span>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {busy && (
              <div className="flex items-center gap-2.5 pl-1 text-[13px] text-ink-4">
                <Cpu className="size-3.5 animate-pulse" />
                {getAgent(agent).name} sedang mikir…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border pt-3 pb-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <AgentPicker value={agent} onChange={pickAgent} />
              <span className="hidden h-3 w-px bg-border sm:block" />
              <ModelPicker value={model} onChange={pickModel} />
            </div>

            <div className="panel flex items-end gap-2 p-2 transition-colors focus-within:border-[var(--accent-cool)]">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={`Ngomong ke ${getAgent(agent).name}…`}
                className="scrollbar-thin max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] text-ink-1 outline-none placeholder:text-ink-4"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || busy}
                aria-label="Kirim"
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-cool text-background transition-all hover:bg-[var(--accent-cool-hover)] disabled:opacity-35"
              >
                {busy ? (
                  <X className="size-4" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </div>

            <p className="mt-2 flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-ink-4">
              <span>Enter kirim · Shift+Enter baris baru</span>
              <span className="inline-flex items-center gap-1">
                <Check className="size-3" />
                guardrail aktif
              </span>
              {activeConv && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {messages.length} pesan
                </span>
              )}
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
