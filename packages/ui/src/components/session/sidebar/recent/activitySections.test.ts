import { describe, expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import { deriveRecentSessions, sessionTreeMatchesSidebarQuery } from './activitySections';
import type { SessionNode } from '../types';

// SAFETY: the query match reads only the id, title, and parent.
const session = (id: string, options: { parentID?: string } = {}): Session => ({
  id,
  parentID: options.parentID,
  time: { created: 1, updated: 1 },
} as Session);

describe('sessionTreeMatchesSidebarQuery', () => {
  const tree = (): SessionNode => ({
    session: { ...session('ses_parent'), title: 'Parent work' } as Session,
    children: [{
      session: { ...session('ses_child', { parentID: 'ses_parent' }), title: 'Fix the header' } as Session,
      children: [],
      worktree: null,
    }],
    worktree: null,
  });

  test('keeps a tree whose subsession is the match, by id and by title', () => {
    expect(sessionTreeMatchesSidebarQuery(tree(), 'ses_child')).toBe(true);
    expect(sessionTreeMatchesSidebarQuery(tree(), 'header')).toBe(true);
    expect(sessionTreeMatchesSidebarQuery(tree(), 'parent')).toBe(true);
  });

  test('drops a tree where nothing matches', () => {
    expect(sessionTreeMatchesSidebarQuery(tree(), 'unrelated')).toBe(false);
    expect(sessionTreeMatchesSidebarQuery(tree(), 'ses_other')).toBe(false);
  });
});

describe('deriveRecentSessions', () => {
  test('keeps active roots and roots updated in the last 48 hours, excluding old, archived, and child sessions', () => {
    const now = 200_000_000;
    const sessions = [
      { ...session('ses_fresh'), time: { created: now - 100, updated: now - 100 } },
      { ...session('ses_active'), time: { created: 1, updated: 1 } },
      { ...session('ses_old'), time: { created: 1, updated: 1 } },
      { ...session('ses_archived'), time: { created: now, updated: now, archived: now } },
      { ...session('ses_child', { parentID: 'ses_fresh' }), time: { created: now, updated: now } },
    ] as Session[];

    expect(deriveRecentSessions(sessions, new Set(['ses_active']), now).map((entry) => entry.id)).toEqual([
      'ses_fresh',
      'ses_active',
    ]);
  });
});
