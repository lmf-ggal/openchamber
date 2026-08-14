import { getRuntimeKey } from '@/lib/runtime-switch';
import { refreshGlobalSessions, resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { clearLastActiveSession, readLastActiveSession } from '@/sync/last-session-cache';

export type ResolvedRecentSession = {
  sessionId: string;
  directory: string | null;
};

const RECENT_SESSION_RESOLUTION_TIMEOUT_MS = 6_000;

/**
 * Resolve the `?session=recent` URL token to the last session that was active
 * for the current runtime. Mirrors the MobileApp cold-launch restore: the
 * persisted pointer is only trusted after an authoritative sessions snapshot
 * confirms the session still exists; otherwise the stale pointer is dropped.
 *
 * Returns `null` when there is no usable persisted session, so callers can
 * fall back to the default new-session behavior.
 */
export async function resolveRecentSession(): Promise<ResolvedRecentSession | null> {
  const runtimeKey = getRuntimeKey();
  const persisted = readLastActiveSession(runtimeKey);
  if (!persisted) {
    return null;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const snapshot = await Promise.race([
    refreshGlobalSessions().catch(() => null),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), RECENT_SESSION_RESOLUTION_TIMEOUT_MS);
    }),
  ]);
  if (timeout !== undefined) {
    clearTimeout(timeout);
  }
  if (!snapshot) {
    return null;
  }

  if (useGlobalSessionsStore.getState().status === 'error') {
    return null;
  }

  const session = snapshot.activeSessions.find((entry) => entry.id === persisted.sessionId);
  if (!session) {
    clearLastActiveSession(runtimeKey);
    return null;
  }

  return {
    sessionId: session.id,
    directory: resolveGlobalSessionDirectory(session) ?? persisted.directory,
  };
}
