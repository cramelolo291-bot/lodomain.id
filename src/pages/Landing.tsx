import { Logo } from "@/components/AppShell";
import { AGENTS, MODELS, HOST } from "@/lib/api";
import { ATTACK_TECHNIQUES } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Check,
  Copy,
  Cpu,
  Github,
  Layers,
  Shield,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

/** Adds `in-view` once an element scrolls into the viewport, then stops. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("in-view");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Section({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("reveal", className)}>
      {children}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-cool hover:text-cool"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {done ? "tersalin" : (label ?? "salin")}
    </button>
  );
}

export default function Landing() {
  return (
    <div className="relative overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 rounded-full border border-white/8 bg-background/60 p-1.5 pl-4 backdrop-blur-xl">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[14px] font-semibold tracking-tight text-ink-1">
              Lolo&nbsp;AI
            </span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {[
              ["#agents", "Agen"],
              ["#server", "Server"],
              ["#guardrail", "Guardrail"],
              ["#api", "API"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="text-[13px] font-medium text-ink-3 transition-colors hover:text-ink-1"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/auth" className="btn-ghost">
              Masuk
            </Link>
            <Link to="/auth" className="btn-primary">
              Coba gratis
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[92vh] items-center justify-center px-5 pt-36 pb-24">
        <div className="aurora" />
        <div className="vignette" />

        <div className="relative max-w-[840px] text-center">
          <span className="tag">self-hosted · multi-agent</span>

          <h1 className="mt-7 text-[clamp(40px,6.2vw,80px)] leading-[1.04] font-bold tracking-[-0.025em] text-ink-1">
            AI agent system
            <br />
            <span className="key-gradient">lo punya sendiri</span>
          </h1>

          <p className="mx-auto mt-6 max-w-[600px] text-[17px] leading-relaxed text-ink-2">
            Empat spesialis, satu pool model lokal, satu server. Lo ngobrol
            lewat web — teman lo ngobrol lewat{" "}
            <span className="font-serif text-[1.06em] text-cool italic">
              API key
            </span>
            . Nggak ada yang lewat vendor orang.
          </p>

          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/auth" className="btn-primary">
              Mulai sekarang
              <ArrowRight className="size-4" />
            </Link>
            <a href="#server" className="btn-ghost">
              Lihat arsitekturnya
            </a>
          </div>

          <div className="mt-10 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-full border border-border bg-background/50 px-5 py-2.5 backdrop-blur-sm">
            <span className="font-mono text-[11px] text-ink-4">
              <span className="text-cool">{MODELS.length}</span> model lokal
            </span>
            <span className="font-mono text-[11px] text-ink-4">
              <span className="text-cool">{AGENTS.length}</span> agen
            </span>
            <span className="font-mono text-[11px] text-ink-4">
              <span className="text-cool">{ATTACK_TECHNIQUES.length}</span> teknik
              diawasi
            </span>
            <span className="font-mono text-[11px] text-ink-4">
              <span className="text-cool">0</span> API key pihak ketiga
            </span>
          </div>
        </div>
      </section>

      {/* ── Agents ──────────────────────────────────────────────────── */}
      <section id="agents" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Section>
            <p className="eyebrow mb-5">the crew</p>
            <h2 className="max-w-[640px] text-[clamp(30px,4vw,50px)] leading-[1.1] font-bold tracking-[-0.02em] text-ink-1">
              Nggak ada satu model buat semua. Tiap masalah punya spesialisnya.
            </h2>
            <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-ink-3">
              Lolo nyusun dan memutuskan. Dua spesialis lain ngerjain bagian
              yang butuh penalaran atau kode. Kamu yang pilih, atau biar Lolo
              yang milih.
            </p>
          </Section>

          <div className="mt-12 grid gap-3 sm:grid-cols-2">
            {AGENTS.map((a) => (
              <Section key={a.key}>
                <div className="panel group h-full p-6 transition-all hover:-translate-y-1 hover:border-[var(--border-strong)]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg",
                        a.accent === "cool"
                          ? "bg-cool-soft text-cool"
                          : "bg-warm-soft text-warm",
                      )}
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold text-ink-1">
                        {a.name}
                      </p>
                      <p className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
                        {a.tagline}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-[14px] leading-relaxed text-ink-3">
                    {a.description}
                  </p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ── Server ──────────────────────────────────────────────────── */}
      <section id="server" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Section>
              <p className="eyebrow mb-5">your own server</p>
              <h2 className="text-[clamp(30px,4vw,50px)] leading-[1.1] font-bold tracking-[-0.02em] text-ink-1">
                Pool model yang ngerti VRAM lo
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-ink-3">
                Scheduler-nya cuma mau dispatch model yang beneran muat. Sisanya
                kena cooldown, bukan crash. Dan tiap giliran meninggalkan
                jejak: guardrail → pool → muat model → generate.
              </p>

              <ul className="mt-7 space-y-3">
                {[
                  "Health score & cooldown otomatis per model",
                  "Slot dan parallel dibatasi sesuai VRAM",
                  "Fallback ke model lain kalau satu gagal",
                  "Token asli dari Ollama, bukan estimasi",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-cool" />
                    <span className="text-[14.5px] text-ink-2">{item}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section>
              <div className="panel overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <Terminal className="size-3.5 text-ink-4" />
                  <span className="font-mono text-[11px] text-ink-4">
                    ollama · {HOST.ollamaUrl}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-cool">
                    <span className="size-1.5 rounded-full bg-cool" />
                    online
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  {MODELS.slice(0, 4).map((m) => (
                    <div key={m.tag} className="flex items-center gap-3">
                      <span className="size-1.5 shrink-0 rounded-full bg-cool" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
                        {m.tag}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-4">
                        {m.vramGb}GB
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border bg-[var(--bg-2)] px-4 py-3 font-mono text-[11px] text-ink-4">
                  {HOST.gpu} · {HOST.vramTotalGb}GB VRAM
                </div>
              </div>
            </Section>
          </div>
        </div>
      </section>

      {/* ── Guardrail ───────────────────────────────────────────────── */}
      <section id="guardrail" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Section>
            <p className="eyebrow mb-5">guardrails</p>
            <h2 className="max-w-[680px] text-[clamp(30px,4vw,50px)] leading-[1.1] font-bold tracking-[-0.02em] text-ink-1">
              Yang kena guardrail, <span className="key-gradient">nggak sampai ke model</span>
            </h2>
            <p className="mt-5 max-w-[580px] text-[16px] leading-relaxed text-ink-3">
              Rules deterministik jalan di setiap prompt sebelum apa pun dikirim
              ke GPU. Nol token, nol latency, dan turn-nya nggak pernah sampai
              ke model sama sekali.
            </p>
          </Section>

          <div className="mt-10 flex flex-wrap gap-1.5">
            {ATTACK_TECHNIQUES.map((a) => (
              <Section key={a.name}>
                <span className="tag tag-neutral">{a.name}</span>
              </Section>
            ))}
          </div>

          <Section>
            <div className="panel mt-6 p-5">
              <div className="flex items-center gap-2.5">
                <Shield className="size-4 text-warm" />
                <span className="text-[14px] font-semibold text-ink-1">
                  Red Team agent
                </span>
              </div>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-3">
                Rules cuma catch yang literal. Sisanya — serangan bertahap,
              instruksi yang disisipkan lewat konten, payload yang di-obfuscate
              — itu urusan Red Team agent, yang nyerang{" "}
                <span className="text-ink-2">sistemnya sendiri</span> dan
                laporkan temuan lengkap dengan severity.
              </p>
            </div>
          </Section>
        </div>
      </section>

      {/* ── API ─────────────────────────────────────────────────────── */}
      <section id="api" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Section>
            <p className="eyebrow mb-5">bring your friends</p>
            <h2 className="max-w-[640px] text-[clamp(30px,4vw,50px)] leading-[1.1] font-bold tracking-[-0.02em] text-ink-1">
              Teman lo cuma butuh <span className="key-gradient">satu key</span>
            </h2>
            <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-ink-3">
              Endpoint-nya OpenAI-compatible. Editor, CLI, atau framework apa
              pun yang ngerti OpenAI bisa langsung nunjuk ke server ini.
            </p>
          </Section>

          <Section>
            <div className="codeblock mt-8">
              <span className="text-ink-4">$</span>
              <code className="min-w-0 flex-1 truncate">
                curl {window.location.origin}/v1/chat/completions \
              </code>
              <CopyButton
                text={`curl ${window.location.origin}/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer sk-lolo-..." -d '{"model":"qwen3:8b","messages":[{"role":"user","content":"halo"}]}'`}
              />
            </div>
          </Section>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Terminal, path: "POST /v1/chat/completions", note: "OpenAI & Anthropic clients" },
              { icon: Cpu, path: "GET /v1/models", note: "katalog model aktif" },
              { icon: Layers, path: "GET /api/usage", note: "statistik request & token" },
            ].map((r) => (
              <Section key={r.path}>
                <div className="panel h-full p-4">
                  <r.icon className="size-4 text-cool" />
                  <p className="mt-3 font-mono text-[12px] text-ink-1">
                    {r.path}
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink-4">{r.note}</p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Section>
            <div className="panel relative overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
              <div className="aurora" />
              <div className="relative">
                <h2 className="text-[clamp(28px,4.4vw,52px)] leading-[1.08] font-bold tracking-[-0.02em] text-ink-1">
                  Server lo.
                  <br />
                  <span className="key-gradient">Model lo.</span>
                </h2>
                <p className="mx-auto mt-5 max-w-[480px] text-[15.5px] leading-relaxed text-ink-3">
                  Masuk pakai email, nggak perlu password. Dua menit, langsung
                  jalan.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <Link to="/auth" className="btn-primary">
                    Masuk ke Lolo
                    <ArrowRight className="size-4" />
                  </Link>
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost"
                  >
                    <Github className="size-4" />
                    Lihat di GitHub
                  </a>
                </div>
              </div>
            </div>
          </Section>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8">
        <div className="shell flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[13px] text-ink-3">Lolo AI</span>
          </div>
          <p className="font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
            powered by ollama · nothing leaves your machine
          </p>
        </div>
      </footer>
    </div>
  );
}
