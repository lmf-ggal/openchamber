import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const clearCalls: string[] = [];
const snapshotCalls: Array<{ reject: boolean; sessions: Array<{ id: string; directory?: string | null }> }> = [];

type SnapshotResult = { activeSessions: Array<{ id: string; directory?: string | null }> };

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeKey: () => 'test-runtime',
}));

mock.module('@/sync/last-session-cache', () => ({
  readLastActiveSession: (key: string) => {
    if (key !== 'test-runtime') return null;
    return (globalThis as { __persisted?: { sessionId: string; directory: string | null } | null }).__persisted ?? null;
  },
  clearLastActiveSession: (key: string) => {
    clearCalls.push(key);
  },
}));

mock.module('@/stores/useGlobalSessionsStore', () => ({
  refreshGlobalSessions: async (): Promise<SnapshotResult> => {
    const next = snapshotCalls.shift();
    if (next?.reject) throw new Error('network down');
    return { activeSessions: next?.sessions ?? [] };
  },
  resolveGlobalSessionDirectory: (session: { directory?: string | null; project?: { worktree?: string | null } | null }) =>
    session.directory ?? session.project?.worktree ?? null,
}));

const setPersisted = (sessionId: string | null, directory: string | null = null) => {
  (globalThis as { __persisted?: unknown }).__persisted =
    sessionId === null ? null : { sessionId, directory };
};

const queueSnapshot = (sessions: Array<{ id: string; directory?: string | null }>) => {
  snapshotCalls.push({ reject: false, sessions });
};

beforeEach(() => {
  setPersisted(null);
  clearCalls.length = 0;
  snapshotCalls.length = 0;
});

afterEach(() => {
  delete (globalThis as { __persisted?: unknown }).__persisted;
});

describe('resolveRecentSession', () => {
  test('returns null when nothing was persisted', async () => {
    const { resolveRecentSession } = await import('./recentSession');
    expect(await resolveRecentSession()).toBeNull();
    expect(snapshotCalls).toEqual([]);
  });

  test('returns the persisted session confirmed by the snapshot', async () => {
    setPersisted('ses_active', '/repo/a');
    queueSnapshot([
      { id: 'ses_other', directory: '/repo/b' },
      { id: 'ses_active', directory: '/repo/c' },
    ]);
    const { resolveRecentSession } = await import('./recentSession');
    const resolved = await resolveRecentSession();
    expect(resolved).toEqual({ sessionId: 'ses_active', directory: '/repo/c' });
    expect(clearCalls).toEqual([]);
  });

  test('falls back to the persisted directory when the snapshot entry lacks one', async () => {
    setPersisted('ses_active', '/repo/a');
    queueSnapshot([{ id: 'ses_active', directory: null }]);
    const { resolveRecentSession } = await import('./recentSession');
    const resolved = await resolveRecentSession();
    expect(resolved).toEqual({ sessionId: 'ses_active', directory: '/repo/a' });
  });

  test('drops the stale pointer and returns null when the session is gone', async () => {
    setPersisted('ses_gone', '/repo/a');
    queueSnapshot([{ id: 'ses_other', directory: '/repo/b' }]);
    const { resolveRecentSession } = await import('./recentSession');
    expect(await resolveRecentSession()).toBeNull();
    expect(clearCalls).toEqual(['test-runtime']);
  });

  test('returns null when the snapshot fetch fails', async () => {
    setPersisted('ses_active', '/repo/a');
    snapshotCalls.push({ reject: true, sessions: [] });
    const { resolveRecentSession } = await import('./recentSession');
    expect(await resolveRecentSession()).toBeNull();
    expect(clearCalls).toEqual([]);
  });
});
