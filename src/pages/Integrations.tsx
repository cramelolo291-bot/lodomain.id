import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Link } from "react-router";
import {
  ArrowUpRight, Cloud, Code2, Database, Globe, MessageSquare,
  Rocket, ShieldCheck, Sparkles,
} from "lucide-react";

const modules = [
  { id: "messages", name: "Team messaging", category: "COMMUNICATION", description: "Ruang percakapan, channel, dan kolaborasi tim.", source: "Rocket.Chat", repo: "https://github.com/RocketChat/Rocket.Chat", icon: MessageSquare, accent: "text-sky-500", route: "/messages" },
  { id: "browser", name: "Browser agent", category: "AUTOMATION", description: "Jalankan tugas web melalui browser yang dikendalikan agen.", source: "OpenBrowser AI", repo: "https://github.com/billy-enrizky/openbrowser-ai", icon: Globe, accent: "text-violet-500", route: "/browser" },
  { id: "security", name: "Security lab", category: "SECURITY", description: "Rencanakan dan jalankan pengujian keamanan pada target yang diizinkan.", source: "Strix", repo: "https://github.com/usestrix/strix", icon: ShieldCheck, accent: "text-emerald-500", route: "/security" },
  { id: "cloud", name: "Cloud drive", category: "STORAGE", description: "Satu workspace untuk berbagai penyedia penyimpanan cloud.", source: "OmniCloud", repo: "https://github.com/dimartarmizi/OmniCloud", icon: Cloud, accent: "text-cyan-500", route: "/cloud" },
  { id: "reverse-engineering", name: "Reverse engineering", category: "ANALYSIS", description: "Analisis struktur aplikasi, perilaku program, dan binary.", source: "REA", repo: "https://github.com/morluto/rea", icon: Code2, accent: "text-amber-500", route: "/reverse-engineering" },
  { id: "deploy", name: "Deploy & hosting", category: "INFRASTRUCTURE", description: "Kelola alur deployment aplikasi melalui platform hosting.", source: "Railway", repo: "https://github.com/railwayapp", icon: Rocket, accent: "text-rose-500", route: "/deploy" },
  { id: "design", name: "Design quality", category: "DESIGN SYSTEM", description: "Aturan anti-template untuk UI yang lebih terarah dan tidak berlebihan.", source: "anti-slop", repo: "https://github.com/miqdadbadjuber/anti-slop", icon: Sparkles, accent: "text-fuchsia-500", route: "/design" },
];

export default function Integrations() {
  const [moduleStatuses, setModuleStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/modules", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 401 ? "login_required" : "unavailable");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setModuleStatuses(Object.fromEntries(payload.items.map((item: { key: string; status: string }) => [item.key, item.status])));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status = error instanceof Error && error.message === "login_required" ? "login_required" : "unavailable";
        setModuleStatuses(Object.fromEntries(modules.map((item) => [item.id, status])));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">LOLODOMAIN.ID / WORKSPACE</p>
              <h1 className="display mt-3 text-[clamp(34px,5vw,54px)] leading-[1.04] text-ink-1">One workspace.<br /><span className="text-ink-3">Separate tools.</span></h1>
              <p className="mt-4 max-w-[62ch] text-[14px] leading-7 text-ink-3">Semua modul dari satu tempat, tetapi setiap alat tetap punya halaman dan alur kerjanya sendiri. Navigasi dibuat ringkas supaya fitur tidak saling menumpuk.</p>
            </div>
            <div className="glass flex items-center gap-2 rounded-full px-3.5 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3"><span className="size-1.5 rounded-full bg-amber-500" /> Integration foundation</div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.id} className="glass group relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_24px_65px_-42px_var(--shadow-deep)]" style={{ animationDelay: `${index * 55}ms` }}>
                  <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-ember/5 blur-3xl transition-colors duration-500 group-hover:bg-ember/10" />
                  <div className="relative flex items-start justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2"><Icon className={`size-[18px] ${item.accent}`} /></span>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <span className="rounded-full border border-line px-2 py-1 font-mono text-[9px] tracking-wider text-ink-4">{item.category}</span>
                      <span className="rounded-full border border-line bg-surface-2/70 px-2 py-1 font-mono text-[9px] tracking-wider text-ink-3">{(moduleStatuses[item.id] ?? "loading").replace(/_/g, " ").toUpperCase()}</span>
                    </div>
                  </div>
                  <h2 className="relative mt-5 text-[17px] font-medium tracking-tight text-ink-1">{item.name}</h2>
                  <p className="relative mt-2 flex-1 text-[12.5px] leading-6 text-ink-3">{item.description}</p>
                  <div className="relative mt-5 flex items-center justify-between border-t border-line pt-3">
                    <span className="font-mono text-[10px] text-ink-4">SOURCE · {item.source}</span>
                    <Link to={item.route} className="inline-flex items-center gap-1.5 text-[12px] text-ink-1 transition-colors hover:text-ember">Open module <ArrowUpRight className="size-3.5" /></Link>
                  </div>
                </article>
              );
            })}
          </div>

          <section className="glass mt-5 flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2"><Database className="size-4 text-ember" /></span>
              <div><h2 className="text-[14px] font-medium text-ink-1">Satu database inti</h2><p className="mt-1 max-w-[65ch] text-[12px] leading-6 text-ink-3">Gunakan PostgreSQL yang sudah dipakai Lolo AI untuk identitas, metadata integrasi, job, dan audit log. File dan kredensial tiap layanan tetap mengikuti batas keamanan masing-masing.</p></div>
            </div>
            <Link to="/server" className="btn-ghost shrink-0">Server & data <ArrowUpRight className="size-3.5" /></Link>
          </section>
          <p className="mt-4 text-[11px] leading-5 text-ink-4">Status transparan: halaman modul dan katalog sumber sudah dipisahkan. Adapter runtime, OAuth/token vault, serta deployment per layanan perlu disambungkan dan diuji sebelum modul ditandai aktif.</p>
        </div>
      </div>
    </AppShell>
  );
}
