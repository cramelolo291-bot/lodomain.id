import { Logo } from "@/components/AppShell";
import {
  EffortMatrix,
  HeroOrbit,
  Horizon,
  PipelineDiagram,
} from "@/components/Graphics";
import { AGENTS, ALTERNATIVES, GATEWAY_ROUTES, MODELS, TIER_LIMITS } from "@/lib/api";
import { DAILY_FREEBUCKS } from "@/lib/api";
import { ATTACK_TECHNIQUES } from "@/lib/guardrails";
import { cn } from "@/lib/utils";
import { ArrowRight, ArrowUpRight, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

/** Adds `in-view` once, then stops watching. */
function useReveal<T extends HTMLElement>(threshold = 0.12) {
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
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
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
      className={cn("reveal", className)}
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
      {done ? <Check className="size-3" /> : <Copy className="size-3" />
      }
      {done ? "tersalin" : "salin"}
    </button>
  );
}

/** One section label + title pair, so the rhythm never drifts. */
function Head({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
}) {
  return (
    <>
      <Reveal>
        <p className="eyebrow">{eyebrow}</p>
      </Reveal>
      <Reveal delay={60}>
        <h2 className="display mt-6 max-w-[19ch] text-[clamp(30px,4.6vw,56px)] text-ink-1">
          {title}
        </h2>
      </Reveal>
      {body && (
        <Reveal delay={120}>
          <p className="mt-6 max-w-[54ch] text-[16.5px] leading-[1.75] text-ink-2">
            {body}
          </p>
        </Reveal>
      )}
    </>
  );
}

const EFFORT_ROWS = [
  { id: "deepseek/* · z-ai/glm · stealth", efforts: ["low", "high", "max"] },
  { id: "openai/gpt-6 · gemini-3.8", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "meta/muse-spark", efforts: ["minimal", "low", "medium", "high", "xhigh"] },
  { id: "solar · mimo · kimi", efforts: [] },
];

const origin =
  typeof window !== "undefined" ? window.location.origin : "https://lolo.ai";

export default function Landing() {
  return (
    <div className="grain relative overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-3 rounded-full border border-border bg-background/65 p-1.5 pl-4 backdrop-blur-2xl">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[14px] font-medium tracking-tight text-ink-1">
              Lolo AI
            </span>
          </Link>

          <nav className="hidden items-center gap-8 lg:flex">
            {[
              ["#crew", "Agen"],
              ["#gateway", "Gateway"],
              ["#models", "Model"],
              ["#cost", "Biaya"],
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
              Mulai
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[100svh] items-center px-5 pt-36 pb-24">
        <div className="glow" />
        <div className="fade-out" />

        <div className="shell">
          <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Reveal>
                <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] text-ink-3">
                  <span className="pulse-dot" />
                  self-hosted · 9 subagents · no API key
                </span>
              </Reveal>

              <Reveal delay={90}>
                <h1 className="display mt-8 text-[clamp(40px,7vw,82px)] text-ink-1">
                  Sistem agent
                  <br />
                  AI milik lo
                  <br />
                  <span className="italic text-ember">sendiri.</span>
                </h1>
              </Reveal>

              <Reveal delay={180}>
                <p className="mt-8 max-w-[44ch] text-[17px] leading-[1.75] text-ink-2">
                  Satu portal untuk ngobrol, satu gateway untuk nyambungin ke
                  editor apa pun. Empat spesialis, satu pool akun, satu server
                  — dan nol request yang keluar tanpa lo izinkan.
                </p>
              </Reveal>

              <Reveal delay={260}>
                <div className="mt-10 flex flex-wrap gap-3">
                  <Link to="/auth" className="btn-primary">
                    Mulai gratis
                    <ArrowRight className="size-4" />
                  </Link>
                  <a href="#gateway" className="btn-ghost">
                    Cara kerjanya
                  </a>
                </div>
              </Reveal>

              <Reveal delay={340}>
                <div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-4">
                  {[
                    ["0", "USD per tahun"],
                    [`${DAILY_FREEBUCKS}`, "Freebucks per hari"],
                    [`${MODELS.length}`, "model dalam katalog"],
                    [`${ATTACK_TECHNIQUES.length}`, "serangan diawasi"],
                  ].map(([n, label]) => (
                    <div key={label}>
                      <p className="stat-num text-[26px]">
                        {n}
                      </p>
                      <p className="mt-2 font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={220} className="hidden lg:block">
              <div className="relative">
                <HeroOrbit className="opacity-95" />
                <p className="mt-2 text-center font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
                  empat spesialis · satu pool
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Economics ───────────────────────────────────────────────── */}
      <section id="cost" className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Head
            eyebrow="the maths"
            title={
              <>
                Nol dolar. <span className="italic text-ember">Bukan trikan.</span>
              </>
            }
            body="Yang kamu bayar cuma VPS-nya. Freebucks di-refill tiap tengah malam Waktu Pasifik, nggak ngakum ke hari berikutnya, dan bisa dipakai ke model mana aja."
          />

          <div className="mt-14 grid gap-px overflow-hidden rounded-[16px] border border-border bg-border lg:grid-cols-[0.9fr_1.1fr]">
            <Reveal>
              <div className="h-full bg-surface-1 p-7 sm:p-9">
                <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                  jam gratis per hari
                </p>
                <ul className="mt-6 space-y-3.5">
                  {MODELS.map((m) => (
                    <li key={m.id} className="flex items-center gap-3">
                      <span className="w-36 shrink-0 truncate text-[13px] text-ink-2">
                        {m.label}
                      </span>
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                        {m.unmetered ? (
                          <div className="h-full w-full bg-[#9db4a8]" />
                        ) : m.freeHours > 0 ? (
                          <div
                            className="h-full rounded-full bg-ember"
                            style={{ width: `${(m.freeHours / 20) * 100}%` }}
                          />
                        ) : null}
                      </div>
                      <span className="w-20 shrink-0 text-right font-mono text-[11px] text-ink-4">
                        {m.unmetered
                          ? "unmetered"
                          : m.freeHours > 0
                            ? `${m.freeHours} jam`
                            : "berbayar"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-[12.5px] leading-[1.7] text-ink-4">
                  Space Bunny Alpha nggak menyentuh jatah harian sama sekali.
                  Gemini 3.8 Flash diikuti paket berbayar. Sisanya memakai jatah
                  yang sama — jadi jamnya nggak bisa dijumlahkan.
                </p>
              </div>
            </Reveal>

            <Reveal delay={90}>
              <div className="h-full bg-surface-1 p-7 sm:p-9">
                <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                  yang digantikan, per tahun
                </p>
                <ul className="mt-6 space-y-3">
                  <li className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[13px] text-ink-1">
                      Lolo AI
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full w-[3%] min-w-2 rounded-full bg-ember" />
                    </div>
                    <span className="w-20 shrink-0 text-right font-mono text-[12px] text-ember">
                      $0
                    </span>
                  </li>
                  {ALTERNATIVES.map((a) => (
                    <li key={a.name} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-[13px] text-ink-3">
                        {a.name}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-[#5a534a]"
                          style={{
                            width: `${(a.price / ALTERNATIVES[0]!.price) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right font-mono text-[12px] text-ink-3">
                        ${a.price.toLocaleString("en-US")}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-[12.5px] leading-[1.7] text-ink-4">
                  Harga daftar yang dipublikasikan masing-masing vendor, bukan
                  klaim soal Lolo. Yang lo bayar cuma biaya server.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Crew ────────────────────────────────────────────────────── */}
      <section id="crew" className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <Horizon className="-mb-20 h-28 opacity-50" />
          </Reveal>
          <Head
            eyebrow="the crew"
            title="Sembilan subagent, empat peran. Nggak ada satu model buat semua."
            body="Keunggulan freebuff bukan modelnya lebih pintar, tapi tugasnya dipecah. Lolo membawa pemisahan yang sama ke server lo sendiri — dan setiap langkahnya bisa ditelusuri."
          />

          <div className="mt-14 grid gap-px overflow-hidden rounded-[16px] border border-border bg-border sm:grid-cols-2">
            {AGENTS.map((a, i) => (
              <Reveal key={a.key} delay={i * 70}>
                <div className="group h-full bg-surface-1 p-7 transition-colors hover:bg-surface-2 sm:p-9">
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
                    <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
                      {a.tagline}
                    </span>
                  </div>
                  <p className="mt-4 max-w-[42ch] text-[14.5px] leading-[1.75] text-ink-3">
                    {a.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Gateway ─────────────────────────────────────────────────── */}
      <section id="gateway" className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Head
            eyebrow="the gateway"
            title="Pool yang milih, bukan menebak."
            body="Setiap request ng-rank akun berdasarkan health, lalu ngambil slot yang kosong. Kalau satu gagal, yang berikutnya. Kalau satu dapat 401, langsung cooldown — bukan dicoba berulang."
          />

          <Reveal delay={160}>
            <div className="panel mt-14 p-6 sm:p-10">
              <PipelineDiagram />
            </div>
          </Reveal>

          <div className="mt-px grid gap-px overflow-hidden rounded-[16px] border border-border bg-border lg:grid-cols-2">
            <Reveal>
              <div className="h-full bg-surface-1 p-7 sm:p-9">
                <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                  kapasitas per tier
                </p>
                <ul className="mt-6 space-y-4">
                  {(["free", "subscribed"] as const).map((tier) => (
                    <li key={tier} className="flex items-baseline gap-3 font-mono text-[12.5px]">
                      <span className="w-24 text-ink-1">{tier}</span>
                      <span className="text-ember">
                        {TIER_LIMITS[tier].slots} slot
                      </span>
                      <span className="text-ink-4">
                        × {TIER_LIMITS[tier].concurrency} concurrent
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-[13px] leading-[1.7] text-ink-4">
                  Konkurensi riil dibatasi jumlah slot. Free satu slot berarti
                  satu request pada satu waktu — dan itu yang bikin rate limit
                  bisa diprediksi, bukan kejutan.
                </p>
              </div>
            </Reveal>

            <Reveal delay={90}>
              <div className="h-full bg-surface-1 p-7 sm:p-9">
                <p className="font-mono text-[10px] tracking-[0.14em] text-ink-4 uppercase">
                  endpoint
                </p>
                <ul className="mt-6 space-y-2.5">
                  {GATEWAY_ROUTES.map((r) => (
                    <li key={r.path} className="flex items-baseline gap-3 font-mono text-[12.5px]">
                      <span className="w-12 shrink-0 text-ember">{r.method}</span>
                      <span className="min-w-0 truncate text-ink-2">{r.path}</span>
                      <span className="ml-auto hidden truncate text-ink-4 sm:inline">
                        {r.note}
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
      <section id="models" className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Head
            eyebrow="catalogue"
            title="Katalog yang sama persis, effort-nya ikut."
            body="Model yang nggak mendukung reasoning effort nggak error — field-nya dibuang sebelum request dikirim. Di bawah ini matriksnya, digambar langsung dari katalog."
          />

          <Reveal delay={160}>
            <div className="panel mt-14 overflow-x-auto p-6 sm:p-9">
              <EffortMatrix
                rows={EFFORT_ROWS.map((r) => ({ id: r.id, efforts: r.efforts }))}
                className="min-w-[440px]"
              />
            </div>
          </Reveal>

          <div className="mt-px overflow-hidden rounded-[16px] border border-border">
            <div className="hidden grid-cols-[7rem_1fr_4rem_5rem_6rem] gap-4 border-b border-border bg-surface-2 px-6 py-3 font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase sm:grid">
              <span>vendor</span>
              <span>model</span>
              <span className="text-right">context</span>
              <span>access</span>
              <span>jatah</span>
            </div>
            {MODELS.map((m, i) => (
              <Reveal key={m.id} delay={i * 40}>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-border bg-surface-1 px-6 py-4 last:border-b-0 sm:grid-cols-[7rem_1fr_4rem_5rem_6rem] sm:items-center">
                  <span className="font-mono text-[10.5px] text-ink-4">
                    {m.vendor}
                  </span>
                  <span className="min-w-0 text-[14px] text-ink-1">
                    {m.label}
                    {m.vision && (
                      <span className="ml-2 font-mono text-[10px] text-ink-4">
                        vision
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3 sm:text-right">
                    {m.contextK >= 1024 ? "1M" : `${m.contextK}K`}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-4">
                    {m.efforts.length > 0 ? `${m.efforts.length} effort` : "—"}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-4 sm:text-right">
                    {m.unmetered
                      ? "unmetered"
                      : m.freeHours > 0
                        ? `${m.freeHours} jam`
                        : "berbayar"}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Guardrail ───────────────────────────────────────────────── */}
      <section id="guardrail" className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Head
            eyebrow="guardrail"
            title={
              <>
                Yang kena filter,{" "}
                <span className="italic text-ember">nggak sampai ke model.</span>
              </>
            }
            body="Tujuh rule deterministik jalan sebelum apa pun dikirim. Nol token, nol latency, dan request-nya nggak pernah sampai ke akun mana pun. Sisanya — serangan bertahap, payload ter-obfuscate — urusan Red Team agent."
          />

          <div className="mt-12 flex flex-wrap gap-2">
            {ATTACK_TECHNIQUES.map((a, i) => (
              <Reveal key={a.name} delay={i * 30}>
                <span className="tag tag-quiet">{a.name}</span>
              </Reveal>
            ))}
          </div>

          <Reveal delay={140}>
            <div className="panel mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 p-6">
              <span className="tag">7 rules</span>
              <span className="font-mono text-[12px] text-ink-4">
                prompt injection · jailbreak · pii · system leak · agency ·
                shell · credentials
              </span>
              <span className="ml-auto font-mono text-[11px] text-ink-3">
                0 tokens on block
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Bring friends ───────────────────────────────────────────── */}
      <section id="api" className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Head
            eyebrow="bring your friends"
            title="Temen lo cuma butuh satu key."
            body="Endpoint-nya OpenAI-compatible. Cursor, Cline, atau CLI apa pun yang ngerti OpenAI bisa langsung nunjuk ke server lo."
          />

          <Reveal delay={120}>
            <div className="codeblock mt-12">
              <span className="text-ink-4">$</span>
              <code className="min-w-0 flex-1 truncate">
                curl {origin}/v1/chat/completions
              </code>
              <CopyButton
                text={`curl ${origin}/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer sk-lolo-..." -d '{"model":"z-ai/glm-5.3-flash","messages":[{"role":"user","content":"halo"}]}'`}
              />
            </div>
          </Reveal>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["Masuk", "Magic link. Nggak ada password."],
              ["Minta", "Spesialis + model + effort."],
              ["Lihat", "Trace, pool, usage, keys."],
            ].map(([t, d], i) => (
              <Reveal key={t} delay={i * 80}>
                <div className="panel h-full p-6">
                  <p className="display text-[22px] text-ink-1">
                    <span className="mr-2 font-mono text-[12px] text-ember">
                      0{i + 1}
                    </span>
                    {t}
                  </p>
                  <p className="mt-2 text-[13.5px] leading-[1.7] text-ink-4">
                    {d}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section className="hairline px-5 py-24 sm:py-32">
        <div className="shell">
          <Reveal>
            <div className="relative overflow-hidden rounded-[20px] border border-border bg-surface-1 px-6 py-20 text-center sm:px-12 sm:py-28">
              <div className="glow" />
              <div className="relative">
                <p className="eyebrow">mulai sekarang</p>
                <h2 className="display mt-7 text-[clamp(32px,5.4vw,62px)] text-ink-1">
                  Server lo.
                  <br />
                  <span className="italic text-ember">Model lo.</span>
                </h2>
                <p className="mx-auto mt-7 max-w-[42ch] text-[16px] leading-[1.75] text-ink-2">
                  Masuk pakai email. Nggak ada password buat disimpan,
                  dibocorin, atau dilupain.
                </p>
                <div className="mt-10 flex flex-wrap justify-center gap-3">
                  <Link to="/auth" className="btn-primary">
                    Masuk ke Lolo
                    <ArrowRight className="size-4" />
                  </Link>
                  <a
                    href="#cost"
                    className="btn-ghost"
                  >
                    Hitung dulu
                    <ArrowUpRight className="size-4" />
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="hairline px-5 py-10">
        <div className="shell flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 text-[12.5px] text-ink-4">
            <Logo className="size-[19px]" />
            Lolo AI
          </span>
          <span className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
            self-hosted gateway · nothing leaves your machine
          </span>
        </div>
      </footer>
    </div>
  );
}
