import { Logo } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Check, Loader2, Mail } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

function resolveRedirect(returnTo: string | null, fallback: string) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

function Auth({ redirectAfterAuth = "/chat" }: { redirectAfterAuth?: string }) {
  const { isLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = resolveRedirect(params.get("returnTo"), redirectAfterAuth);

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [isLoading, isAuthenticated, navigate, redirect]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle") return;
    setPhase("sending");
    setError(null);
    try {
      await signIn(email.trim());
      setPhase("sent");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal kirim magic link.",
      );
      setPhase("idle");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="glow" />
      <div className="fade-out" />

      <header className="relative z-10 p-5 sm:p-7">
        <Link to="/" className="inline-flex items-center gap-2.5">
          <Logo />
          <span className="text-[14px] font-semibold tracking-tight text-ink-1">
            Lolo AI
          </span>
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 pb-20">
        <div className="w-full max-w-[400px]">
          {phase === "sent" ? (
            <div className="lift sheen p-7 text-center">
              <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-ember-soft">
                <Check className="size-5 text-ember" />
              </div>
              <h1 className="display text-[26px] text-ink-1">
                Cek email lo
              </h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
                Magic link udah dikirim ke{" "}
                <span className="text-ink-1">{email}</span>. Link-nya berlaku 15
                menit dan cuma bisa dipakai sekali.
              </p>
              <p className="mt-5 text-[12px] text-ink-4">
                Nggak masuk?{" "}
                <button
                  type="button"
                  onClick={() => setPhase("idle")}
                  className="text-cool underline-offset-4 hover:underline"
                >
                  Kirim ulang
                </button>
              </p>
            </div>
          ) : (
            <>
              <p className="mono-label mb-4">masuk</p>
              <h1 className="display text-[34px] text-ink-1">
                Masuk tanpa password
              </h1>
              <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
                Ketik email, lo dapet link. Nggak ada password buat
                disimpan, bocorin, atau dilupain.
              </p>

              <form onSubmit={handleSubmit} className="mt-7">
                <div className="lift flex items-center gap-2 p-1.5 pl-3.5 transition-colors focus-within:border-[rgba(var(--ember-rgb),0.5)]">
                  <Mail className="size-4 shrink-0 text-ink-4" />
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="h-10 flex-1 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={phase === "sending" || !email.trim()}
                    className="size-9 shrink-0 rounded-full bg-ember text-[#17120f] hover:bg-[var(--accent-warm-hover)]"
                  >
                    {phase === "sending" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4" />
                    )}
                  </Button>
                </div>

                {error && (
                  <p className="mt-2.5 text-[12.5px] text-ember">{error}</p>
                )}
              </form>

              <p className="mt-5 text-[12px] leading-relaxed text-ink-4">
                Akun baru otomatis dibuat. Kalau lo orang pertama yang masuk,
                lo jadi <span className="text-ember">admin</span> dan bisa
                kelola pool model dari tab Server.
              </p>
            </>
          )}
        </div>
      </main>

      <footer className="relative z-10 px-5 pb-7 text-center font-mono text-[10px] tracking-[0.08em] text-ink-4 uppercase">
        self-hosted · nothing leaves your machine
      </footer>
    </div>
  );
}

export default function AuthPage(props: { redirectAfterAuth?: string }) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
