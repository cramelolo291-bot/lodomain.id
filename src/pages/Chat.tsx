import { AppShell } from "@/components/AppShell";
import { api, AGENTS, MODELS, getAgent, getModel } from "@/lib/api";
import { GUARDRAIL_LABELS } from "@/lib/guardrails";
import {
  diffLines,
  diffStats,
  langOf,
  previewHtml,
  type FileChange,
  type Project,
} from "@/lib/project";
import { cn } from "@/lib/utils";
import { DataPanel } from "@/components/DataPanel";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronsRight,
  Copy,
  ExternalLink,
  FileCode2,
  FileJson,
  FileText,
  GitBranch,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

type FileIcon = typeof FileCode2;
const FILE_ICON: Record<string, FileIcon> = {
  typescript: FileCode2,
  javascript: FileCode2,
  json: FileJson,
  html: FileText,
  css: FileText,
  sql: FileText,
};

const SUGGESTIONS = [
  "Bikin aplikasi web baru",
  "Tambah rate limiting ke endpoint chat",
  "Bikin skema Postgres untuk gateway",
  "Tambah magic-link authentication",
];

/** freebuff-style generated project name. */
function projectSlug() {
  const a = ["amber", "quiet", "sharp", "plain", "lucid", "brisk", "hollow"];
  const b = ["otters", "lanes", "fields", "shores", "peaks", "harbor"];
  const c = ["try", "run", "build", "draft", "draft"];
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  return `${pick(a)}-${pick(b)}-${pick(c)}`;
}

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

/**
 * A file change, rendered inline in the conversation.
 *
 * The header row is a button and the "open" affordance is a sibling button —
 * never a button inside a button, which the browser silently unwraps and
 * which makes React drop the subtree.
 */
function ChangeCard({
  change,
  onOpen,
  defaultOpen = false,
}: {
  change: FileChange;
  onOpen?: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = useMemo(
    () => diffLines(change.before ?? "", change.after),
    [change],
  );
  const { added, removed } = diffStats(rows);
  const Icon = FILE_ICON[langOf(change.path)] ?? FileCode2;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-[var(--bg-2)]">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
        >
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-ink-4 transition-transform",
              !open && "-rotate-90",
            )}
          />
          <Icon className="size-3.5 shrink-0 text-ink-4" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
            {change.path}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] tracking-[0.06em] uppercase",
              change.op === "created"
                ? "bg-[rgba(74,160,110,0.14)] text-[#4aa06e]"
                : "bg-ember-soft text-ember",
            )}
          >
            {change.op}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-[#4aa06e]">
            +{added}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-[#c85a50]">
            −{removed}
          </span>
        </button>

        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(change.path)}
            aria-label={`Buka ${change.path}`}
            className="shrink-0 rounded p-1.5 text-ink-4 transition-colors hover:bg-surface-2 hover:text-ember"
          >
            <ExternalLink className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="scrollbar-thin max-h-64 overflow-auto border-t border-border">
          {rows.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex font-mono text-[11.5px] leading-[1.7]",
                r.kind === "+" && "bg-[rgba(74,160,110,0.10)]",
                r.kind === "-" && "bg-[rgba(200,90,80,0.10)]",
              )}
            >
              <span
                className={cn(
                  "w-4 shrink-0 select-none text-center",
                  r.kind === "+"
                    ? "text-[#4aa06e]"
                    : r.kind === "-"
                      ? "text-[#c85a50]"
                      : "text-transparent",
                )}
              >
                {r.kind === " " ? "" : r.kind}
              </span>
              <span className="whitespace-pre-wrap break-words px-2 text-ink-2">
                {r.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <span className={done || running ? "text-ink-3" : undefined}>{children}</span>
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
  const [project, setProject] = useState<Project | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [slug] = useState(projectSlug);

  const [agent, setAgent] = useState("lolo");
  const [model, setModel] = useState(MODELS[0]!.id);
  const [effort, setEffort] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [agentMenu, setAgentMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deployed, setDeployed] = useState(false);

  /** Right-hand pane. Everything lives together; nothing is tabbed away. */
  const [paneOpen, setPaneOpen] = useState(true);
  const [pane, setPane] = useState<"preview" | "file" | "data">("preview");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [split, setSplit] = useState(46);
  const [termOpen, setTermOpen] = useState(false);
  const [termLines, setTermLines] = useState<string[]>([
    "$ bun run dev",
    "listening on 3000 · postgres connected",
  ]);
  const [termInput, setTermInput] = useState("");

  const [revealId, setRevealId] = useState<string | null>(null);
  const [revealChars, setRevealChars] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragging = useRef(false);

  const activeModel = useMemo(() => getModel(model), [model]);
  const paths = useMemo(
    () => (project ? Object.keys(project.files).sort() : []),
    [project],
  );
  const preview = useMemo(
    () => (project ? previewHtml(project) : null),
    [project],
  );
  const totals = useMemo(
    () =>
      changes
        .map((c) => diffStats(diffLines(c.before ?? "", c.after)))
        .reduce(
          (acc, d) => ({ added: acc.added + d.added, removed: acc.removed + d.removed }),
          { added: 0, removed: 0 },
        ),
    [changes],
  );

  useEffect(() => {
    void (async () => {
      const [rows, proj] = await Promise.all([
        api.listConversations(),
        api.getProject(),
      ]);
      setConversations(rows);
      setProject(proj);
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
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, revealChars, busy]);

  /** Drag the divider to resize the conversation against the live pane. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !shellRef.current) return;
      const box = shellRef.current.getBoundingClientRect();
      const pct = ((e.clientX - box.left) / box.width) * 100;
      setSplit(Math.min(72, Math.max(22, pct)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  /**
   * Reveals a reply character by character.
   *
   * Progress is driven by elapsed time, not by frame count. requestAnimationFrame
   * stops firing when the tab or its host iframe is throttled, which used to
   * leave the message frozen at zero characters — looking exactly like a chat
   * that never replied. With a clock, throttling only makes it skip ahead.
   */
  const stream = useCallback((messageId: string, text: string) => {
    if (timerRef.current !== null) clearInterval(timerRef.current);

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced || text.length < 40) {
      setRevealId(null);
      setRevealChars(text.length);
      return;
    }

    setRevealId(messageId);
    // Start with a visible sliver so the message is never blank.
    setRevealChars(Math.min(8, text.length));

    const startedAt = Date.now();
    const durationMs = Math.min(7000, Math.max(900, text.length * 14));

    timerRef.current = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      setRevealChars(Math.floor(text.length * progress));

      if (progress >= 1) {
        if (timerRef.current !== null) clearInterval(timerRef.current);
        timerRef.current = null;
        setRevealChars(text.length);
        setRevealId(null);
      }
    }, 32);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    },
    [],
  );

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
    setChanges([]);
    setDeployed(false);
    setRevealId(null);
    setRailOpen(false);
    navigate(`/chat/${c.id}`, { replace: true });
    inputRef.current?.focus();
  }, [agent, model, navigate]);

  const run = useCallback(
    async (prompt: string, target: string) => {
      setBusy(true);
      try {
        const result = await api.runTurn({
          conversationId: target,
          prompt,
          agent,
          model,
        });
        if (result.status === "ok") setChanges(result.changes);
      } finally {
        const [fresh, proj] = await Promise.all([
          api.listMessages(target),
          api.getProject(),
        ]);
        setMessages(fresh);
        setProject(proj);
        setConversations(await api.listConversations());
        setBusy(false);
        setDeployed(false);

        const reply = [...fresh].reverse().find((m) => m.role === "assistant");

        if (reply && !reply.blocked) {
          stream(reply.id, reply.content);
          return;
        }

        // The turn produced no visible reply. Say so rather than leaving an
        // empty thread, which reads as a chat that never answered.
        if (!reply) {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              conversationId: target,
              role: "assistant",
              content:
                "Turn selesai tapi nggak ada balasan yang masuk. Coba kirim ulang — kalau terulang, cek tab Trace untuk lihat di langkah mana agent berhenti.",
              createdAt: Date.now(),
            },
          ]);
        }
      }
    },
    [agent, model, stream],
  );

  const send = useCallback(async () => {
    const prompt = draft.trim();
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
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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

  const runTerm = useCallback(async (cmd: string) => {
    const res = await api.runCommand(cmd);
    setTermLines((prev) => [
      ...prev,
      `$ ${cmd}`,
      ...res.out,
      ...(res.code === 0 ? [] : [`exit ${res.code}`]),
    ]);
  }, []);

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

  const copy = (mid: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedId(mid);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const openChangedFile = (path: string) => {
    setPane("file");
    setPaneOpen(true);
    setOpenFile(path);
  };

  return (
    <AppShell>
      <div
        ref={shellRef}
        className="flex h-full w-full gap-3 px-3 pt-3 sm:px-5 sm:pt-4 2xl:px-7"
      >
        {/* Runs rail */}
        <aside
          className={cn(
            "scrollbar-thin hidden w-60 shrink-0 flex-col overflow-y-auto lg:flex",
            railOpen && "flex",
          )}
        >
          <button type="button" onClick={newRun} className="btn-primary w-full">
            <Plus className="size-4" />
            Run baru
          </button>
          <p className="eyebrow mt-6 mb-2">proyek</p>
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
                    {getAgent(c.agent).name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  aria-label="Hapus proyek"
                  className="shrink-0 rounded p-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ember"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <div
          className={cn(
            "flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1",
            paneOpen ? "hidden md:flex" : "flex flex-1",
          )}
          style={paneOpen ? { width: `${split}%` } : undefined}
        >
          {/* Header */}
          <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              className="btn-ghost !px-2.5 !py-1.5 lg:hidden"
              aria-label="Proyek"
            >
              <Plus className="size-3.5 rotate-45" />
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate text-[13px] text-ink-1">{slug}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
                <GitBranch className="size-3" />
                main
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTermOpen((v) => !v)}
                className="btn-ghost !px-2.5 !py-1.5"
                aria-label="Terminal"
              >
                <TerminalIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPaneOpen(true)}
                className="btn-ghost !px-2.5 !py-1.5 md:hidden"
                aria-label="Buka preview"
              >
                <ExternalLink className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeployed(true);
                  setPane("preview");
                  setPaneOpen(true);
                }}
                disabled={paths.length === 0}
                className="btn-primary !px-3 !py-1.5 !text-[12px]"
              >
                {deployed ? (
                  <>
                    <Check className="size-3.5" />
                    Live
                  </>
                ) : (
                  <>
                    <Rocket className="size-3.5" />
                    Deploy
                  </>
                )}
              </button>
            </div>
          </header>

          {/* Transcript */}
          <div
            ref={scrollRef}
            className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-7"
          >
            <div className="mx-auto w-full max-w-[780px]">
              {messages.length === 0 && (
                <div className="flex min-h-full flex-col items-center justify-center py-8 text-center">
                  <h1 className="display text-[34px] leading-[1.1] text-ink-1 sm:text-[44px]">
                    Bilang aja mau
                    <br />
                    bikin apa.
                  </h1>
                  <p className="mt-5 max-w-[42ch] text-[15px] leading-[1.75] text-ink-2">
                    Agent nulis filenya, nge-typecheck, lalu nampilin hasilnya
                    di sebelah kanan. Nggak ada tab buat pindah-pindah.
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
                </div>
              )}

              <div className="space-y-8">
                {messages.map((m) => {
                  const who = getAgent(m.agent ?? "lolo");
                  const isUser = m.role === "user";
                  const streaming = m.id === revealId;
                  const text = streaming
                    ? m.content.slice(0, Math.max(1, Math.floor(revealChars)))
                    : m.content;
                  const isNewest = messages[messages.length - 1]?.id === m.id;

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
                          <span className="font-mono text-[11.5px] text-ink-2">
                            {who.name}
                          </span>
                          <span className="font-mono text-[10px] text-ink-4">
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
                          "max-w-full rounded-[14px] border px-4 py-3.5 text-[14.5px]",
                          isUser
                            ? "max-w-[88%] border-ember/25 bg-ember-soft text-ink-1"
                            : m.blocked
                              ? "border-border bg-surface-2 text-ink-2"
                              : "w-full border-border bg-background/40 text-ink-2",
                        )}
                      >
                        {m.blocked ? (
                          <p className="text-[13.5px] leading-[1.7]">{text}</p>
                        ) : (
                          renderBody(text)
                        )}
                        {streaming && (
                          <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] animate-pulse bg-ember align-middle" />
                        )}
                      </div>

                      {/* File changes live right here in the conversation */}
                      {!isUser && !m.blocked && !streaming && isNewest && changes.length > 0 && (
                        <div className="w-full space-y-2">
                          {changes.map((c) => (
                            <ChangeCard
                              key={c.path}
                              change={c}
                              onOpen={openChangedFile}
                            />
                          ))}
                        </div>
                      )}

                      {!isUser && !m.blocked && (
                        <>
                          <ul className="mt-3.5 space-y-1.5">
                            <Step done>Read the request · {who.name} dispatched</Step>
                            <Step done>Screened 7 guardrail rules · clean</Step>
                            {m.latencyMs ? (
                              <Step done>
                                Done · {(m.latencyMs / 1000).toFixed(1)}s ·{" "}
                                {changes.length} file ditulis
                              </Step>
                            ) : (
                              <Step running>Working…</Step>
                            )}
                          </ul>

                          {!streaming && (
                            <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
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
                <ul className="mt-8 space-y-2">
                  <Step done>Read the request · {getAgent(agent).name} dispatched</Step>
                  <Step done>Screened 7 guardrail rules · clean</Step>
                  <Step running>Mapping the project…</Step>
                  <Step>Writing files…</Step>
                  <Step>Typechecking…</Step>
                </ul>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Terminal drawer, inside the same column */}
          {termOpen && (
            <div className="flex h-44 shrink-0 flex-col border-t border-border bg-[var(--bg-2)]">
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-[1.85] text-ink-3">
                {termLines.map((l, i) => (
                  <p
                    key={i}
                    className={cn(
                      l.startsWith("$") ? "text-ink-2" : undefined,
                      l.startsWith("exit") || l.includes("No such")
                        ? "text-[#c85a50]"
                        : l.startsWith("✓")
                          ? "text-[#4aa06e]"
                          : undefined,
                    )}
                  >
                    {l}
                  </p>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cmd = termInput.trim();
                  if (!cmd) return;
                  setTermInput("");
                  void runTerm(cmd);
                }}
                className="flex items-center gap-2 border-t border-border px-3 py-2"
              >
                <span className="font-mono text-[11px] text-ember">$</span>
                <input
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  placeholder="ls -R · cat server/index.ts · wc · tsc"
                  className="flex-1 bg-transparent font-mono text-[11px] text-ink-2 outline-none placeholder:text-ink-4"
                />
                <span className="hidden font-mono text-[9.5px] text-ink-4 sm:inline">
                  ls · cat · wc · tsc
                </span>
              </form>
            </div>
          )}

          {/* Composer */}
          <div className="shrink-0 border-t border-border px-4 py-3.5 sm:px-6">
            <div className="mx-auto w-full max-w-[780px]">
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
                  placeholder={`Ask ${getAgent(agent).name}…`}
                  className="scrollbar-thin max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-[14.5px] leading-[1.6] text-ink-1 outline-none placeholder:text-ink-4"
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
                              className="block w-full border-b border-border px-3.5 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-3"
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
                          onClick={() => setAgentMenu(false)}
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
                                <span className="text-[12.5px] text-ink-1">
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
                    <div className="hidden gap-1 sm:flex">
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

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[10px] text-ink-4">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      busy ? "animate-pulse bg-ember" : "bg-[#4aa06e]",
                    )}
                  />
                  sandbox {busy ? "running" : "idle"}
                </span>
                <span>{paths.length} files</span>
                {changes.length > 0 && (
                  <span>
                    <span className="text-[#4aa06e]">+{totals.added}</span>{" "}
                    <span className="text-[#c85a50]">−{totals.removed}</span>
                  </span>
                )}
                <span className="ml-auto">Enter kirim</span>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        {paneOpen && (
          <div
            onPointerDown={() => {
              dragging.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            className="hidden w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-ember/40 md:flex"
          >
            <ChevronsRight className="size-3 rotate-0 text-ink-4/50" />
          </div>
        )}

        {/* Live pane — preview and code together, no tabs */}
        {paneOpen && (
          <div
            className={cn(
              "min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1",
              paneOpen ? "flex" : "hidden",
            )}
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPane("preview")}
                  className={cn(
                    "rounded-full px-3 py-1 font-mono text-[11px] transition-colors",
                    pane === "preview"
                      ? "bg-ember-soft text-ember"
                      : "text-ink-4 hover:text-ink-2",
                  )}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setPane("file")}
                  className={cn(
                    "rounded-full px-3 py-1 font-mono text-[11px] transition-colors",
                    pane === "file"
                      ? "bg-ember-soft text-ember"
                      : "text-ink-4 hover:text-ink-2",
                  )}
                >
                  Code · {paths.length}
                </button>
                <button
                  type="button"
                  onClick={() => setPane("data")}
                  className={cn(
                    "rounded-full px-3 py-1 font-mono text-[11px] transition-colors",
                    pane === "data"
                      ? "bg-ember-soft text-ember"
                      : "text-ink-4 hover:text-ink-2",
                  )}
                >
                  Data
                </button>
              </div>
              {deployed && (
                <span className="tag tag-quiet ml-2">
                  <span className="size-1.5 rounded-full bg-[#4aa06e]" />
                  {slug}.lolo.app
                </span>
              )}
              <button
                type="button"
                onClick={() => setPaneOpen(false)}
                aria-label="Tutup panel"
                className="ml-auto rounded p-1 text-ink-4 transition-colors hover:text-ink-1"
              >
                <PanelRightClose className="size-4" />
              </button>
            </header>

            {pane === "data" ? (
              <DataPanel project={project?.name ?? "lolo/lolo-ai"} />
            ) : pane === "preview" ? (
              <div className="relative min-h-0 flex-1 bg-[var(--bg-2)]">
                {preview ? (
                  <iframe
                    title="Preview"
                    srcDoc={preview}
                    sandbox="allow-scripts"
                    className="h-full w-full border-0"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 text-center">
                    <p className="text-[14px] text-ink-2">
                      Belum ada yang bisa dirender.
                    </p>
                    <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-ink-4">
                      Minta agent bikin aplikasi web. Begitu file{" "}
                      <code className="font-mono text-ink-3">index.html</code>{" "}
                      ada, halamannya nampil di sini — otomatis, tanpa refresh.
                    </p>
                  </div>
                )}
                <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 font-mono text-[10px] text-ink-3 backdrop-blur">
                  <span className="size-1.5 rounded-full bg-[#4aa06e]" />
                  live · :3000
                </span>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(150px,210px)_1fr]">
                <div className="scrollbar-thin overflow-y-auto border-r border-border py-1.5">
                  {paths.map((p) => {
                    const Icon = FILE_ICON[langOf(p)] ?? FileCode2;
                    const touched = changes.some((c) => c.path === p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setOpenFile(p)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11.5px] transition-colors",
                          openFile === p
                            ? "bg-ember-soft text-ink-1"
                            : "text-ink-3 hover:bg-surface-2",
                        )}
                      >
                        <Icon className="size-3.5 shrink-0 text-ink-4" />
                        <span className="truncate">{p.split("/").pop()}</span>
                        {touched && (
                          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-ember" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <pre className="scrollbar-thin overflow-auto bg-[var(--bg-2)] p-4 font-mono text-[11.5px] leading-[1.75] text-ink-2">
                  {openFile && project?.files[openFile]
                    ? project.files[openFile]
                    : "Pilih file di kiri."}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Collapsed state — reopen */}
        {!paneOpen && (
          <button
            type="button"
            onClick={() => setPaneOpen(true)}
            className="hidden shrink-0 items-center gap-2 self-start rounded-[12px] border border-border bg-surface-1 px-3.5 py-2.5 font-mono text-[11px] text-ink-3 transition-colors hover:text-ink-1 md:flex"
          >
            <PanelRightOpen className="size-3.5" />
            Workspace
          </button>
        )}
      </div>

      {/* Mobile toggle */}
      {paneOpen && (
        <button
          type="button"
          onClick={() => setPaneOpen(false)}
          className="fixed right-4 bottom-4 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 text-ink-2 shadow-xl md:hidden"
          aria-label="Tutup preview"
        >
          <X className="size-4" />
        </button>
      )}
    </AppShell>
  );
}
