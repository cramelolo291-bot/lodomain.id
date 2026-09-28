import { AppShell } from "@/components/AppShell";
import { PoolDiagram } from "@/components/Graphics";
import {
  api,
  type PoolAccount,
  type RouteDef,
  type Trace,
} from "@/lib/api";
import {
  ATTACK_TECHNIQUES,
  GUARDRAIL_LABELS,
  type Severity,
} from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plus,
  Shield,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Tab = "pool" | "trace" | "usage" | "guardrails" | "keys";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "pool", label: "Pool" },
  { key: "trace", label: "Trace" },
  { key: "usage", label: "Usage" },
  { key: "guardrails", label: "Guardrails" },
  { key: "keys", label: "Keys" },
];

function Stat({
  label,
  value,
  sub,
  hot,
}: {
  label: string;
  value: string | number;
  sub?: string;
  hot?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
        {label}
      </p>
      <p
        className={cn(
          "display mt-2 text-[28px] leading-none",
          hot ? "text-ember" : "text-ink-1",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-4">{sub}</p>}
    </div>
  );
}

function AccountRow({ account }: { account: PoolAccount }) {
  const tone =
    account.status === "healthy"
      ? "text-ember"
      : account.status === "cooling"
        ? "text-ink-3"
        : "text-ink-4";

  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
      <div className="min-w-[190px] flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", tone)} />
          <span className="text-[14px] text-ink-1">{account.label}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.06em] uppercase",
              account.tier === "subscribed"
                ? "bg-ember-soft text-ember"
                : "bg-surface-2 text-ink-4",
            )}
          >
            {account.tier}
          </span>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              account.status === "healthy" ? "bg-ember" : "bg-ink-4",
            )}
            style={{ width: `${account.health}%` }}
          />
        </div>
      </div>

      <dl className="flex flex-wrap gap-5 font-mono text-[11px]">
        {[
          ["health", String(account.health)],
          ["slots", `${account.inFlight}/${account.maxSlots}`],
          ["conc", `×${account.concurrency}`],
          ["ok/fail", `${account.successes}/${account.failures}`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-ink-4/60">{k}</dt>
            <dd className="mt-0.5 text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-1.5">
        {account.status !== "healthy" && (
          <button
            type="button"
            onClick={() => void api.setAccountStatus(account.id, "healthy")}
            className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-3 transition-colors hover:border-ember hover:text-ember"
          >
            revive
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            void api.setAccountStatus(
              account.id,
              account.status === "disabled" ? "healthy" : "disabled",
            )
          }
          className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-3 transition-colors hover:border-[rgba(244,241,234,0.2)] hover:text-ink-1"
        >
          {account.status === "disabled" ? "enable" : "disable"}
        </button>
        <button
          type="button"
          onClick={() => void api.removeAccount(account.id)}
          aria-label="Hapus akun"
          className="rounded-full p-1.5 text-ink-4 transition-colors hover:text-ember"
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
            trace.ok ? "bg-ember" : "bg-ink-4",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] text-ink-1">{trace.prompt}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-4">
            {trace.agent} · {trace.model} → {trace.account} ·{" "}
            {(trace.totalMs / 1000).toFixed(1)}s · ↑{trace.tokensIn} ↓
            {trace.tokensOut}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-ink-4">
          {open ? "hide" : `${trace.steps.length} steps`}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3.5">
          {trace.steps.map((s) => (
            <div key={s.id} className="flex items-center gap-3 font-mono text-[11px]">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  s.status === "ok"
                    ? "bg-ember"
                    : s.status === "blocked"
                      ? "bg-[#d96a5a]"
                      : "bg-ink-4",
                )}
              />
              <span className="w-20 shrink-0 text-ink-2">{s.label}</span>
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
  low: "text-ink-3 bg-surface-2",
  medium: "text-ink-2 bg-surface-3",
  high: "text-ember bg-ember-soft",
  critical: "text-[#d96a5a] bg-[rgba(217,106,90,0.12)]",
};

export default function Server() {
  const [tab, setTab] = useState<Tab>("pool");
  const [gateway, setGateway] = useState<
    Awaited<ReturnType<typeof api.gateway>> | null
  >(null);
  const [routes, setRoutes] = useState<RouteDef[]>([]);
  const [pool, setPool] = useState<Awaited<ReturnType<typeof api.pool>> | null>(
    null,
  );
  const [traces, setTraces] = useState<Trace[]>([]);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.usage>> | null>(
    null,
  );
  const [findings, setFindings] = useState<
    Awaited<ReturnType<typeof api.findings>> | null
  >(null);
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.listKeys>>>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    setGateway(await api.gateway());
    setRoutes(await api.routes());
    setPool(await api.pool());
    setTraces(await api.traces());
    setUsage(await api.usage());
    setFindings(await api.findings());
    setKeys(await api.listKeys());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <AppShell>
      <div className="scrollbar-thin h-full overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-5 pt-9 pb-16">
          <p className="eyebrow">self-hosted</p>
          <h1 className="display mt-4 text-[38px] text-ink-1 sm:text-[46px]">
            Server
          </h1>
          <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.7] text-ink-2">
            Pool akun, jejak tiap giliran, dan guardrail yang menyaring
            sebelum request meninggalkan server.
          </p>

          {gateway && (
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface-1 px-4 py-3 font-mono text-[11px] text-ink-4">
              <span className="inline-flex items-center gap-1.5 text-ember">
                <span className="size-1.5 rounded-full bg-ember" />
                {gateway.status}
              </span>
              <span>{gateway.listenAddr}</span>
              <span className="truncate">{gateway.upstream}</span>
              <span>keepalive {gateway.keepaliveMs / 1000}s</span>
              <span>credits {gateway.credits.toLocaleString("id-ID")}</span>
              <span>memory {gateway.memoryEnabled ? "on" : "off"}</span>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 font-mono text-[11px] transition-colors",
                  tab === t.key
                    ? "border-line-strong bg-surface-2 text-ink-1 shadow-[inset_0_1px_0_0_var(--spec)]"
                    : "border-border text-ink-4 hover:border-[rgba(244,241,234,0.2)] hover:text-ink-2",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {tab === "pool" && pool && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="akun"
                    value={`${pool.summary.healthy}/${pool.summary.total}`}
                    sub="sehat / total"
                    hot
                  />
                  <Stat
                    label="slot kosong"
                    value={pool.summary.freeSlots}
                    sub={`dari ${pool.summary.totalSlots} total`}
                  />
                  <Stat label="health rata-rata" value={pool.summary.avgHealth} />
                  <Stat
                    label="throughput"
                    value={`${pool.summary.totalSlots - pool.summary.freeSlots}/${pool.summary.totalSlots}`}
                    sub="slot terpakai"
                  />
                </div>

                <div className="panel p-5">
                  <p className="mb-2 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    routing
                  </p>
                  <PoolDiagram
                    accounts={pool.accounts.map((a) => ({
                      label: a.label,
                      health: a.health,
                      busy: a.inFlight >= a.maxSlots,
                    }))}
                    className="max-w-[520px]"
                  />
                </div>

                <div className="space-y-2">
                  {pool.accounts.map((a) => (
                    <AccountRow key={a.id} account={a} />
                  ))}
                </div>

                <div className="panel p-5">
                  <p className="text-[13.5px] text-ink-1">Tambah akun</p>
                  <p className="mt-1 text-[12px] text-ink-4">
                    Free dapat 1 slot, subscribed dapat 3. Token ditarik dari
                    server, bukan disimpan di browser.
                  </p>
                  {adding ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        const label = String(form.get("label") ?? "").trim();
                        const tier = form.get("tier") === "subscribed"
                          ? "subscribed"
                          : "free";
                        if (!label) return;
                        await api.addAccount(label, tier);
                        setAdding(false);
                        await reload();
                        toast.success("Akun ditambahkan");
                      }}
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      <input
                        name="label"
                        required
                        placeholder="subscribed-3"
                        className="min-w-[160px] flex-1 rounded-lg border border-border bg-bg-2 px-3 py-2 font-mono text-[12.5px] text-ink-1 outline-none placeholder:text-ink-4 focus:border-ember/60"
                      />
                      <select
                        name="tier"
                        className="rounded-lg border border-border bg-bg-2 px-3 py-2 font-mono text-[12.5px] text-ink-2 outline-none"
                      >
                        <option value="free">free · 1 slot</option>
                        <option value="subscribed">subscribed · 3 slot</option>
                      </select>
                      <button type="submit" className="btn-primary">
                        Simpan
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      className="btn-ghost mt-3"
                    >
                      <Plus className="size-4" />
                      Tambah
                    </button>
                  )}
                </div>
              </div>
            )}

            {tab === "trace" && (
              <div className="space-y-2">
                <p className="text-[13px] leading-[1.7] text-ink-4">
                  Setiap giliran dipecah jadi langkah: guardrail, resolusi
                  effort, klaim slot, upstream. Itu yang bikin "kenapa
                  jawabannya gitu" bisa ditelusuri.
                </p>
                {traces.length === 0 ? (
                  <p className="panel p-8 text-center text-[13px] text-ink-4">
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
                  <Stat label="request" value={usage.requests} hot />
                  <Stat label="tokens in" value={usage.tokensIn.toLocaleString()} />
                  <Stat
                    label="tokens out"
                    value={usage.tokensOut.toLocaleString()}
                  />
                  <Stat
                    label="latency rata-rata"
                    value={`${(usage.avgLatencyMs / 1000).toFixed(1)}s`}
                    sub={`${usage.failed} gagal`}
                    hot={usage.failed > 0}
                  />
                </div>

                <div className="panel p-5">
                  <p className="mb-4 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    per model
                  </p>
                  <div className="space-y-3">
                    {usage.perModel.map((m) => {
                      const max = usage.perModel[0]?.count || 1;
                      return (
                        <div key={m.model} className="flex items-center gap-3">
                          <span className="w-52 shrink-0 truncate font-mono text-[11px] text-ink-3">
                            {m.model}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className="h-full rounded-full bg-ember"
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

                <div className="panel p-5">
                  <p className="mb-4 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    endpoint
                  </p>
                  <ul className="space-y-2">
                    {routes.map((r) => (
                      <li
                        key={r.path}
                        className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px]"
                      >
                        <span className="w-12 shrink-0 text-ember">{r.method}</span>
                        <span className="text-ink-2">{r.path}</span>
                        <span className="text-ink-4">{r.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {tab === "guardrails" && findings && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="temuan"
                    value={findings.total}
                    sub="sepanjang waktu"
                    hot={findings.total > 0}
                  />
                  <Stat label="kategori kena" value={findings.byCategory.length} />
                  <Stat
                    label="cakupan"
                    value={ATTACK_TECHNIQUES.length}
                    sub="teknik aktif"
                  />
                </div>

                <div className="panel p-5">
                  <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    temuan terbaru
                  </p>
                  {findings.recent.length === 0 ? (
                    <p className="mt-3 text-[13px] text-ink-4">
                      Nggak ada yang kena.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-2.5">
                      {findings.recent.map((f) => (
                        <div
                          key={f.id}
                          className="flex flex-wrap items-center gap-3 border-b border-border pb-2.5 last:border-0 last:pb-0"
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
                  <p className="mb-3.5 font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                    teknik yang diawasi
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ATTACK_TECHNIQUES.map((a) => (
                      <span key={a.name} className="tag tag-quiet">
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
                  <p className="text-[14px] text-ink-1">API keys</p>
                  <p className="mt-1.5 text-[12.5px] leading-[1.7] text-ink-4">
                    Temen lo bisa nyambungin editor atau CLI-nya langsung ke
                    server ini. Endpoint-nya OpenAI-compatible, jadi cukup isi
                    base URL dan key.
                  </p>

                  <div className="mt-4 rounded-lg border border-border bg-bg-2 p-3.5">
                    <p className="font-mono text-[10px] text-ink-4">base_url</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ember">
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
                        className="shrink-0 rounded p-1 text-ink-4 transition-colors hover:text-ember"
                        aria-label="Salin base URL"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {newSecret && (
                    <div className="mt-3 rounded-lg border border-ember/40 bg-ember-soft p-3.5">
                      <p className="font-mono text-[10px] text-ember">
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
                          className="shrink-0 rounded p-1 text-ember"
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
                          k.revoked ? "bg-ink-4" : "bg-ember",
                        )}
                      />
                      <span className="text-[13.5px] text-ink-1">{k.name}</span>
                      <code className="font-mono text-[11px] text-ink-4">
                        {k.prefix}
                      </code>
                      {k.revoked ? (
                        <span className="tag tag-quiet">revoked</span>
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
                          className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-4 transition-colors hover:border-ember hover:text-ember"
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

          <div className="mt-14 flex flex-wrap items-center gap-4 border-t border-border pt-6 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
            <span className="inline-flex items-center gap-1.5">
              <Activity className="size-3" />
              pool
            </span>
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="size-3" />
              usage
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="size-3" />
              guardrails
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="size-3" />
              keys
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              {pool && pool.summary.freeSlots === 0 ? (
                <AlertTriangle className="size-3 text-ember" />
              ) : (
                <Check className="size-3" />
              )}
              {pool
                ? `${pool.summary.freeSlots} slot kosong`
                : "memuat…"}
            </span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
