import { getRuntimeKey } from '@/lib/runtime-switch';
import { RECENT_SESSION_TOKEN } from '@/lib/router';
import { refreshGlobalSessions, resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { clearLastActiveSession, readLastActiveSession } from '@/sync/last-session-cache';

export type ResolvedRecentSession = {
  sessionId: string;
  directory: string | null;
};

export type RouteSessionResolution = {
  sessionId: string;
  directoryHint: string | null | undefined;
} | null;

/**
 * Resolve the `session` part of a route. A plain session ID is passed through
 * unchanged with its directory hint; the `?session=recent` token is resolved
 * against the last active session for the current runtime, falling through to
 * the default new-session behavior (null) when nothing usable is persisted.
 */
export async function resolveRouteSessionToken(
  rawSessionId: string,
  resolveRecent: () => Promise<ResolvedRecentSession | null>,
  getDirectoryForSession: (sessionId: string) => string | null | undefined,
): Promise<RouteSessionResolution> {
  if (rawSessionId !== RECENT_SESSION_TOKEN) {
    return { sessionId: rawSessionId, directoryHint: getDirectoryForSession(rawSessionId) };
  }
  const resolved = await resolveRecent();
  if (!resolved) {
    return null;
  }
  return { sessionId: resolved.sessionId, directoryHint: resolved.directory };
}

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
  await Promise.race([
    refreshGlobalSessions().catch(() => null),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), RECENT_SESSION_RESOLUTION_TIMEOUT_MS);
    }),
  ]);
  if (timeout !== undefined) {
    clearTimeout(timeout);
  }

  // Only the committed store snapshot is authoritative: the promise returned
  // by `refreshGlobalSessions` may be a generation-stale (empty) result that
  // was discarded without touching the store status, while a newer load
  // already applied the real snapshot.
  const state = useGlobalSessionsStore.getState();
  if (state.status !== 'ready') {
    return null;
  }

  const session = state.activeSessions.find((entry) => entry.id === persisted.sessionId);
  if (!session) {
    clearLastActiveSession(runtimeKey);
    return null;
  }

  return {
    sessionId: session.id,
    directory: resolveGlobalSessionDirectory(session) ?? persisted.directory,
  };
}
