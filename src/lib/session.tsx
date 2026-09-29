/**
 * The app-wide session: the connected key (global or scoped), its server,
 * and the API client built from it. Loaded from secure storage on launch.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createSession, ScopedApi, type Session } from "./api";
import { clearStoredSession, getStoredSession, setStoredSession } from "./storage";

interface SessionContextValue {
  /** False until the stored session has been read. */
  ready: boolean;
  session: Session | null;
  api: ScopedApi | null;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function parseStoredSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; token?: unknown };
    if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") return null;
    // Re-derive kind/mailboxId from the token itself — storage is not trusted
    // to agree with the credential.
    return createSession(parsed.baseUrl, parsed.token);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getStoredSession()
      .then((raw) => {
        if (cancelled) return;
        setSession(parseStoredSession(raw));
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (next: Session) => {
    await setStoredSession(JSON.stringify({ baseUrl: next.baseUrl, token: next.token }));
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredSession();
    setSession(null);
  }, []);

  const api = useMemo(() => (session ? new ScopedApi(session) : null), [session]);

  const value = useMemo<SessionContextValue>(
    () => ({ ready, session, api, signIn, signOut }),
    [ready, session, api, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
