import { Logo } from "@/components/AppShell";
import { useTheme } from "@/hooks/use-theme";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Blocks, Bot, Cloud,
  Code2, Globe, Menu, MessageSquare, Moon, ShieldCheck, Sun, Workflow, X,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";

const modules = [
  { route: "/messages", label: "MESSAGING", name: "Team messaging", description: "Ruang komunikasi tim melalui Rocket.Chat.", source: "Rocket.Chat", icon: MessageSquare, tone: "text-sky-500", number: "01" },
  { route: "/browser", label: "AUTOMATION", name: "Browser agent", description: "Workspace untuk tugas navigasi dan otomasi web.", source: "OpenBrowser AI", icon: Globe, tone: "text-violet-500", number: "02" },
  { route: "/security", label: "SECURITY", name: "Security lab", description: "Alur pengujian terotorisasi dengan batas scope.", source: "Strix", icon: ShieldCheck, tone: "text-emerald-500", number: "03" },
  { route: "/cloud", label: "STORAGE", name: "Cloud drive", description: "Kelola konfigurasi koneksi penyimpanan cloud.", source: "OmniCloud", icon: Cloud, tone: "text-cyan-500", number: "04" },
  { route: "/reverse-engineering", label: "ANALYSIS", name: "Reverse engineering", description: "Ruang kerja analisis aplikasi dan binary.", source: "REA", icon: Code2, tone: "text-amber-500", number: "05" },
  { route: "/deploy", label: "INFRASTRUCTURE", name: "Deploy & hosting", description: "Akses alur kerja deployment dan hosting.", source: "Railway", icon: Workflow, tone: "text-rose-500", number: "06" },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-ink-3"><span className="h-1.5 w-1.5 rounded-full bg-[#ef4444] shadow-[0_0_12px_rgba(239,68,68,.8)]" />{children}</span>;
}

export default function Landing() {
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 left-[42%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(239,68,68,.14),transparent_68%)] blur-2xl" />
        <div className="absolute right-[-180px] top-[620px] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(127,127,160,.13),transparent_70%)] blur-2xl" />
        <div className="absolute inset-0 opacity-[.035] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between rounded-2xl border border-border/80 bg-background/75 px-4 py-3 shadow-[0_8px_36px_rgba(0,0,0,.06)] backdrop-blur-2xl sm:rounded-full sm:px-5">
          <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="LOLODOMAIN.ID beranda">
            <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2"><Logo /></span>
            <span className="leading-tight"><span className="block text-sm font-semibold tracking-[.08em] text-ink-1">LOLODOMAIN<span className="text-[#ef4444]">.</span>ID</span><span className="mt-0.5 block font-mono text-[9px] tracking-[.16em] text-ink-4">AGENT WORKSPACE</span></span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            <a href="#platform" className="text-sm text-ink-3 transition hover:text-ink-1">Platform</a>
            <a href="#modules" className="text-sm text-ink-3 transition hover:text-ink-1">Modul</a>
            <a href="#security" className="text-sm text-ink-3 transition hover:text-ink-1">Keamanan</a>
            <Link to="/integrations" className="text-sm text-ink-3 transition hover:text-ink-1">Integrasi</Link>
          </nav>

          <div className="flex items-center gap-2">
            <button type="button" onClick={toggle} aria-label={theme === "dark" ? "Aktifkan tema terang" : "Aktifkan tema gelap"} className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-surface-1 text-ink-2 transition hover:border-[#ef4444]/50 hover:text-ink-1">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Link to="/auth" className="hidden rounded-full bg-ink-1 px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-85 sm:inline-flex">Masuk <ArrowUpRight className="ml-2 size-4" /></Link>
            <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Tutup menu" : "Buka menu"} className="inline-flex size-10 items-center justify-center rounded-full border border-border md:hidden">{menuOpen ? <X size={17} /> : <Menu size={17} />}</button>
          </div>
        </div>
        {menuOpen && <nav className="mx-auto mt-2 grid max-w-7xl gap-1 rounded-2xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur-2xl md:hidden">
          {[["#platform", "Platform"], ["#modules", "Modul"], ["#security", "Keamanan"], ["/integrations", "Integrasi"]].map(([href, label]) => href.startsWith("/") ? <Link key={href} to={href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-3 text-sm text-ink-2 hover:bg-surface-2">{label}</Link> : <a key={href} href={href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-3 text-sm text-ink-2 hover:bg-surface-2">{label}</a>)}
          <Link to="/auth" onClick={() => setMenuOpen(false)} className="mt-1 rounded-xl bg-ink-1 px-3 py-3 text-center text-sm font-semibold text-background">Masuk ke workspace <ArrowRight className="ml-1 inline size-4" /></Link>
        </nav>}
      </header>

      <section id="platform" className="relative mx-auto grid min-h-[92svh] max-w-7xl items-center gap-12 px-5 pb-20 pt-36 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:gap-16 lg:pb-24 lg:pt-40">
        <div className="relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/75 px-3.5 py-2 shadow-sm backdrop-blur-xl"><Eyebrow>CONTROL PLANE · LOLODOMAIN.ID</Eyebrow></div>
          <h1 className="max-w-4xl text-[clamp(3.1rem,8.6vw,7.2rem)] font-semibold leading-[.94] tracking-[-.075em] text-ink-1">
            Satu ruang.
            <br />Banyak <span className="font-serif font-normal italic text-[#ef4444]">kemungkinan.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-ink-2 sm:text-lg sm:leading-8">Workspace agent yang menyatukan modul komunikasi, browser, keamanan, cloud, analisis, dan deployment dalam satu antarmuka yang teratur.</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/auth" className="group inline-flex items-center rounded-full bg-[#ef4444] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(239,68,68,.22)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#dc2626]">Buka workspace <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" /></Link>
            <Link to="/integrations" className="inline-flex items-center rounded-full border border-border bg-surface-1/70 px-6 py-3.5 text-sm font-medium text-ink-1 backdrop-blur-xl transition hover:border-[#ef4444]/50">Jelajahi modul <ArrowDownRight className="ml-2 size-4" /></Link>
          </div>
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-6">
            <div><p className="text-2xl font-semibold tracking-tight text-ink-1">01<span className="text-[#ef4444]">.</span></p><p className="mt-1 text-xs text-ink-3">Satu identitas</p></div>
            <div><p className="text-2xl font-semibold tracking-tight text-ink-1">06<span className="text-[#ef4444]">.</span></p><p className="mt-1 text-xs text-ink-3">Rute modul</p></div>
            <div><p className="text-2xl font-semibold tracking-tight text-ink-1">RBAC<span className="text-[#ef4444]">.</span></p><p className="mt-1 text-xs text-ink-3">Akses terkontrol</p></div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute -inset-6 rounded-[2.5rem] bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,.12),transparent_68%)] blur-2xl" />
          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#101014] p-4 text-white shadow-[0_35px_100px_rgba(0,0,0,.28)] sm:p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-white/[.07]"><Bot size={19} /></span><div><p className="text-sm font-medium">Lolo Control</p><p className="mt-1 font-mono text-[10px] text-white/45">WORKSPACE OVERVIEW</p></div></div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[9px] tracking-wider text-white/55">PREVIEW</span>
            </div>
            <div className="grid grid-cols-2 gap-3 py-5">
              <div className="rounded-2xl border border-white/10 bg-white/[.045] p-4"><p className="font-mono text-[9px] tracking-widest text-white/45">MODULE REGISTRY</p><p className="mt-3 text-3xl font-semibold">06</p><p className="mt-1 text-xs text-white/50">Rute terdaftar</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/[.045] p-4"><p className="font-mono text-[9px] tracking-widest text-white/45">ACCESS CONTROL</p><p className="mt-3 text-3xl font-semibold">RBAC</p><p className="mt-1 text-xs text-white/50">Izin berbasis peran</p></div>
            </div>
            <div className="space-y-2">
              {modules.slice(0, 4).map((item) => {
                const Icon = item.icon;
                return <Link to={item.route} key={item.route} className="group flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3 transition duration-300 hover:translate-x-1 hover:border-white/20 hover:bg-white/[.06]">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-white/[.06]"><Icon size={16} className={item.tone} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm text-white/90">{item.name}</span><span className="mt-0.5 block truncate text-[11px] text-white/40">{item.source}</span></span>
                  <ArrowUpRight size={15} className="text-white/30 transition group-hover:text-white" />
                </Link>;
              })}
            </div>
            <p className="mt-4 border-t border-white/10 pt-4 font-mono text-[9px] tracking-[.12em] text-white/35">MODULE CONFIGURATION ≠ LIVE CONNECTION</p>
          </div>
          <div className="absolute -right-2 top-16 hidden rounded-2xl border border-border/70 bg-background/85 p-3 shadow-xl backdrop-blur-xl sm:block"><div className="flex items-center gap-2"><Blocks size={15} className="text-[#ef4444]" /><span className="text-xs font-medium text-ink-1">Modular by design</span></div><p className="mt-1 pl-6 text-[10px] text-ink-3">Satu pintu masuk, izin terpisah</p></div>
        </div>
      </section>

      <section id="modules" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="mb-10 flex flex-col justify-between gap-5 sm:mb-14 md:flex-row md:items-end">
          <div><Eyebrow>MODULAR ECOSYSTEM</Eyebrow><h2 className="mt-5 max-w-2xl text-4xl font-semibold tracking-[-.055em] text-ink-1 sm:text-6xl">Semua alat, <span className="font-serif font-normal italic text-[#ef4444]">tertata.</span></h2></div>
          <p className="max-w-md text-sm leading-6 text-ink-3">Setiap modul punya halaman dan batas tanggung jawab sendiri. Status koneksi tidak dianggap aktif hanya karena konfigurasi tersimpan.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((item) => {
            const Icon = item.icon;
            return <Link key={item.route} to={item.route} className="group relative overflow-hidden rounded-3xl border border-border bg-surface-1/65 p-5 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#ef4444]/35 hover:shadow-[0_18px_50px_rgba(0,0,0,.08)] sm:p-6">
              <div className="mb-9 flex items-start justify-between"><span className="flex size-11 items-center justify-center rounded-2xl border border-border bg-surface-2"><Icon size={19} className={item.tone} /></span><span className="font-mono text-[10px] tracking-widest text-ink-4">{item.number}</span></div>
              <p className="font-mono text-[9px] tracking-[.18em] text-ink-4">{item.label}</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink-1">{item.name}</h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-ink-3">{item.description}</p>
              <div className="mt-5 flex items-center justify-between border-t border-border pt-4"><span className="text-xs text-ink-2">{item.source}</span><span className="flex size-8 items-center justify-center rounded-full border border-border transition group-hover:border-[#ef4444]/40 group-hover:bg-[#ef4444] group-hover:text-white"><ArrowUpRight size={15} /></span></div>
            </Link>;
          })}
        </div>
        <div className="mt-5 rounded-2xl border border-border bg-surface-2/70 px-5 py-4 text-xs leading-5 text-ink-3"><span className="font-semibold text-ink-1">Transparan soal status:</span> daftar ini menunjukkan rute modul yang tersedia di aplikasi. Koneksi ke layanan upstream harus dikonfigurasi dan diverifikasi terpisah.</div>
      </section>

      <section id="security" className="relative mx-auto max-w-7xl px-5 pb-24 pt-8 sm:px-8 sm:pb-32">
        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-surface-1/70 p-7 backdrop-blur-xl sm:p-12 lg:p-16">
          <div aria-hidden className="absolute -right-16 -top-20 size-72 rounded-full bg-[radial-gradient(circle,rgba(239,68,68,.14),transparent_68%)]" />
          <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div><Eyebrow>SECURITY BY DEFAULT</Eyebrow><h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-[-.05em] text-ink-1 sm:text-5xl">Akses seperlunya.<br /><span className="font-serif font-normal italic text-[#ef4444]">Kendali tetap di tanganmu.</span></h2><p className="mt-5 max-w-2xl text-sm leading-7 text-ink-3 sm:text-base">Login dan pemeriksaan peran tetap menjadi gerbang workspace. Operasi sensitif perlu izin eksplisit; token layanan tidak ditaruh di frontend.</p></div>
            <Link to="/integrations" className="inline-flex w-fit items-center rounded-full border border-border bg-background px-5 py-3 text-sm font-medium text-ink-1 transition hover:border-[#ef4444]/50">Lihat integrasi <ArrowRight className="ml-2 size-4" /></Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between"><Link to="/" className="flex items-center gap-2"><Logo className="size-5" /><span className="font-semibold tracking-[.1em] text-ink-1">LOLODOMAIN.ID</span></Link><p>Agent workspace · Modular, responsif, dan transparan soal status koneksi.</p><Link to="/auth" className="inline-flex items-center gap-1 text-ink-2 transition hover:text-[#ef4444]">Masuk <ArrowUpRight size={13} /></Link></div>
      </footer>
    </main>
  );
}
