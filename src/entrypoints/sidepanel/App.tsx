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
import { watchCurrentTab, type CurrentTab } from '@/shared/current-tab';
import { hasAllSitesAccess, requestAllSitesAccess } from '@/shared/page-access';
import { syncProviderAccess, watchHostAccess } from '@/shared/provider-access';
import { isUsable, modelGroups, resolveSessionModel } from '@/shared/providers';
import {
  clearSettingsForDeleteAll,
  getSettings,
  updateSettings,
  watchSettings,
} from '@/shared/settings';
import { AccessBanner } from './components/AccessBanner';
import { ActionBar } from './components/ActionBar';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { ModelMenu } from './components/ModelMenu';
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

type Status = 'loading' | 'ready' | 'error';

/** The one-line notice after a session's provider was deleted (spec 5.7). */
type Notice = 'none' | 'movedToDefault' | 'noProvider';

function refreshAccess(): void {
  syncProviderAccess().catch(() => {
    console.error('Sidekick: provider access could not be checked.');
  });
}

/** Refocuses the Session tabs toggle once the banner has gone. */
function focusAfterBanner(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.session-tabs-toggle')?.focus();
  });
}

/** Sidebar root (spec 5.2): header, sessions drawer and the session view. */
export function App({ repository }: Props) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [active, setActive] = useState<Session | null>(null);
  const [pinCount, setPinCount] = useState(0);
  const [tabsExpanded, setTabsExpanded] = useState(true);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>('none');
  const [currentTab, setCurrentTab] = useState<CurrentTab>({ state: 'none' });
  /** Whether the all-sites grant is held; `null` until checked (spec 5.3). */
  const [allSites, setAllSites] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [drawer, setDrawer] = useState<SessionSummary[] | null>(null);
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [focusPageAccess, setFocusPageAccess] = useState(false);
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
      setProviders(settings.providers);
      setDefaultProviderId(settings.defaultProviderId);
      setBannerDismissed(settings.accessBannerDismissed);
      setStatus('ready');
      // Host access can change outside the sidebar (decisions.md T05).
      refreshAccess();
    })().catch(() => {
      console.error('Sidekick: the session storage could not be opened.');
      if (!effect.cancelled) setStatus('error');
    });
    const unwatch = watchSettings((changed) => {
      if (changed.providers) setProviders(changed.providers);
      if (changed.defaultProviderId !== undefined) setDefaultProviderId(changed.defaultProviderId);
      if (changed.sessionTabsExpanded !== undefined) setTabsExpanded(changed.sessionTabsExpanded);
      if (changed.accessBannerDismissed !== undefined) {
        setBannerDismissed(changed.accessBannerDismissed);
      }
    });
    const checkAllSites = () => {
      void hasAllSitesAccess().then((granted) => {
        if (!effect.cancelled) setAllSites(granted);
      });
    };
    checkAllSites();
    const unwatchAccess = watchHostAccess(() => {
      refreshAccess();
      checkAllSites();
    });
    const unwatchTab = watchCurrentTab(setCurrentTab);
    return () => {
      effect.cancelled = true;
      unwatch();
      unwatchAccess();
      unwatchTab();
    };
  }, [repository]);

  // A session on a deleted provider moves to the default with a notice; a
  // session without a provider takes the default (spec 5.7, D15).
  useEffect(() => {
    if (!repo || !active || view !== 'main') return;
    const resolved = resolveSessionModel(active, providers, defaultProviderId);
    if (resolved.change === 'none') return;
    const effect = { cancelled: false };
    repo.updateSession(active.id, { providerId: resolved.providerId, model: resolved.model }).then(
      (updated) => {
        if (effect.cancelled || !updated) return;
        setActive(updated);
        if (resolved.change === 'deleted') {
          setNotice(resolved.providerId ? 'movedToDefault' : 'noProvider');
        }
      },
      () => {
        console.error('Sidekick: a session change could not be saved.');
        setSaveError(true);
      },
    );
    return () => {
      effect.cancelled = true;
    };
  }, [repo, active, providers, defaultProviderId, view]);

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
    setNotice('none');
    setActive(session);
  };

  const deleteAll = async (includeProviders: boolean) => {
    await repo.deleteAll();
    await clearSettingsForDeleteAll({ includeProviders });
    await show(repo, await createActiveSession(repo));
  };

  const dismissBanner = () => {
    setBannerDismissed(true);
    focusAfterBanner();
    run(() => updateSettings({ accessBannerDismissed: true }));
  };

  // The browser asks once (D2): a declined request hides the banner for good,
  // and pinning then asks per site (D10). The request must start in the click.
  const allowAllSites = () => {
    void requestAllSitesAccess().then((granted) => {
      if (granted) {
        setAllSites(true);
        focusAfterBanner();
      } else {
        dismissBanner();
      }
    });
  };

  const groups = modelGroups(providers);
  const sessionProvider = providers.find((p) => p.id === active.providerId);

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
          providers={providers}
          defaultProviderId={defaultProviderId}
          focusPageAccess={focusPageAccess}
          onDeleteAll={deleteAll}
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
            setFocusPageAccess(false);
            setView('settings');
          }}
          modelMenu={
            (groups.length > 0 || active.providerId !== null) && (
              <ModelMenu
                groups={groups}
                providerId={active.providerId}
                model={active.model}
                providerLabel={sessionProvider?.label ?? null}
                onChoose={(providerId, model) => {
                  run(async (r) => {
                    const updated = await r.updateSession(active.id, { providerId, model });
                    if (updated) setActive(updated);
                    setNotice('none');
                  });
                }}
              />
            )
          }
        />
        {notice !== 'none' && (
          <p class="notice" role="status">
            {t(
              notice === 'movedToDefault'
                ? 'sessionProviderDeleted'
                : 'sessionProviderDeletedNoDefault',
            )}
          </p>
        )}
        {saveError && (
          <p class="error" role="alert">
            {t('saveError')}
          </p>
        )}
        {allSites === false && !bannerDismissed && (
          <AccessBanner onAllow={allowAllSites} onDismiss={dismissBanner} />
        )}
        <SessionTabs
          pinCount={pinCount}
          currentTab={currentTab}
          expanded={tabsExpanded}
          onToggle={() => {
            const next = !tabsExpanded;
            setTabsExpanded(next);
            run(() => updateSettings({ sessionTabsExpanded: next }));
          }}
          onOpenPageAccess={() => {
            settingsOpener.current = '#page-access-link';
            setFocusPageAccess(true);
            setView('settings');
          }}
        />
        <Transcript />
        <ActionBar canSummarize={false} />
        <Composer
          hasProvider={providers.some(isUsable)}
          onOpenSettings={() => {
            settingsOpener.current = '#settings-link';
            setFocusPageAccess(false);
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
