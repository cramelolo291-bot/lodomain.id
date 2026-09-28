import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Server, Sparkles, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";

/** The Lolo mark: a gradient shell with a cut-out core, per the design system. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-[6px]",
        className,
      )}
      style={{ background: "var(--gradient-key)" }}
    >
      <span className="absolute inset-[3px] rounded-[4px] bg-background" />
    </span>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Sparkles;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
          isActive
            ? "bg-cool-soft text-cool"
            : "text-ink-3 hover:bg-white/5 hover:text-ink-1",
        )
      }
    >
      <Icon className="size-3.5" />
      {label}
    </NavLink>
  );
}

/**
 * The app chrome. A single pill bar rather than a sidebar: the chat is the
 * main surface and the server panel is a peer, not a sub-page.
 */
export function AppShell({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-30 shrink-0 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 rounded-full border border-white/8 bg-background/70 p-1.5 pl-4 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <NavLink to="/chat" className="flex items-center gap-2.5">
              <Logo />
              <span className="text-[14px] font-semibold tracking-tight text-ink-1">
                Lolo&nbsp;AI
              </span>
            </NavLink>
            <nav className="hidden items-center gap-1 sm:flex">
              <NavItem to="/chat" icon={Sparkles} label="Chat" />
              <NavItem to="/server" icon={Server} label="Server" />
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {right}
            {session && (
              <>
                <span className="hidden max-w-[180px] truncate pl-1 font-mono text-[11px] text-ink-4 md:inline">
                  {session.email}
                </span>
                {session.role === "admin" && (
                  <span className="tag tag-warm">admin</span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await signOut();
                    navigate("/");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-medium text-ink-3 transition-colors hover:bg-white/5 hover:text-ink-1"
                >
                  <LogOut className="size-3.5" />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
