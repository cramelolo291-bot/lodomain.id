import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";

/** Admin-only workspace guard. The API enforces the same role independently. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-ink-4" />
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="max-w-md text-center">
          <p className="font-mono text-xs tracking-widest text-muted-foreground">403 · FORBIDDEN</p>
          <h1 className="mt-3 text-2xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">Akun ini tidak memiliki izin untuk membuka area administrasi.</p>
          <Link className="mt-5 inline-flex rounded-full border border-border px-4 py-2 text-sm hover:bg-muted" to="/">Kembali ke beranda</Link>
        </section>
      </main>
    );
  }

  return children;
}
