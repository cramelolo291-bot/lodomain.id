import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Globe, LogOut, MessagesSquare, Server } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";

/**
 * The Lolo mark: a solid ember square with a cut-out core, and a hairline ring
 * that draws itself. The ring is the only ornament — it reads as machined
 * rather than decorated, and it costs one circle.
 */
export function Logo({ className, ring = true }: { className?: string; ring?: boolean }) {
  return (
    <span className={cn("relative flex size-[26px] shrink-0 items-center justify-center", className)}>
      {ring && (
        <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 26 26" fill="none" aria-hidden>
          <circle cx="13" cy="13" r="12" stroke="var(--line-strong)" strokeWidth="0.75" />
          <circle
            cx="13"
            cy="13"
            r="12"
            stroke="var(--text-4)"
            strokeWidth="0.75"
            strokeLinecap="round"
            strokeDasharray="75.4"
            strokeDashoffset="19"
          />
        </svg>
      )}
      {/* Proportional, not pixel-fixed, so the mark still reads as a mark at
          18px in a footer or at 42px on the opening screen. */}
      <span className="relative block size-[58%] overflow-hidden rounded-[16%] bg-ember">
        <span className="absolute inset-[12%] rounded-[10%] bg-background" />
      </span>
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
          "group relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors duration-200",
          isActive ? "text-ink-1" : "text-ink-3 hover:text-ink-1",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The active state is a lit surface plus a 2px stub under the label,
              not a filled pill. Quiet at rest, unmistakable when you are there. */}
          <span
            className={cn(
              "absolute inset-0 -z-10 rounded-full border transition-colors duration-200",
              isActive
                ? "border-line-strong bg-surface-2 shadow-[inset_0_1px_0_0_var(--spec)]"
                : "border-transparent",
            )}
          />
          <Icon className={cn("size-3.5 transition-colors", isActive && "text-ember")} />
          {label}
          <span
            className={cn(
              "absolute inset-x-3 -bottom-[7px] h-px origin-center transition-all duration-300",
              isActive ? "scale-x-100 bg-ember" : "scale-x-0 bg-transparent",
            )}
          />
        </>
      )}
    </NavLink>
  );
}

/**
 * App chrome. A single floating bar rather than a sidebar: chat is the main
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
        <div className="glass mx-auto flex max-w-[1440px] items-center justify-between gap-3 py-1.5 pl-3.5 pr-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_18px_40px_-28px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-5">
            <NavLink to="/web" className="flex items-center gap-2.5 py-1">
              <Logo />
              <span className="flex flex-col leading-none">
                <span className="text-[14px] font-medium tracking-tight text-ink-1">
                  Lolo AI
                </span>
                <span className="mono-label mt-1 !text-[9px]">studio</span>
              </span>
            </NavLink>
            <span className="hidden h-5 w-px bg-line sm:block" />
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
                  className="btn-solid !px-3 !py-1.5 !text-[12px] !text-ink-3 hover:!text-ink-1"
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
