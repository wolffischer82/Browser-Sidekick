import { useEffect, useRef, useState } from 'preact/hooks';
import type { Repository } from '@/shared/db/repository';
import { t } from '@/shared/i18n';
import type { ProviderConfig, Session } from '@/shared/model';
import {
  activateSession,
  createActiveSession,
  deleteSessionAndResolveActive,
  openActiveSession,
} from '@/shared/sessions';
import { getSettings, updateSettings, watchSettings } from '@/shared/settings';
import { ActionBar } from './components/ActionBar';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { SessionTabs } from './components/SessionTabs';
import { SessionsDrawer, type SessionSummary } from './components/SessionsDrawer';
import { SettingsView } from './components/SettingsView';
import { Transcript } from './components/Transcript';

interface Props {
  /** The sidebar's repository, opened once in `main.tsx`. */
  repository: Promise<Repository>;
}

/** The displayed title: the stored one, or the localised fallback (D11). */
export function displayTitle(session: Session): string {
  return session.title === '' ? t('fallbackTitle') : session.title;
}

function hasUsableProvider(providers: ProviderConfig[]): boolean {
  return providers.some((p) => p.hasAccess);
}

type Status = 'loading' | 'ready' | 'error';

/** Sidebar root (spec 5.2): header, sessions drawer and the session view. */
export function App({ repository }: Props) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [active, setActive] = useState<Session | null>(null);
  const [pinCount, setPinCount] = useState(0);
  const [tabsExpanded, setTabsExpanded] = useState(true);
  const [hasProvider, setHasProvider] = useState(false);
  const [drawer, setDrawer] = useState<SessionSummary[] | null>(null);
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [saveError, setSaveError] = useState(false);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  /** Selector of the control that opened settings, refocused on the way back. */
  const settingsOpener = useRef<string | null>(null);
  const refocusDrawerButton = useRef(false);

  useEffect(() => {
    // An object, so the async closure sees the cleanup's write.
    const effect = { cancelled: false };
    (async () => {
      const opened = await repository;
      const [session, settings] = await Promise.all([openActiveSession(opened), getSettings()]);
      const count = await opened.countPins(session.id);
      if (effect.cancelled) return;
      setRepo(opened);
      setActive(session);
      setPinCount(count);
      setTabsExpanded(settings.sessionTabsExpanded);
      setHasProvider(hasUsableProvider(settings.providers));
      setStatus('ready');
    })().catch(() => {
      console.error('Sidekick: the session storage could not be opened.');
      if (!effect.cancelled) setStatus('error');
    });
    const unwatch = watchSettings((changed) => {
      if (changed.providers) setHasProvider(hasUsableProvider(changed.providers));
      if (changed.sessionTabsExpanded !== undefined) setTabsExpanded(changed.sessionTabsExpanded);
    });
    return () => {
      effect.cancelled = true;
      unwatch();
    };
  }, [repository]);

  useEffect(() => {
    if (view === 'main' && settingsOpener.current) {
      document.querySelector<HTMLElement>(settingsOpener.current)?.focus();
      settingsOpener.current = null;
    }
  }, [view]);

  // After the drawer closes and the body is no longer inert.
  useEffect(() => {
    if (drawer === null && refocusDrawerButton.current) {
      refocusDrawerButton.current = false;
      drawerButtonRef.current?.focus();
    }
  }, [drawer]);

  if (status === 'error') {
    return (
      <main class="app">
        <p class="error" role="alert">
          {t('loadError')}
        </p>
      </main>
    );
  }
  if (!repo || !active) return <main class="app" aria-busy="true" />;

  /** Runs a session change; a failure shows the inline save error. */
  const run = (action: (repo: Repository) => Promise<void>) => {
    action(repo).then(
      () => {
        setSaveError(false);
      },
      () => {
        console.error('Sidekick: a session change could not be saved.');
        setSaveError(true);
      },
    );
  };

  const show = async (r: Repository, session: Session) => {
    setPinCount(await r.countPins(session.id));
    setActive(session);
  };

  const loadSummaries = async (r: Repository): Promise<SessionSummary[]> => {
    const sessions = await r.listSessions();
    const counts = await Promise.all(sessions.map((s) => r.countPins(s.id)));
    return sessions.map((session, i) => ({
      session,
      title: displayTitle(session),
      pinCount: counts[i] ?? 0,
    }));
  };

  const closeDrawer = () => {
    refocusDrawerButton.current = true;
    setDrawer(null);
  };

  if (view === 'settings') {
    return (
      <main class="app">
        <SettingsView
          onBack={() => {
            setView('main');
          }}
        />
      </main>
    );
  }

  return (
    <main class="app">
      <h1 class="visually-hidden">{t('sidebarHeading')}</h1>
      <div class="app-body" inert={drawer !== null}>
        <Header
          title={displayTitle(active)}
          drawerOpen={drawer !== null}
          drawerButtonRef={drawerButtonRef}
          onOpenDrawer={() => {
            run(async (r) => {
              setDrawer(await loadSummaries(r));
            });
          }}
          onRename={(title) => {
            run(async (r) => {
              await r.setSessionTitle(active.id, title, 'user');
              const updated = await r.getSession(active.id);
              if (updated) setActive(updated);
            });
          }}
          onNewSession={() => {
            run(async (r) => {
              await show(r, await createActiveSession(r));
            });
          }}
          onOpenSettings={() => {
            settingsOpener.current = '#settings-button';
            setView('settings');
          }}
        />
        {saveError && (
          <p class="error" role="alert">
            {t('saveError')}
          </p>
        )}
        <SessionTabs
          count={pinCount}
          expanded={tabsExpanded}
          onToggle={() => {
            const next = !tabsExpanded;
            setTabsExpanded(next);
            run(() => updateSettings({ sessionTabsExpanded: next }));
          }}
        />
        <Transcript />
        <ActionBar canSummarize={false} />
        <Composer
          hasProvider={hasProvider}
          onOpenSettings={() => {
            settingsOpener.current = '#settings-link';
            setView('settings');
          }}
        />
      </div>
      {drawer && (
        <SessionsDrawer
          sessions={drawer}
          activeId={active.id}
          now={Date.now()}
          onClose={closeDrawer}
          onSelect={(id) => {
            run(async (r) => {
              const session = await activateSession(r, id);
              if (session) await show(r, session);
              closeDrawer();
            });
          }}
          onDelete={(id) => {
            run(async (r) => {
              const next = await deleteSessionAndResolveActive(r, id, active.id);
              await show(r, next);
              setDrawer(await loadSummaries(r));
            });
          }}
        />
      )}
    </main>
  );
}
