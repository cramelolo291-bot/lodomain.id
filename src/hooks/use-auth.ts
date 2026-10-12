import { api, subscribe, type Session } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

/**
 * Session state for the magic-link flow.
 *
 * There is no password and no OAuth provider, so there is nothing to keep in
 * local storage: the session lives in an httpOnly cookie on the server and this
 * hook only mirrors what `/api/me` says.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.session());
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    // Fetch in the promise chain so the effect itself never performs a
    // synchronous state update. A failed real API call stays unauthenticated.
    void api.session()
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    // The explicitly enabled local mock announces session mutations.
    const unsubscribe = subscribe(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh]);

  const signIn = useCallback(
    async (email: string) => {
      await api.requestMagicLink(email);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(null);
  }, []);

  return {
    isLoading,
    session,
    user: session,
    isAuthenticated: session !== null,
    isAdmin: session?.role === "admin",
    signIn,
    signOut,
  };
}
