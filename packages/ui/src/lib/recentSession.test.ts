import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let pointer: { sessionId: string; directory: string | null } | null = null;
let fallbackPointer: { sessionId: string; directory: string | null } | null = null;
let status: 'idle' | 'loading' | 'ready' | 'error' = 'loading';
let connected = true;
let sessions: Array<{ id: string; directory?: string | null }> = [];
let refresh: () => void = () => {};
const cleared: string[] = [];

mock.module('@/lib/runtime-switch', () => ({ getRuntimeKey: () => 'test-runtime' }));
mock.module('@/sync/last-session-cache', () => ({
  readLastActiveSession: (key: string) => key === 'test-runtime' ? pointer : null,
  readMostRecentLastActiveSession: () => fallbackPointer,
  clearLastActiveSession: (key: string) => { cleared.push(key); },
}));
mock.module('@/stores/useConfigStore', () => ({
  useConfigStore: { getState: () => ({ isConnected: connected }) },
}));
mock.module('@/stores/useGlobalSessionsStore', () => ({
  refreshGlobalSessions: async () => { refresh(); return { activeSessions: sessions, archivedSessions: [] }; },
  resolveGlobalSessionDirectory: (session: { directory?: string | null }) => session.directory ?? null,
  useGlobalSessionsStore: { getState: () => ({ status, activeSessions: sessions }) },
}));

beforeEach(() => {
  pointer = null;
  fallbackPointer = null;
  status = 'loading';
  connected = true;
  sessions = [];
  refresh = () => {};
  cleared.length = 0;
});

afterEach(async () => {
  const { setRecentSessionSnapshotWaitMs } = await import('./recentSession');
  setRecentSessionSnapshotWaitMs(60_000);
});

describe('resolveRecentSession', () => {
  test('returns no session when no pointer exists', async () => {
    const { resolveRecentSession } = await import('./recentSession');
    expect(await resolveRecentSession()).toBeNull();
  });

  test('waits for a ready snapshot and resolves the persisted session', async () => {
    pointer = { sessionId: 'ses-last', directory: '/repo/old' };
    refresh = () => {
      sessions = [{ id: 'ses-last', directory: '/repo/current' }];
      status = 'ready';
    };
    const { resolveRecentSession } = await import('./recentSession');

    expect(await resolveRecentSession()).toEqual({ sessionId: 'ses-last', directory: '/repo/current' });
    expect(cleared).toEqual([]);
  });

  test('keeps waiting when the global snapshot becomes ready after startup', async () => {
    pointer = { sessionId: 'ses-late', directory: null };
    refresh = () => {
      setTimeout(() => {
        sessions = [{ id: 'ses-late', directory: '/repo' }];
        status = 'ready';
      }, 120);
    };
    const { resolveRecentSession, setRecentSessionSnapshotWaitMs } = await import('./recentSession');
    setRecentSessionSnapshotWaitMs(1_000);

    expect(await resolveRecentSession()).toEqual({ sessionId: 'ses-late', directory: '/repo' });
  });

  test('uses the most recent persisted runtime when the exact runtime has no pointer', async () => {
    fallbackPointer = { sessionId: 'ses-equivalent-origin', directory: '/repo' };
    refresh = () => {
      sessions = [{ id: 'ses-equivalent-origin', directory: null }];
      status = 'ready';
    };
    const { resolveRecentSession } = await import('./recentSession');

    expect(await resolveRecentSession()).toEqual({ sessionId: 'ses-equivalent-origin', directory: '/repo' });
  });

  test('does not clear a pointer until a ready snapshot confirms the session is gone', async () => {
    pointer = { sessionId: 'ses-missing', directory: null };
    refresh = () => {
      sessions = [];
      status = 'ready';
    };
    const { resolveRecentSession } = await import('./recentSession');

    expect(await resolveRecentSession()).toBeNull();
    expect(cleared).toEqual(['test-runtime']);
  });

  test('preserves a session selection made while the pointer resolves', async () => {
    const { shouldApplyResolvedRecentSession } = await import('./recentSession');
    expect(shouldApplyResolvedRecentSession(null, null)).toBe(true);
    expect(shouldApplyResolvedRecentSession(null, 'ses-user-selected')).toBe(false);
  });
});
