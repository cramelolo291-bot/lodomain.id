import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Link } from "react-router";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleDashed, ExternalLink, ShieldCheck, Workflow } from "lucide-react";

const modules: Record<string, { name: string; category: string; description: string; source: string; repo: string; capabilities: string[]; safety: string }> = {
  messages: { name: "Team messaging", category: "COMMUNICATION", description: "Satukan komunikasi tim dalam ruang khusus, tanpa mencampur percakapan dengan alat developer lain.", source: "Rocket.Chat", repo: "https://github.com/RocketChat/Rocket.Chat", capabilities: ["Workspace dan channel", "Percakapan langsung dan kolaborasi", "Integrasi identitas melalui adapter"], safety: "Gunakan instance dan kredensial Rocket.Chat milik sendiri. Data pesan tidak disalin otomatis ke database Lolo." },
  browser: { name: "Browser agent", category: "AUTOMATION", description: "Workspace terpisah untuk mengelola tugas otomasi browser, status sesi, dan hasil eksekusi.", source: "OpenBrowser AI", repo: "https://github.com/billy-enrizky/openbrowser-ai", capabilities: ["Tugas navigasi dan ekstraksi web", "Status run dan output", "Kontrol sesi browser"], safety: "Browser berjalan di worker terisolasi. Jangan beri akses ke akun atau situs tanpa izin." },
  security: { name: "Security lab", category: "SECURITY", description: "Alur kerja pengujian keamanan aplikasi dengan scope, persetujuan, dan catatan hasil yang jelas.", source: "Strix", repo: "https://github.com/usestrix/strix", capabilities: ["Scope target yang diizinkan", "Daftar temuan dan tingkat risiko", "Catatan pengujian dan mitigasi"], safety: "Hanya jalankan terhadap sistem milik sendiri atau yang secara eksplisit memberi izin. Eksekusi scanner belum aktif dari halaman ini." },
  cloud: { name: "Cloud drive", category: "STORAGE", description: "Titik masuk untuk mengelola koneksi penyimpanan dari berbagai provider melalui satu antarmuka.", source: "OmniCloud", repo: "https://github.com/dimartarmizi/OmniCloud", capabilities: ["Daftar provider penyimpanan", "Status koneksi dan sinkronisasi", "Penjelajahan file per provider"], safety: "Token provider wajib disimpan di secret store server, bukan localStorage atau kode frontend." },
  "reverse-engineering": { name: "Reverse engineering", category: "ANALYSIS", description: "Halaman kerja untuk analisis aplikasi, binary, dan perilaku runtime secara terisolasi.", source: "REA", repo: "https://github.com/morluto/rea", capabilities: ["Manajemen tugas analisis", "Artefak dan catatan hasil", "Worker terisolasi untuk file yang tidak tepercaya"], safety: "Analisis file tidak tepercaya harus berjalan di sandbox tanpa akses ke secret atau jaringan internal." },
  deploy: { name: "Deploy & hosting", category: "INFRASTRUCTURE", description: "Pusat kontrol untuk alur deploy dan observabilitas aplikasi melalui platform hosting.", source: "Railway", repo: "https://github.com/railwayapp", capabilities: ["Daftar project dan environment", "Riwayat deployment dan log", "Health-check dan status layanan"], safety: "Token Railway hanya berada di server. Aksi deploy/rollback harus meminta konfirmasi eksplisit." },
  design: { name: "Design quality", category: "DESIGN SYSTEM", description: "Pedoman review UI untuk menekan tampilan generik, efek berlebihan, dan komponen yang tidak punya fungsi.", source: "anti-slop", repo: "https://github.com/miqdadbadjuber/anti-slop", capabilities: ["Checklist hierarki visual", "Review responsivitas dan aksesibilitas", "Pemeriksaan konsistensi komponen"], safety: "Ini adalah pedoman kualitas, bukan service runtime atau scanner yang harus dijalankan." },
};

export default function ModulePage({ module }: { module: string }) {
  const item = modules[module];
  const [endpointUrl, setEndpointUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("not_configured");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!item) return;
    fetch("/api/modules", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Login diperlukan untuk mengelola koneksi.");
        if (!response.ok) throw new Error("Tidak dapat memuat konfigurasi modul.");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const row = payload.items?.find((entry: { key: string }) => entry.key === module);
        setEndpointUrl(row?.endpointUrl ?? "");
        setEnabled(Boolean(row?.enabled));
        setStatus(row?.status ?? "not_configured");
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Gagal memuat modul.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [module, item]);
  if (!item) return <AppShell><div className="mx-auto max-w-3xl px-5 py-16"><h1 className="display text-3xl text-ink-1">Module not found</h1><Link className="btn-ghost mt-5 inline-flex" to="/integrations">Back to workspace</Link></div></AppShell>;

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[980px] px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
          <Link to="/integrations" className="inline-flex items-center gap-2 text-[12px] text-ink-3 transition-colors hover:text-ink-1"><ArrowLeft className="size-3.5" /> All modules</Link>
          <p className="eyebrow mt-8">LOLODOMAIN.ID / {item.category}</p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-[680px]"><h1 className="display text-[clamp(34px,5vw,52px)] leading-tight text-ink-1">{item.name}</h1><p className="mt-4 text-[14px] leading-7 text-ink-3">{item.description}</p></div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[10px] text-amber-600"><CircleDashed className="size-3.5" /> {status.replace(/_/g, " ").toUpperCase()}</span>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
            <section className="glass rounded-2xl p-5 sm:p-6">
              <div className="flex items-center gap-2"><Workflow className="size-4 text-ember" /><h2 className="text-[15px] font-medium text-ink-1">Module workspace</h2></div>
              <p className="mt-2 text-[12px] leading-6 text-ink-3">Ruang ini sudah dipisahkan dari halaman lain. Runtime belum dianggap aktif sampai adapter, autentikasi, dan pemeriksaan health selesai disambungkan.</p>
              <div className="mt-5 space-y-3">{item.capabilities.map((cap) => <div key={cap} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2/60 p-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ink-3" /><span className="text-[12px] leading-5 text-ink-2">{cap}</span></div>)}</div>
            </section>
            <div className="space-y-4">
              <section className="glass rounded-2xl p-5"><p className="eyebrow">UPSTREAM PROJECT</p><h2 className="mt-2 text-[17px] font-medium text-ink-1">{item.source}</h2><p className="mt-2 text-[12px] leading-6 text-ink-3">Sumber terbuka yang akan menjadi adapter terpisah. Integrasi bukan berarti menyalin seluruh repo ke frontend utama.</p><a href={item.repo} target="_blank" rel="noreferrer" className="btn-ghost mt-4 inline-flex">View repository <ExternalLink className="size-3.5" /></a></section>
              <section className="glass rounded-2xl p-5">
                <p className="eyebrow">CONNECTION CONFIG</p>
                <h2 className="mt-2 text-[15px] font-medium text-ink-1">Konfigurasi layanan</h2>
                <p className="mt-2 text-[12px] leading-6 text-ink-3">Simpan URL endpoint untuk modul ini. Konfigurasi tidak menjalankan service dan tidak membuktikan koneksi sehat.</p>
                <form className="mt-4 space-y-3" onSubmit={async (event) => {
                  event.preventDefault();
                  setSaving(true); setNotice("");
                  try {
                    const response = await fetch("/api/modules/" + module, {
                      method: "PUT", credentials: "include",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ endpointUrl: endpointUrl.trim() || null, enabled }),
                    });
                    const payload = await response.json();
                    if (!response.ok) throw new Error(payload.error?.message ?? "Gagal menyimpan konfigurasi.");
                    setStatus(payload.status);
                    setNotice("Konfigurasi tersimpan. Runtime tetap nonaktif sampai adapter nyata dipasang.");
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : "Gagal menyimpan konfigurasi.");
                  } finally { setSaving(false); }
                }}>
                  <label className="block text-[11px] text-ink-3" htmlFor="module-endpoint">Endpoint URL (HTTPS)</label>
                  <input id="module-endpoint" type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://service.example.com" className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-ink-1 outline-none focus:border-ember" />
                  <label className="flex items-center gap-2 text-[12px] text-ink-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Aktifkan konfigurasi</label>
                  <button type="submit" disabled={saving || loading} className="btn-ghost inline-flex disabled:opacity-50">{saving ? "Menyimpan…" : "Simpan konfigurasi"}</button>
                </form>
                {notice && <p role="status" className="mt-3 text-[11px] leading-5 text-ink-3">{notice}</p>}
                {loading && <p className="mt-2 text-[11px] text-ink-4">Memuat status dari server…</p>}
              </section>
              <section className="rounded-2xl border border-line bg-surface-2/60 p-5"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-ember" /><h2 className="text-[13px] font-medium text-ink-1">Isolation & security</h2></div><p className="mt-2 text-[12px] leading-6 text-ink-3">{item.safety}</p></section>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"><span className="text-[11px] text-ink-4">Status: konfigurasi server-side · runtime belum diaktifkan</span><Link to="/server" className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 hover:text-ember">Open server console <ArrowUpRight className="size-3.5" /></Link></div>
        </div>
      </div>
    </AppShell>
  );
}
