import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Globe, LogOut, MessagesSquare, Server } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";

/** The Lolo mark: a solid ember square with a cut-out core. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative block size-[18px] shrink-0 overflow-hidden rounded-[5px]",
        className,
      )}
      style={{ background: "var(--accent-warm)" }}
    >
      <span className="absolute inset-[3px] rounded-[2px] bg-background" />
    </span>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Server;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors",
          isActive
            ? "bg-ember-soft text-ember"
            : "text-ink-3 hover:bg-surface-2 hover:text-ink-1",
        )
      }
    >
      <Icon className="size-3.5" />
      {label}
    </NavLink>
  );
}

/**
 * App chrome. A single pill bar rather than a sidebar: chat is the main
 * surface and the server panel is a peer, not a sub-page.
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
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 rounded-full border border-border bg-background/75 p-1.5 pl-4 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <NavLink to="/web" className="flex items-center gap-2.5">
              <Logo />
              <span className="text-[14px] font-medium tracking-tight text-ink-1">
                Lolo AI
              </span>
            </NavLink>
            <nav className="hidden items-center gap-1 sm:flex">
              <NavItem to="/web" icon={Globe} label="Web" />
              <NavItem to="/chat" icon={MessagesSquare} label="Chat" />
              <NavItem to="/server" icon={Server} label="Server" />
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {right}
            {session && (
              <>
                <span className="hidden max-w-[190px] truncate pl-1 font-mono text-[11px] text-ink-4 md:inline">
                  {session.email}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await signOut();
                    navigate("/");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
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
