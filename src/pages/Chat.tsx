import { AppShell } from "@/components/AppShell";
import { api, AGENTS, MODELS, getAgent, getModel } from "@/lib/api";
import { GUARDRAIL_LABELS } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  Check,
  History,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

/** Minimal markdown: bold, inline code, and fenced blocks. Enough, no more. */
function renderBody(text: string) {
  return text.split(/```/).map((block, i) => {
    if (i % 2 === 1) {
      return (
        <pre
          key={i}
          className="scrollbar-thin my-3 overflow-x-auto rounded-lg border border-border bg-[var(--bg-2)] p-4 font-mono text-[12.5px] leading-relaxed text-ink-2"
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

function AgentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {AGENTS.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onChange(a.key)}
          title={a.description}
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
            a.key === value
              ? "border-ember/50 bg-ember-soft text-ember"
              : "border-border text-ink-4 hover:border-[rgba(244,241,234,0.2)] hover:text-ink-2",
          )}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}

function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODELS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          title={`${m.vendor} · ${m.bestFor}`}
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
            m.id === value
              ? "border-ember/50 bg-ember-soft text-ember"
              : "border-border text-ink-4 hover:border-[rgba(244,241,234,0.2)] hover:text-ink-2",
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
  const [model, setModel] = useState(MODELS[0]!.id);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);

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

  const activeModel = useMemo(() => getModel(model), [model]);

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
    if (activeId) void api.updateConversation(activeId, { agent: key });
  };

  const pickModel = (id: string) => {
    setModel(id);
    if (activeId) void api.updateConversation(activeId, { model: id });
  };

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-[1440px] gap-3 px-3 pt-3 sm:px-5 sm:pt-4">
        <aside
          className={cn(
            "scrollbar-thin hidden w-64 shrink-0 flex-col overflow-y-auto lg:flex",
            showList && "flex",
          )}
        >
          <button type="button" onClick={newRun} className="btn-primary w-full">
            <Plus className="size-4" />
            Run baru
          </button>

          <div className="mt-4 space-y-1">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2.5 py-2.5 transition-colors",
                  c.id === activeId
                    ? "border-ember/25 bg-ember-soft"
                    : "border-transparent hover:bg-surface-2",
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
                  <span className="truncate font-mono text-[10px] text-ink-4">
                    {getAgent(c.agent).name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  aria-label="Hapus percakapan"
                  className="shrink-0 rounded p-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ember"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setShowList((s) => !s)}
              className="btn-ghost"
            >
              <History className="size-4" />
              Riwayat
            </button>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 space-y-7 overflow-y-auto pb-4 pr-1">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <div className="max-w-lg">
                  <p className="eyebrow">run baru</p>
                  <h1 className="display mt-5 text-[34px] text-ink-1 sm:text-[42px]">
                    Mau ngerjain apa?
                  </h1>
                  <p className="mt-4 text-[15px] leading-[1.7] text-ink-2">
                    Pilih spesialis, pilih model, lalu ngobrol. Tiap giliran
                    meninggalkan jejak di tab Trace.
                  </p>
                  <div className="mt-8 grid gap-2 sm:grid-cols-2">
                    {AGENTS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => setAgent(a.key)}
                        className="panel group p-4 text-left transition-colors hover:bg-surface-2"
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
                        <p className="mt-2 text-[12px] leading-[1.6] text-ink-4">
                          {a.tagline}
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
                  className={cn(
                    "flex flex-col",
                    isUser ? "items-end" : "items-start",
                  )}
                >
                  {!isUser && (
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          who.accent === "warm" ? "bg-ember" : "bg-[#9db4a8]",
                        )}
                      />
                      <span className="text-[12.5px] font-medium text-ink-2">
                        {who.name}
                      </span>
                      {m.model && (
                        <span className="font-mono text-[10px] text-ink-4">
                          {m.model}
                        </span>
                      )}
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
                      "max-w-[88%] rounded-[14px] border px-4 py-3.5 text-[14.5px]",
                      isUser
                        ? "border-ember/25 bg-ember-soft text-ink-1"
                        : m.blocked
                          ? "border-border bg-surface-2 text-ink-2"
                          : "border-border bg-surface-1 text-ink-2",
                    )}
                  >
                    {m.blocked ? (
                      <p className="text-[14px] leading-[1.7]">{m.content}</p>
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
                <span className="size-1.5 animate-pulse rounded-full bg-ember" />
                {getAgent(agent).name} sedang mikir…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 border-t border-border pt-3 pb-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <AgentPicker value={agent} onChange={pickAgent} />
              <span className="hidden h-3 w-px bg-border sm:block" />
              <ModelPicker value={model} onChange={pickModel} />
            </div>

            <div className="panel flex items-end gap-2 p-2 transition-colors focus-within:border-ember/60">
              <textarea
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
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-ember text-[#17120f] transition-all hover:bg-[var(--accent-warm-hover)] disabled:opacity-35"
              >
                {busy ? <X className="size-4" /> : <ArrowUp className="size-4" />}
              </button>
            </div>

            <p className="mt-2 flex flex-wrap items-center gap-x-4 font-mono text-[10px] text-ink-4">
              <span>Enter kirim · Shift+Enter baris baru</span>
              <span className="inline-flex items-center gap-1">
                <Check className="size-3" />
                guardrail aktif
              </span>
              <span className="text-ink-4/70">
                {activeModel.vendor} ·{" "}
                {activeModel.efforts.length > 0
                  ? `${activeModel.efforts.length} effort didukung`
                  : "effort dibuang"}
              </span>
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
