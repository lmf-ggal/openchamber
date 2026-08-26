import { getRuntimeKey } from '@/lib/runtime-switch';
import { RECENT_SESSION_TOKEN } from '@/lib/router';
import { useConfigStore } from '@/stores/useConfigStore';
import { refreshGlobalSessions, resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { clearLastActiveSession, readLastActiveSession, readMostRecentLastActiveSession } from '@/sync/last-session-cache';

export type ResolvedRecentSession = { sessionId: string; directory: string | null };
export type RouteSessionResolution = { sessionId: string; directoryHint: string | null | undefined } | null;

export async function resolveRouteSessionToken(rawSessionId: string, resolveRecent: () => Promise<ResolvedRecentSession | null>, getDirectoryForSession: (sessionId: string) => string | null | undefined): Promise<RouteSessionResolution> {
  if (rawSessionId !== RECENT_SESSION_TOKEN) return { sessionId: rawSessionId, directoryHint: getDirectoryForSession(rawSessionId) };
  const resolved = await resolveRecent();
  return resolved ? { sessionId: resolved.sessionId, directoryHint: resolved.directory } : null;
}

export async function resolveRecentSession(): Promise<ResolvedRecentSession | null> {
  const runtimeKey = getRuntimeKey();
  const persisted = readLastActiveSession(runtimeKey) ?? readMostRecentLastActiveSession();
  if (!persisted) return null;
  void refreshGlobalSessions().catch(() => null);
  const deadline = Date.now() + 6_000;
  const absoluteCap = Date.now() + 30_000;
  let retriedAfterConnect = false;
  for (;;) {
    const state = useGlobalSessionsStore.getState();
    const connected = useConfigStore.getState().isConnected;
    if (Date.now() >= absoluteCap) return null;
    if (state.status === 'error') {
      if (!connected) { await new Promise((resolve) => setTimeout(resolve, 50)); continue; }
      if (!retriedAfterConnect) { retriedAfterConnect = true; void refreshGlobalSessions().catch(() => null); await new Promise((resolve) => setTimeout(resolve, 50)); continue; }
      return null;
    }
    if (state.status === 'ready') {
      const session = state.activeSessions.find((entry) => entry.id === persisted.sessionId);
      if (!session) { clearLastActiveSession(runtimeKey); return null; }
      return { sessionId: session.id, directory: resolveGlobalSessionDirectory(session) ?? persisted.directory };
    }
    if (Date.now() >= deadline && connected) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
