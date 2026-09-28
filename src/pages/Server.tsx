import { AppShell } from "@/components/AppShell";
import { api, MODELS, type PoolEntry, type Trace } from "@/lib/api";
import { ATTACK_TECHNIQUES, GUARDRAIL_LABELS, type Severity } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  KeyRound,
  Plus,
  Shield,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Tab = "pool" | "trace" | "usage" | "guardrails" | "keys";

const TABS: Array<{ key: Tab; label: string; icon: typeof Cpu }> = [
  { key: "pool", label: "Pool", icon: Cpu },
  { key: "trace", label: "Trace", icon: Activity },
  { key: "usage", label: "Usage", icon: TrendingUp },
  { key: "guardrails", label: "Guardrails", icon: Shield },
  { key: "keys", label: "API keys", icon: KeyRound },
];

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "cool" | "warm";
}) {
  return (
    <div className="panel p-4">
      <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tracking-tight",
          accent === "cool" ? "text-cool" : accent === "warm" ? "text-warm" : "text-ink-1",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[12px] text-ink-4">{sub}</p>}
    </div>
  );
}

function PoolRow({ entry }: { entry: PoolEntry }) {
  const tone =
    entry.status === "healthy"
      ? "text-cool"
      : entry.status === "cooling"
        ? "text-warm"
        : "text-ink-4";

  return (
    <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
      <div className="min-w-[180px] flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", tone)} />
          <span className="text-[14px] font-semibold text-ink-1">{entry.name}</span>
          <span className="font-mono text-[10px] text-ink-4">{entry.tag}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              entry.status === "healthy" ? "bg-cool" : "bg-warm",
            )}
            style={{ width: `${entry.health}%` }}
          />
        </div>
      </div>

      <dl className="flex gap-5 font-mono text-[11px] text-ink-4">
        <div>
          <dt className="text-ink-4/60">health</dt>
          <dd className="text-ink-2">{entry.health}</dd>
        </div>
        <div>
          <dt className="text-ink-4/60">slots</dt>
          <dd className="text-ink-2">
            {entry.inFlight}/{entry.maxParallel}
          </dd>
        </div>
        <div>
          <dt className="text-ink-4/60">vram</dt>
          <dd className="text-ink-2">{entry.vramGb}GB</dd>
        </div>
        <div>
          <dt className="text-ink-4/60">ok/fail</dt>
          <dd className="text-ink-2">
            {entry.successes}/{entry.failures}
          </dd>
        </div>
      </dl>

      <div className="flex items-center gap-1.5">
        {entry.status !== "healthy" ? (
          <button
            type="button"
            onClick={() => void api.setPoolStatus(entry.id, "healthy")}
            className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-3 transition-colors hover:border-cool hover:text-cool"
          >
            revive
          </button>
        ) : null}
        <button
          type="button"
          onClick={() =>
            void api.setPoolStatus(
              entry.id,
              entry.status === "disabled" ? "healthy" : "disabled",
            )
          }
          className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-3 transition-colors hover:border-[var(--border-strong)] hover:text-ink-1"
        >
          {entry.status === "disabled" ? "enable" : "disable"}
        </button>
        <button
          type="button"
          onClick={() => void api.removePoolEntry(entry.id)}
          aria-label="Hapus model"
          className="rounded-full p-1.5 text-ink-4 transition-colors hover:text-warm"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function TraceCard({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-4 p-4 text-left"
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            trace.ok ? "bg-cool" : "bg-warm",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] text-ink-1">{trace.prompt}</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-4">
            {trace.agent} · {trace.model} → {trace.poolEntry} ·{" "}
            {(trace.totalMs / 1000).toFixed(1)}s · ↑{trace.tokensIn} ↓
            {trace.tokensOut}
          </p>
        </div>
        <span className="font-mono text-[10px] text-ink-4">
          {open ? "hide" : `${trace.steps.length} steps`}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3.5">
          {trace.steps.map((s) => (
            <div key={s.id} className="flex items-center gap-3 font-mono text-[11px]">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  s.status === "ok"
                    ? "bg-cool"
                    : s.status === "blocked"
                      ? "bg-warm"
                      : "bg-[var(--accent-warm)]",
                )}
              />
              <span className="w-24 shrink-0 text-ink-2">{s.label}</span>
              <span className="min-w-0 flex-1 truncate text-ink-4">{s.detail}</span>
              <span className="shrink-0 text-ink-4">{s.ms}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SEVERITY_TONE: Record<Severity, string> = {
  low: "text-ink-3 bg-[var(--surface-2)]",
  medium: "text-warm bg-warm-soft",
  high: "text-warm bg-warm-soft",
  critical: "text-[var(--destructive)] bg-[rgba(248,113,113,0.12)]",
};

export default function Server() {
  const [tab, setTab] = useState<Tab>("pool");
  const [host, setHost] = useState<Awaited<ReturnType<typeof api.host>> | null>(null);
  const [pool, setPool] = useState<{
    entries: PoolEntry[];
    summary: Awaited<ReturnType<typeof api.pool>>["summary"];
  } | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(null);
  const [findings, setFindings] = useState<Awaited<ReturnType<typeof api.findings>> | null>(null);
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.listKeys>>>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setHost(await api.host());
    setPool(await api.pool());
    setTraces(await api.traces());
    setUsage(await api.usage());
    setFindings(await api.findings());
    setKeys(await api.listKeys());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const missing = MODELS.filter(
    (m) => !pool?.entries.some((e) => e.tag === m.tag),
  );

  return (
    <AppShell>
      <div className="scrollbar-thin h-full overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-5 pt-8 pb-16">
          <p className="eyebrow mb-3">self-hosted</p>
          <h1 className="text-3xl font-bold tracking-tight text-ink-1">
            Server
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-3">
            Semua yang jalan di mesin lo: pool model lokal, jejak tiap giliran,
            dan guardrail yang menyaring sebelum model-nya tersentuh.
          </p>

          {/* Host strip */}
          {host && (
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-[var(--surface-1)] px-4 py-3 font-mono text-[11px] text-ink-4">
              <span className="inline-flex items-center gap-1.5 text-cool">
                <span className="size-1.5 rounded-full bg-cool" />
                online
              </span>
              <span>{host.gpu}</span>
              <span>
                {host.vramTotalGb}GB VRAM · parallel {host.parallel}
              </span>
              <span className="truncate">{host.ollamaUrl}</span>
              <span>ollama {host.version}</span>
            </div>
          )}

          {/* Tabs */}
          <div className="mt-7 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] transition-all",
                  tab === t.key
                    ? "border-[var(--accent-cool)]/40 bg-cool-soft text-cool"
                    : "border-border text-ink-4 hover:border-[var(--border-strong)] hover:text-ink-2",
                )}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {tab === "pool" && pool && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="models"
                    value={`${pool.summary.healthy}/${pool.summary.total}`}
                    sub="sehat / total"
                    accent="cool"
                  />
                  <Stat
                    label="free slots"
                    value={pool.summary.freeSlots}
                    sub={`dari ${pool.summary.totalSlots} total`}
                  />
                  <Stat label="avg health" value={pool.summary.avgHealth} />
                  <Stat
                    label="vram"
                    value={`${pool.summary.vramUsedGb}/${pool.summary.vramTotalGb}GB`}
                    sub={
                      pool.summary.vramUsedGb > pool.summary.vramTotalGb
                        ? "over budget — model akan ke-evict"
                        : "dalam budget"
                    }
                    accent={
                      pool.summary.vramUsedGb > pool.summary.vramTotalGb
                        ? "warm"
                        : undefined
                    }
                  />
                </div>

                {pool.summary.vramUsedGb > pool.summary.vramTotalGb && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-[var(--accent-warm)]/30 bg-warm-soft px-4 py-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warm" />
                    <p className="text-[13px] leading-relaxed text-ink-2">
                      Total VRAM model yang aktif ({pool.summary.vramUsedGb}GB)
                      melebihi kapasitas {pool.summary.vramTotalGb}GB. Scheduler
                      akan evict model berulang kali buat muat — matikan yang nggak dipakai.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  {pool.entries.map((e) => (
                    <PoolRow key={e.id} entry={e} />
                  ))}
                </div>

                {missing.length > 0 && (
                  <div className="panel p-4">
                    <p className="text-[13px] font-semibold text-ink-2">
                      Tambah model ke pool
                    </p>
                    <p className="mt-1 text-[12px] text-ink-4">
                      Model harus sudah di-pull di Ollama (`ollama pull &lt;tag&gt;`).
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {missing.map((m) => (
                        <button
                          key={m.tag}
                          type="button"
                          onClick={async () => {
                            await api.addPoolEntry(m.tag);
                            await reload();
                            toast.success(`${m.label} ditambah ke pool`);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-ink-3 transition-colors hover:border-cool hover:text-cool"
                        >
                          <Plus className="size-3" />
                          {m.tag}
                          <span className="text-ink-4">{m.vramGb}GB</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "trace" && (
              <div className="space-y-2">
                <p className="mb-3 text-[12px] text-ink-4">
                  Setiap giliran, step demi step: guardrail → pool → muat model →
                  generate. Ini yang bikin "kenapa jawabannya gitu" bisa ditelusuri.
                </p>
                {traces.length === 0 ? (
                  <p className="panel p-6 text-center text-[13px] text-ink-4">
                    Belum ada trace. Kirim satu pesan di tab Chat dulu.
                  </p>
                ) : (
                  traces.map((t) => <TraceCard key={t.id} trace={t} />)
                )}
              </div>
            )}

            {tab === "usage" && usage && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="requests" value={usage.requests} accent="cool" />
                  <Stat label="tokens in" value={usage.tokensIn.toLocaleString()} />
                  <Stat label="tokens out" value={usage.tokensOut.toLocaleString()} />
                  <Stat
                    label="avg latency"
                    value={`${(usage.avgLatencyMs / 1000).toFixed(1)}s`}
                    sub={`${usage.failed} gagal`}
                    accent={usage.failed > 0 ? "warm" : undefined}
                  />
                </div>

                <div className="panel p-5">
                  <p className="mb-4 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    per model
                  </p>
                  <div className="space-y-2.5">
                    {usage.perModel.map((m) => {
                      const max = usage.perModel[0]?.count || 1;
                      return (
                        <div key={m.model} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate font-mono text-[11px] text-ink-3">
                            {m.model}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                            <div
                              className="h-full rounded-full bg-cool"
                              style={{ width: `${(m.count / max) * 100}%` }}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-ink-4">
                            {m.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {tab === "guardrails" && findings && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="findings"
                    value={findings.total}
                    sub="semua waktu"
                    accent={findings.total > 0 ? "warm" : "cool"}
                  />
                  <Stat
                    label="categories hit"
                    value={findings.byCategory.length}
                  />
                  <Stat
                    label="coverage"
                    value={ATTACK_TECHNIQUES.length}
                    sub="teknik aktif"
                  />
                </div>

                <div className="panel p-5">
                  <p className="mb-1 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    findings terbaru
                  </p>
                  {findings.recent.length === 0 ? (
                    <p className="mt-3 text-[13px] text-ink-4">
                      Nggak ada yang kena. Bagus.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {findings.recent.map((f) => (
                        <div
                          key={f.id}
                          className="flex flex-wrap items-center gap-3 border-b border-border pb-2 last:border-0"
                        >
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 font-mono text-[10px]",
                              SEVERITY_TONE[f.severity],
                            )}
                          >
                            {f.severity}
                          </span>
                          <span className="text-[13px] text-ink-1">
                            {GUARDRAIL_LABELS[f.category]}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-4">
                            {f.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="panel p-5">
                  <p className="mb-3 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    teknik yang diawasi
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ATTACK_TECHNIQUES.map((a) => (
                      <span key={a.name} className="tag tag-neutral">
                        {a.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "keys" && (
              <div className="space-y-4">
                <div className="panel p-5">
                  <p className="text-[14px] font-semibold text-ink-1">
                    API keys
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-4">
                    Temen lo bisa nyambungin editor atau CLI-nya langsung ke
                    server ini pakai key ini. Endpoint-nya OpenAI-compatible,
                    jadi cukup isi base URL + key.
                  </p>

                  <div className="mt-4 rounded-lg border border-border bg-[var(--bg-2)] p-3.5">
                    <p className="font-mono text-[10px] text-ink-4">base_url</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-cool">
                        {window.location.origin}/v1
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(
                            `${window.location.origin}/v1`,
                          );
                          toast.success("Base URL disalin");
                        }}
                        className="shrink-0 rounded p-1 text-ink-4 transition-colors hover:text-cool"
                        aria-label="Salin base URL"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {newSecret && (
                    <div className="mt-3 rounded-lg border border-cool/40 bg-cool-soft p-3.5">
                      <p className="font-mono text-[10px] text-cool">
                        Disalin? Ini ditampilkan sekali.
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink-1">
                          {newSecret}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(newSecret);
                            toast.success("Key disalin");
                          }}
                          className="shrink-0 rounded p-1 text-cool"
                          aria-label="Salin key"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      const { secret } = await api.createKey(
                        `Key ${keys.length + 1}`,
                      );
                      setNewSecret(secret);
                      setKeys(await api.listKeys());
                      toast.success("Key dibuat");
                    }}
                    className="btn-primary mt-4"
                  >
                    <Plus className="size-4" />
                    Buat key baru
                  </button>
                </div>

                <div className="space-y-2">
                  {keys.map((k) => (
                    <div
                      key={k.id}
                      className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4"
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          k.revoked ? "bg-ink-4" : "bg-cool",
                        )}
                      />
                      <span className="text-[13.5px] font-medium text-ink-1">
                        {k.name}
                      </span>
                      <code className="font-mono text-[11px] text-ink-4">
                        {k.prefix}
                      </code>
                      {k.revoked ? (
                        <span className="tag tag-neutral">revoked</span>
                      ) : (
                        <span className="tag">
                          <Check className="size-3" />
                          aktif
                        </span>
                      )}
                      <span className="flex-1" />
                      {k.lastUsedAt && (
                        <span className="font-mono text-[10px] text-ink-4">
                          last used{" "}
                          {new Date(k.lastUsedAt).toLocaleDateString("id-ID")}
                        </span>
                      )}
                      {!k.revoked && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.revokeKey(k.id);
                            setKeys(await api.listKeys());
                            toast.success("Key dicabut");
                          }}
                          className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-4 transition-colors hover:border-warm hover:text-warm"
                        >
                          revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
