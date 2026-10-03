// Studio — the full-screen working surface.
//
// This is not a read-only mirror of the repo. Every tool in the left rail runs
// against the live repository, the conversation is the place work happens, and
// anything the chat writes lands in the artifacts panel on the right.
//
// Layout is deliberately full-bleed and wide: a three-column working surface
// rather than a centred marketing column, because the point is to use the repo
// and produce files, not to read about them.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  FileText, FolderTree, Loader2, MessageSquare, Search, Trash2,
  ArrowLeft, Download, Terminal, TriangleAlert,
} from "lucide-react";
import { TOOLS, parseCommand, type ToolName, type ToolResult } from "@/lib/repo-tools";
import {
  listArtifacts, saveArtifact, deleteArtifact, clearArtifacts, exportBundle, download,
  type Artifact,
} from "@/lib/artifacts";

type Msg =
  | { role: "user"; text: string }
  | { role: "tool"; text: string; tool: ToolName; result: ToolResult }
  | { role: "bot"; text: string }
  | { role: "error"; text: string };

const EXAMPLES = [
  "/repo_stats",
  "/list_files jev_ultrafast",
  "/open_file pyproject.toml",
  "/search_files browser",
  "/list_issues",
  "/list_prs",
];

/** A fenced ```path / lang block in chat input becomes a saved artifact. */
const FILE_BLOCK = /```(\S+)?\n([\s\S]*?)```/;

export default function Studio() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "bot",
      text:
        "Studio is wired to the live repository. Pick a tool on the left, or type a slash command — /list_files, /search_files, /open_file, /list_issues, /list_prs, /repo_stats.\n\n" +
        "Anything else goes to the server-side model router, which picks a provider for you.\n\n" +
        "To save a file the chat writes, wrap it in a fenced block whose first word is the path:\n```notes/findings.md\n...content...\n```",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [arts, setArts] = useState<Artifact[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setArts(listArtifacts()), []);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [msgs, busy]);

  async function runTool(name: ToolName, arg: string, echo: string) {
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: echo }]);
    try {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(`unknown tool ${name}`);
      const result = await tool.run(arg);
      setMsgs((m) => [...m, { role: "tool", tool: name, text: echo, result }]);
      // A tool run is real work, so let the chat act on what it found.
      if (!result.ok) {
        setMsgs((m) => [
          ...m,
          { role: "bot", text: `Nothing came back for that.\n\nTry a shorter query, or /list_files to see what is there.` },
        ]);
      }
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "error", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");

    const cmd = parseCommand(text);
    if (cmd) {
      void runTool(cmd.name, cmd.arg, text);
      return;
    }

    setMsgs((m) => [...m, { role: "user", text }]);

    const file = FILE_BLOCK.exec(text);
    if (file) {
      const path = (file[1] ?? "untitled.md").trim();
      const body = file[2] ?? "";
      const lang = path.slice(path.lastIndexOf(".") + 1) || "md";
      const saved = saveArtifact({ path, language: lang, body });
      setArts(listArtifacts());
      setMsgs((m) => [
        ...m,
        { role: "bot", text: `Saved ${saved.path} (${body.length} chars). It is in the artifacts panel on the right and survives a reload.` },
      ]);
      return;
    }

    // Free-form: ask the server-side router, which picks a provider. The
    // browser never holds a vendor key.
    void askRouter(text);
  }

  async function askRouter(prompt: string) {
    setBusy(true);
    try {
      const history = msgs
        .filter((m): m is Extract<Msg, { role: "user" }> => m.role === "user")
        .map((m) => ({ role: "user" as const, content: m.text }))
        .slice(-8);
      const res = await fetch("/llm/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are the assistant inside Lolo Studio. The user is working with the browser-use/jev-ultrafast repository. Tools are invoked by the user with slash commands such as /list_files, /search_files, /open_file. Keep answers short and concrete.",
            },
            ...history,
            { role: "user" as const, content: prompt },
          ],
        }),
      });
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        lolo?: { provider?: string; fellBack?: boolean; note?: string };
        error?: { message?: string };
      };
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `router returned ${res.status}`);
      }
      const content = json.choices?.[0]?.message?.content?.trim();
      const meta = json.lolo;
      setMsgs((m) => [
        ...m,
        {
          role: "bot",
          text:
            (content || "(the model returned nothing)") +
            (meta?.provider ? `\n\n— answered by ${meta.provider}${meta.fellBack ? ` (${meta.note})` : ""}` : ""),
        },
      ]);
    } catch (e) {
      // The router degrades on its own; if it cannot answer at all, say so
      // plainly instead of inventing a reply.
      setMsgs((m) => [
        ...m,
        {
          role: "error",
          text:
            `${e instanceof Error ? e.message : String(e)}\n\nNo model answered. Tools still work without one — try /repo_stats or /list_files.`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(
    () => ({ files: arts.length, bytes: arts.reduce((s, a) => s + a.body.length, 0) }),
    [arts],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <Link to="/" className="btn-ghost px-2 py-1" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-ember]" />
          <span className="text-[14px] font-medium tracking-tight text-ink-1">Studio</span>
          <span className="mono-label hidden text-[9px] sm:inline">full-screen</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-ink-4 sm:inline">
            {counts.files} file{counts.files === 1 ? "" : "s"} · {counts.bytes} chars
          </span>
          <Link to="/projects/" className="btn-ghost px-2.5 py-1 text-[12px]">Projects</Link>
        </div>
      </header>

      {/* Wide working surface: tools | conversation | artifacts */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)_300px]">
        {/* Tools — always visible, no setup step */}
        <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-line p-3 lg:flex">
          <p className="mono-label mb-2 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
            tools · live
          </p>
          <div className="space-y-1">
            {TOOLS.map((t) => (
              <button
                key={t.name}
                type="button"
                disabled={busy}
                onClick={() => void runTool(t.name, "", `/${t.name}`)}
                className="group flex w-full items-start gap-2 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
                title={`/${t.name}`}
              >
                <FolderTree className="mt-0.5 size-3.5 shrink-0 text-ink-4 group-hover:text-ember]" />
                <span className="min-w-0">
                  <span className="block font-mono text-[11.5px] text-ink-1">/{t.name}</span>
                  <span className="block truncate text-[10.5px] text-ink-4">{t.blurb}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-ink-4">
            Tools hit the public GitHub API. No key needed.
          </p>
        </aside>

        {/* Conversation */}
        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            <div className="mx-auto w-full max-w-[1100px] space-y-4">
              {msgs.map((m, i) => (
                <MsgRow key={i} m={m} />
              ))}
              {busy && (
                <div className="flex items-center gap-2 font-mono text-[12px] text-ink-4">
                  <Loader2 className="size-3.5 animate-spin" /> running tool…
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-line px-4 py-3 sm:px-8">
            <div className="mx-auto w-full max-w-[1100px]">
              <div className="flex flex-wrap gap-1.5 pb-2">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setInput(e)}
                    className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-1"
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2 rounded-[12px] border border-line bg-surface-1 p-2 focus-within:border-line-strong">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  placeholder="Type a slash command, or paste a file in a ```path block…"
                  className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-1 font-mono text-[13px] text-ink-1 outline-none placeholder:text-ink-4"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !input.trim()}
                  className="btn-primary shrink-0 px-3 py-1.5 text-[12px] disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Artifacts — files the chat produced */}
        <aside className="hidden min-h-0 flex-col border-l border-line lg:flex">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            <FileText className="size-3.5 text-ink-4" />
            <span className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
              files by chat
            </span>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => arts.length && download("lolo-artifacts.txt", exportBundle())}
                className="btn-ghost px-1.5 py-0.5"
                title="Download all"
                aria-label="Download all"
              >
                <Download className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { clearArtifacts(); setArts([]); }}
                className="btn-ghost px-1.5 py-0.5"
                title="Clear all"
                aria-label="Clear all"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {arts.length === 0 ? (
              <p className="px-2 py-3 font-mono text-[11px] leading-relaxed text-ink-4">
                No files yet. Ask the chat for one and wrap it in a fenced
                block starting with its path.
              </p>
            ) : (
              <ul className="space-y-1">
                {arts.map((a) => (
                  <li key={a.id} className="group rounded-[9px] px-2 py-1.5 hover:bg-surface-2">
                    <div className="flex items-start gap-1.5">
                      <FileText className="mt-0.5 size-3 shrink-0 text-ink-4" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-1">
                        {a.path}
                      </span>
                      <button
                        type="button"
                        onClick={() => { deleteArtifact(a.id); setArts(listArtifacts()); }}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Delete ${a.path}`}
                      >
                        <Trash2 className="size-3 text-ink-4 hover:text-ember]" />
                      </button>
                    </div>
                    <p className="ml-[18px] font-mono text-[10px] text-ink-4">
                      {a.body.length} chars
                    </p>
                    <pre className="ml-[18px] mt-1 max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-ink-3">
                      {a.body.slice(0, 400)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MsgRow({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[12px] rounded-br-[4px] bg-surface-3 px-3.5 py-2">
          <p className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-ink-1">{m.text}</p>
        </div>
      </div>
    );
  }
  if (m.role === "tool") {
    return (
      <div className="rounded-[12px] border border-line bg-surface-1">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <Search className="size-3 text-ember]" />
          <span className="font-mono text-[11px] text-ink-2">/{m.tool}</span>
          <span className="ml-auto font-mono text-[10.5px] text-ink-4">{m.result.summary}</span>
        </div>
        {m.result.lines.length > 0 ? (
          <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {m.result.lines.join("\n")}
          </pre>
        ) : (
          <p className="px-3 py-2 font-mono text-[11.5px] text-ink-4">no matches</p>
        )}
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div className="flex items-start gap-2 rounded-[12px] border border-[#c85a50]/40 bg-[#c85a50]/10 px-3.5 py-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#c85a50]" />
        <p className="font-mono text-[12px] leading-relaxed text-ink-2">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] gap-2.5 rounded-[12px] rounded-bl-[4px] border border-line bg-surface-1 px-3.5 py-2">
        <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-ember]" />
        <p className="whitespace-pre-wrap text-[13px] leading-[1.7] text-ink-2">{m.text}</p>
      </div>
    </div>
  );
}