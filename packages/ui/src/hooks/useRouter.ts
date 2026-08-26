import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore, type ContextPanelMode } from '@/stores/useUIStore';
import { parseRoute, updateBrowserURL, hasRouteParams, RECENT_SESSION_TOKEN } from '@/lib/router';
import type { RouteState, AppRouteState } from '@/lib/router';
import { resolveSettingsSlug } from '@/lib/settings/metadata';
import { resolveRecentSession } from '@/lib/recentSession';
import { isEmbeddedSessionChat } from '@/components/layout/contextPanelEmbeddedChat';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

function isVSCodeContext(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as { __VSCODE_CONFIG__?: unknown };
  return win.__VSCODE_CONFIG__ !== undefined;
}

export function useRouter(): void {
  const isVSCode = React.useMemo(() => isVSCodeContext(), []);
  const isEmbeddedChat = React.useMemo(() => isEmbeddedSessionChat(), []);
  const initializedRef = React.useRef(false);
  const isApplyingRouteRef = React.useRef(false);
  const routeGenerationRef = React.useRef(0);

  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const navigateToDiff = useUIStore((state) => state.navigateToDiff);

  const applyRoute = React.useCallback(
    async (route: RouteState) => {
      const generation = ++routeGenerationRef.current;
      isApplyingRouteRef.current = true;
      try {
        if (route.sessionId) {
          let targetSessionId: string | null = route.sessionId;
          let directoryHint: string | null | undefined;
          if (route.sessionId === RECENT_SESSION_TOKEN) {
            const resolved = await resolveRecentSession();
            if (generation !== routeGenerationRef.current) return;
            if (resolved) {
              targetSessionId = resolved.sessionId;
              directoryHint = resolved.directory;
            } else {
              targetSessionId = null;
            }
          } else {
            directoryHint = useSessionUIStore.getState().getDirectoryForSession(route.sessionId);
          }
          if (targetSessionId) {
            const currentSessionId = useSessionUIStore.getState().currentSessionId;
            if (targetSessionId !== currentSessionId) {
              setCurrentSession(targetSessionId, directoryHint ?? undefined);
            }
          }
        }
        if (route.settingsPath) {
          setSettingsPage(resolveSettingsSlug(route.settingsPath));
          setSettingsDialogOpen(true);
          return;
        }
        if (useUIStore.getState().isSettingsDialogOpen) setSettingsDialogOpen(false);
        if (route.tab && route.tab !== 'chat') {
          const directory = useDirectoryStore.getState().currentDirectory;
          if (directory) {
            const mode: ContextPanelMode = route.tab === 'files' ? 'file' : route.tab;
            useUIStore.getState().openContextSurface(directory, mode);
          }
        }
        if (route.diffFile && (route.tab === 'diff' || !route.tab)) navigateToDiff(route.diffFile);
      } finally {
        if (generation === routeGenerationRef.current) isApplyingRouteRef.current = false;
      }
    },
    [setCurrentSession, setSettingsDialogOpen, setSettingsPage, navigateToDiff],
  );

  const getCurrentAppState = React.useCallback((): AppRouteState => {
    const sessionState = useSessionUIStore.getState();
    const uiState = useUIStore.getState();
    return { sessionId: sessionState.currentSessionId, isSettingsOpen: uiState.isSettingsDialogOpen, settingsPath: uiState.settingsPage };
  }, []);

  const syncURLFromState = React.useCallback((options: { replace?: boolean } = {}) => {
    if (isVSCode || isEmbeddedChat || isApplyingRouteRef.current) return;
    updateBrowserURL(getCurrentAppState(), options);
  }, [isVSCode, isEmbeddedChat, getCurrentAppState]);

  React.useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (!hasRouteParams()) return;
    const route = parseRoute();
    const initializeRoute = async () => {
      await applyRoute(route);
      if (!isVSCode && !isEmbeddedChat) {
        updateBrowserURL({
          ...getCurrentAppState(),
          sessionId: route.sessionId ?? useSessionUIStore.getState().currentSessionId,
          settingsPath: route.settingsPath ?? useUIStore.getState().settingsPage,
        }, { replace: true, force: true });
      }
    };
    void initializeRoute();
  }, [applyRoute, getCurrentAppState, isVSCode, isEmbeddedChat]);

  React.useEffect(() => {
    if (isVSCode || isEmbeddedChat) return;
    let prevSessionId: string | null = useSessionUIStore.getState().currentSessionId;
    const unsubscribe = useSessionUIStore.subscribe((state) => {
      const sessionId = state.currentSessionId;
      if (sessionId === prevSessionId || isApplyingRouteRef.current) return;
      prevSessionId = sessionId;
      syncURLFromState();
    });
    return unsubscribe;
  }, [isVSCode, isEmbeddedChat, syncURLFromState]);

  React.useEffect(() => {
    if (isVSCode || isEmbeddedChat) return;
    let prevSettingsOpen = useUIStore.getState().isSettingsDialogOpen;
    let prevSettingsPath = useUIStore.getState().settingsPage;
    const unsubscribe = useUIStore.subscribe((state) => {
      if (isApplyingRouteRef.current) return;
      const settingsOpenChanged = state.isSettingsDialogOpen !== prevSettingsOpen;
      const settingsPathChanged = state.settingsPage !== prevSettingsPath;
      prevSettingsOpen = state.isSettingsDialogOpen;
      prevSettingsPath = state.settingsPage;
      if (settingsOpenChanged || settingsPathChanged) syncURLFromState();
    });
    return unsubscribe;
  }, [isVSCode, isEmbeddedChat, syncURLFromState]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || isVSCode || isEmbeddedChat) return;
    const handlePopState = () => {
      const route = parseRoute();
      if (hasRouteParams()) void applyRoute(route);
      else if (useUIStore.getState().isSettingsDialogOpen) setSettingsDialogOpen(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyRoute, isVSCode, isEmbeddedChat, setSettingsDialogOpen]);
}
