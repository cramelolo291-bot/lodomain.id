import {
  EffortMatrix,
  HeroOrbit,
  Horizon,
  PipelineDiagram,
} from "@/components/Graphics";
import { Logo } from "@/components/AppShell";
import { AGENTS, GATEWAY_ROUTES, MODELS, TIER_LIMITS } from "@/lib/api";
import { ATTACK_TECHNIQUES } from "@/lib/guardrails";
import { ArrowRight, Check, Copy, MoveRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

/** Adds `in-view` once, then stops watching. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in-view");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`reveal ${className ?? ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-[rgba(244,241,234,0.2)] hover:text-ink-1"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {done ? "tersalin" : "salin"}
    </button>
  );
}

/** Effort rows for the matrix, pulled from the real catalog. */
const EFFORT_ROWS = [
  { id: "deepseek/* · z-ai/glm", efforts: ["low", "high", "max"] },
  { id: "stealth/ox-alpha", efforts: ["low", "high", "max"] },
  { id: "openai/gpt-6 · gemini-3.8", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "meta/muse-spark", efforts: ["minimal", "low", "medium", "high", "xhigh"] },
  { id: "solar · mimo · kimi", efforts: [] },
] as const;

export default function Landing() {
  return (
    <div className="relative overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 rounded-full border border-border bg-background/70 p-1.5 pl-4 backdrop-blur-xl">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[14px] font-medium tracking-tight text-ink-1">
              Lolo AI
            </span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            {[
              ["#crew", "Agen"],
              ["#gateway", "Gateway"],
              ["#models", "Model"],
              ["#guardrail", "Guardrail"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="text-[13px] text-ink-3 transition-colors hover:text-ink-1"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/auth" className="btn-ghost hidden sm:inline-flex">
              Masuk
            </Link>
            <Link to="/auth" className="btn-primary">
              Coba
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[100svh] items-center px-5 pt-32 pb-20">
        <div className="glow" />
        <div className="fade-out" />

        <div className="shell">
          <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <Reveal>
                <p className="eyebrow">Lolo AI</p>
              </Reveal>

              <Reveal delay={80}>
                <h1 className="display mt-6 text-[clamp(38px,6.4vw,74px)] text-ink-1">
                  Sistem agent AI
                  <br />
                  <span className="italic text-ember">milik lo sendiri.</span>
                </h1>
              </Reveal>

              <Reveal delay={160}>
                <p className="mt-7 max-w-[46ch] text-[16.5px] leading-[1.7] text-ink-2">
                  Satu portal untuk ngobrol, satu gateway untuk nyambungin ke
                  editor mana pun. Empat spesialis, satu pool akun, satu server
                  — dan nol request yang keluar tanpa lo izinkan.
                </p>
              </Reveal>

              <Reveal delay={240}>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link to="/auth" className="btn-primary">
                    Mulai
                    <ArrowRight className="size-4" />
                  </Link>
                  <a href="#gateway" className="btn-ghost">
                    Lihat cara kerjanya
                  </a>
                </div>
              </Reveal>

              <Reveal delay={320}>
                <dl className="mt-12 grid max-w-[30rem] grid-cols-3 gap-6">
                  {[
                    [String(AGENTS.length), "spesialis"],
                    [String(MODELS.length), "model"],
                    [String(ATTACK_TECHNIQUES.length), "serangan diawasi"],
                  ].map(([n, label]) => (
                    <div key={label}>
                      <dt className="display text-[28px] leading-none text-ink-1">
                        {n}
                      </dt>
                      <dd className="mt-2 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
                        {label}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            <Reveal delay={200} className="hidden lg:block">
              <HeroOrbit className="opacity-90" />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Crew ────────────────────────────────────────────────────── */}
      <section id="crew" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <Horizon className="-mb-16 h-24 opacity-60" />
          </Reveal>
          <Reveal>
            <h2 className="display max-w-[18ch] text-[clamp(28px,4.4vw,52px)] text-ink-1">
              Nggak ada satu model buat semua masalah.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-[52ch] text-[16px] leading-[1.7] text-ink-2">
              freebuff naik kelas karena memecah tugas ke agen spesialis, bukan
              karena modelnya lebih pintar. Lolo membawa pemisahan yang sama ke
              server lo sendiri.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-2">
            {AGENTS.map((a, i) => (
              <Reveal key={a.key} delay={i * 70}>
                <div className="h-full bg-surface-1 p-7 transition-colors hover:bg-surface-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        a.accent === "warm" ? "bg-ember" : "bg-[#9db4a8]",
                      )}
                    />
                    <h3 className="text-[15px] font-medium text-ink-1">
                      {a.name}
                    </h3>
                    <span className="font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
                      {a.tagline}
                    </span>
                  </div>
                  <p className="mt-3.5 text-[14px] leading-[1.7] text-ink-3">
                    {a.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Gateway ─────────────────────────────────────────────────── */}
      <section id="gateway" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <p className="eyebrow">the gateway</p>
          </Reveal>
          <Reveal delay={60}>
            <h2 className="display mt-6 max-w-[20ch] text-[clamp(28px,4.4vw,52px)] text-ink-1">
              Pool yang milih, bukan menebak.
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 max-w-[54ch] text-[16px] leading-[1.7] text-ink-2">
              Setiap request nge-rank akun berdasarkan health, lalu ngambil slot
              yang kosong. Kalau satu gagal, yang berikutnya. Kalau satu dapat
              401, langsung cooldown — bukan dicoba berulang.
            </p>
          </Reveal>

          <Reveal delay={160}>
            <div className="panel mt-12 p-6 sm:p-10">
              <PipelineDiagram />
            </div>
          </Reveal>

          <div className="mt-px grid gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-2">
            <Reveal>
              <div className="h-full bg-surface-1 p-7">
                <p className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
                  kapasitas per tier
                </p>
                <ul className="mt-4 space-y-3">
                  {(["free", "subscribed"] as const).map((tier) => (
                    <li
                      key={tier}
                      className="flex items-baseline gap-3 font-mono text-[12px]"
                    >
                      <span className="w-24 text-ink-2">{tier}</span>
                      <span className="text-ember">
                        {TIER_LIMITS[tier].slots} slot
                      </span>
                      <span className="text-ink-4">
                        × {TIER_LIMITS[tier].concurrency} concurrent
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-[13px] leading-[1.7] text-ink-4">
                  Konkurensi riil dibatasi jumlah slot. Free satu slot berarti
                  satu request pada satu waktu.
                </p>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="h-full bg-surface-1 p-7">
                <p className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
                  endpoint
                </p>
                <ul className="mt-4 space-y-2">
                  {GATEWAY_ROUTES.map((r) => (
                    <li
                      key={r.path}
                      className="flex items-baseline gap-3 font-mono text-[12px]"
                    >
                      <span className="w-12 shrink-0 text-ember">{r.method}</span>
                      <span className="min-w-0 truncate text-ink-2">
                        {r.path}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Models ──────────────────────────────────────────────────── */}
      <section id="models" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <p className="eyebrow">catalogue</p>
          </Reveal>
          <Reveal delay={60}>
            <h2 className="display mt-6 max-w-[20ch] text-[clamp(28px,4.4vw,52px)] text-ink-1">
              Katalog yang sama persis, effort-nya ikut.
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 max-w-[54ch] text-[16px] leading-[1.7] text-ink-2">
             Model yang nggak mendukung reasoning effort nggak error — field-nya
              dibuang sebelum request dikirim. Di bawah ini matriksnya, digambar
              langsung dari katalog.
            </p>
          </Reveal>

          <Reveal delay={160}>
            <div className="panel mt-12 overflow-x-auto p-6 sm:p-8">
              <EffortMatrix
                rows={EFFORT_ROWS.map((r) => ({ id: r.id, efforts: r.efforts }))}
                className="min-w-[440px]"
              />
            </div>
          </Reveal>

          <div className="mt-px overflow-hidden rounded-[14px] border border-border">
            {MODELS.slice(0, 6).map((m, i) => (
              <Reveal key={m.id} delay={i * 45}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border bg-surface-1 px-5 py-4 last:border-b-0">
                  <span className="w-14 shrink-0 font-mono text-[10px] text-ink-4">
                    {m.vendor}
                  </span>
                  <span className="min-w-[150px] flex-1 text-[14px] text-ink-1">
                    {m.label}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">
                    {m.contextK >= 1024 ? "1M" : `${m.contextK}K`}
                  </span>
                  {m.vision && (
                    <span className="tag tag-cool">vision</span>
                  )}
                  {m.efforts.length > 0 ? (
                    <span className="tag">{m.efforts.length} effort</span>
                  ) : (
                    <span className="tag tag-quiet">no effort</span>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Guardrail ───────────────────────────────────────────────── */}
      <section id="guardrail" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <p className="eyebrow">guardrail</p>
          </Reveal>
          <Reveal delay={60}>
            <h2 className="display mt-6 max-w-[22ch] text-[clamp(28px,4.4vw,52px)] text-ink-1">
              Yang kena filter, <span className="italic text-ember">nggak sampai ke model.</span>
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 max-w-[54ch] text-[16px] leading-[1.7] text-ink-2">
              Tujuh rule deterministik jalan sebelum apa pun dikirim. Nol token,
              nol latency, dan request-nya nggak pernah sampai ke akun
              mana pun. Sisanya — serangan bertahap, payload ter-obfuscate —
              urusan Red Team agent.
            </p>
          </Reveal>

          <div className="mt-11 flex flex-wrap gap-2">
            {ATTACK_TECHNIQUES.map((a, i) => (
              <Reveal key={a.name} delay={i * 35}>
                <span className="tag tag-quiet">{a.name}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bring friends ───────────────────────────────────────────── */}
      <section id="api" className="px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <h2 className="display max-w-[20ch] text-[clamp(28px,4.4vw,52px)] text-ink-1">
              Temen lo cuma butuh satu key.
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <div className="codeblock mt-9">
              <span className="text-ink-4">$</span>
              <code className="min-w-0 flex-1 truncate">
                curl {typeof window !== "undefined" ? window.location.origin : ""}
                /v1/chat/completions
              </code>
              <CopyButton
                text={`curl ${window.location.origin}/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer sk-lolo-..." -d '{"model":"z-ai/glm-5.3-flash","messages":[{"role":"user","content":"halo"}]}'`}
              />
            </div>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-5 flex items-center gap-2 text-[14px] text-ink-3">
              <MoveRight className="size-4 shrink-0 text-ink-4" />
              OpenAI-compatible, jadi Cursor, Cline, atau CLI apa pun bisa
              langsung nunjuk ke server lo.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section className="px-5 pb-24 pt-8 sm:pb-32">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[18px] border border-border bg-surface-1 px-6 py-16 text-center sm:px-12 sm:py-24">
              <div className="glow" />
              <div className="relative">
                <h2 className="display text-[clamp(30px,5vw,58px)] text-ink-1">
                  Server lo.
                  <br />
                  <span className="italic text-ember">Model lo.</span>
                </h2>
                <p className="mx-auto mt-6 max-w-[42ch] text-[15.5px] leading-[1.7] text-ink-2">
                  Masuk pakai email. Nggak ada password buat disimpan, dibocorin,
                  atau dilupain.
                </p>
                <div className="mt-9 flex flex-wrap justify-center gap-3">
                  <Link to="/auth" className="btn-primary">
                    Masuk ke Lolo
                    <ArrowRight className="size-4" />
                  </Link>
                  <Link to="/auth" className="btn-ghost">
                    Lihat demo dulu
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="px-5 py-9">
        <div className="shell flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-4">Lolo AI</span>
          <span className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
            self-hosted gateway
          </span>
        </div>
      </footer>
    </div>
  );
}
