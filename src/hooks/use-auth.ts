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
    void refresh();
    // The mock backend changes session in place, so it announces itself.
    return subscribe(() => void refresh());
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
