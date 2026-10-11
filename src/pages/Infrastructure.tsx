import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Globe, LockKeyhole, Server, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Target = "audit" | "vps" | "dns" | "deploy" | "https";
type Plan = {
  id: string;
  target: Target;
  task: string;
  status: "planned";
  executionEnabled: false;
  approvalRequired: boolean;
  createdAt: string;
  steps: string[];
  safety: string[];
};

const TARGETS: { id: Target; title: string; description: string; icon: typeof Server }[] = [
  { id: "audit", title: "Infrastructure audit", description: "Susun checklist pemeriksaan tanpa mengubah server.", icon: ShieldCheck },
  { id: "vps", title: "VPS & server", description: "Rencanakan pemeriksaan layanan, resource, dan firewall.", icon: Server },
  { id: "dns", title: "DNS & domain", description: "Tinjau record, TTL, dan potensi konflik.", icon: Globe },
  { id: "deploy", title: "Deployment", description: "Rencanakan build, health-check, dan rollback.", icon: ArrowRight },
  { id: "https", title: "HTTPS / TLS", description: "Rencanakan sertifikat, reverse proxy, dan renewal.", icon: LockKeyhole },
];

export default function Infrastructure() {
  const { session } = useAuth();
  const [target, setTarget] = useState<Target>("audit");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);

  async function createPlan() {
    if (task.trim().length < 8) {
      toast.error("Jelaskan tugas minimal 8 karakter.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/infrastructure/plan", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: task.trim(), target }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? (response.status === 403 ? "Fitur ini hanya untuk admin." : "Gagal membuat rencana."));
      setPlan(payload as Plan);
      toast.success("Rencana berhasil dibuat — belum ada perubahan server.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API belum tersambung. Pastikan VITE_API_MODE=http dan server berjalan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="relative h-full overflow-y-auto">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-0 overflow-hidden"><div className="absolute left-[8%] top-12 h-64 w-64 rounded-full bg-ember/10 blur-[100px]" /><div className="absolute right-[5%] top-[34%] h-72 w-72 rounded-full bg-violet-500/5 blur-[110px]" /></div>
        <div className="mx-auto max-w-[1000px] px-5 pt-9 pb-16">
          <p className="eyebrow">LOLO.AI / INFRASTRUCTURE</p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="display text-[36px] text-ink-1 sm:text-[46px]">Infrastructure Agent</h1>
              <p className="mt-3 max-w-[60ch] text-[14px] leading-7 text-ink-3">Rencanakan operasi VPS, DNS, deployment, dan HTTPS dari satu tempat. Review dulu, baru putuskan tindakan berikutnya.</p>
            </div>
            <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3"><span className="size-1.5 rounded-full bg-ember" /> Plan-only mode</span>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TARGETS.map((item) => {
              const Icon = item.icon;
              const selected = target === item.id;
              return (
                <button key={item.id} type="button" onClick={() => setTarget(item.id)} className={`glass group p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-28px_var(--shadow-deep)] ${selected ? "border-ember/50 bg-ember-soft/50 shadow-[inset_0_1px_0_var(--spec)]" : "hover:border-line-strong"}`}>
                  <span className="flex items-center justify-between">
                    <Icon className={`size-4 ${selected ? "text-ember" : "text-ink-3"}`} />
                    <span className={`size-2 rounded-full border ${selected ? "border-ember bg-ember" : "border-ink-4"}`} />
                  </span>
                  <span className="mt-4 block text-[14px] text-ink-1">{item.title}</span>
                  <span className="mt-1.5 block text-[12px] leading-5 text-ink-4">{item.description}</span>
                </button>
              );
            })}
          </div>

          <section className="glass mt-5 p-5 shadow-[0_20px_60px_-40px_var(--shadow-deep)] sm:p-6">
            <div className="flex items-start gap-3">
              <span className="glass rounded-xl p-2"><Sparkles className="size-4 text-ember" /></span>
              <div>
                <h2 className="text-[15px] text-ink-1">Apa yang perlu dikerjakan?</h2>
                <p className="mt-1 text-[12px] leading-5 text-ink-4">Sebutkan target dan kondisi yang diketahui. Jangan masukkan password, private key, atau token.</p>
              </div>
            </div>
            <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={4} maxLength={2000} placeholder="Contoh: Audit konfigurasi VPS produksi, cek port yang terbuka, lalu susun rekomendasi HTTPS dan rollback tanpa mengubah konfigurasi." className="mt-4 w-full resize-y rounded-xl border border-line-strong bg-[rgba(var(--glass-rgb),0.025)] px-4 py-3 backdrop-blur-xl text-[13px] leading-6 text-ink-1 outline-none placeholder:text-ink-4 focus:border-ember/60" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-[10px] text-ink-4">{task.length}/2000 · {session?.role === "admin" ? "Admin session" : "Perlu akses admin"}</span>
              <button type="button" disabled={busy || task.trim().length < 8} onClick={() => void createPlan()} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Menyusun rencana…" : "Buat rencana"} <ArrowRight className="size-3.5" /></button>
            </div>
          </section>

          {plan && (
            <section className="panel mt-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">PLAN · {plan.id.slice(0, 8)}</p>
                  <h2 className="mt-2 text-[19px] text-ink-1">Rencana operasi</h2>
                  <p className="mt-1 text-[12px] text-ink-4">{new Date(plan.createdAt).toLocaleString("id-ID")} · {plan.target}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-ink-3"><ClipboardCheck className="size-3.5" /> Planned</span>
              </div>
              <p className="glass mt-4 rounded-lg p-3 text-[13px] leading-6 text-ink-2">{plan.task}</p>
              <ol className="mt-5 space-y-3">
                {plan.steps.map((step, index) => <li key={step} className="flex gap-3 text-[13px] leading-6 text-ink-2"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-ember">{index + 1}</span><span>{step}</span></li>)}
              </ol>
              <div className="glass mt-5 rounded-xl p-4">
                <p className="flex items-center gap-2 text-[13px] text-ink-1"><AlertTriangle className="size-4 text-ember" /> Batas keamanan</p>
                <ul className="mt-3 space-y-2">{plan.safety.map((item) => <li key={item} className="flex gap-2 text-[12px] leading-5 text-ink-4"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ember" />{item}</li>)}</ul>
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-ink-4">Status: plan-only · Eksekusi langsung dinonaktifkan</p>
            </section>
          )}

          <div className="glass mt-6 flex gap-3 rounded-xl p-4">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ember" />
            <p className="text-[12px] leading-5 text-ink-4">Agent belum terhubung ke provider VPS atau DNS. Panel ini membuat rencana yang dapat ditinjau; tidak mengaku sudah memeriksa server live, dan tidak menjalankan perintah.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
