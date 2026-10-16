import { getRuntimeKey } from '@/lib/runtime-switch';
import { useConfigStore } from '@/stores/useConfigStore';
import { refreshGlobalSessions, resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { clearLastActiveSession, readLastActiveSession, readMostRecentLastActiveSession } from '@/sync/last-session-cache';

export type ResolvedRecentSession = {
  sessionId: string;
  directory: string | null;
};

export function shouldApplyResolvedRecentSession(
  sessionIdBeforeResolution: string | null,
  currentSessionId: string | null,
): boolean {
  return sessionIdBeforeResolution === currentSessionId;
}

let recentSessionSnapshotWaitMs = 60_000;

/** Test hook for bounded retry coverage; never call from application code. */
export function setRecentSessionSnapshotWaitMs(ms: number): void {
  recentSessionSnapshotWaitMs = ms;
}

/**
 * Resolve `?session=recent` only from a ready global session snapshot. Keep
 * waiting through startup races and transient disconnects instead of showing
 * a draft because the first list request has not completed yet.
 */
export async function resolveRecentSession(): Promise<ResolvedRecentSession | null> {
  const runtimeKey = getRuntimeKey();
  const persisted = readLastActiveSession(runtimeKey) ?? readMostRecentLastActiveSession();
  if (!persisted) return null;

  void refreshGlobalSessions().catch(() => null);
  const deadline = Date.now() + recentSessionSnapshotWaitMs;
  let retriedAfterConnect = false;

  for (;;) {
    if (getRuntimeKey() !== runtimeKey) return null;
    const state = useGlobalSessionsStore.getState();
    const connected = useConfigStore.getState().isConnected;
    if (state.status === 'error') {
      if (!connected) {
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      if (!retriedAfterConnect) {
        retriedAfterConnect = true;
        void refreshGlobalSessions().catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      return null;
    }

    if (state.status === 'ready') {
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

    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
