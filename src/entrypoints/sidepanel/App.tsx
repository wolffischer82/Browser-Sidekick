import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { Repository } from '@/shared/db/repository';
import { t } from '@/shared/i18n';
import { broadcast, isSidekickMessage, sendToBackground } from '@/shared/messages';
import type { Pin, ProviderConfig, Session } from '@/shared/model';
import { findTab, focusOrOpen, watchOpenTabs, type OpenTab } from '@/shared/open-tabs';
import {
  activateSession,
  createActiveSession,
  deleteSessionAndResolveActive,
  openActiveSession,
} from '@/shared/sessions';
import { watchCurrentTab, type CurrentTab } from '@/shared/current-tab';
import { summarizeState, summaryPageSet } from '@/shared/chat/summarize';
import { hasAllSitesAccess, requestAllSitesAccess, requestSiteAccess } from '@/shared/page-access';
import {
  accessPattern,
  requestHostAccess,
  syncProviderAccess,
  watchHostAccess,
} from '@/shared/provider-access';
import { setProviderAccess } from '@/shared/provider-settings';
import { isUsable, modelGroups, resolveSessionModel } from '@/shared/providers';
import {
  clearSettingsForDeleteAll,
  getSettings,
  updateSettings,
  watchSettings,
} from '@/shared/settings';
import { AccessBanner } from './components/AccessBanner';
import { useChat, type TabContext } from './chat/useChat';
import { ActionBar } from './components/ActionBar';
import { Composer, type ComposerState } from './components/Composer';
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

/** A pin or refresh request that did nothing (spec 5.4, D3). */
type PinError = 'none' | 'pin' | 'refresh';

/** Sidebar root (spec 5.2): header, sessions drawer and the session view. */
export function App({ repository }: Props) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [active, setActive] = useState<Session | null>(null);
  /** The active session's pins in pin order (spec 5.2 item 3). */
  const [pins, setPins] = useState<Pin[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  /** The tab the eye toggle excluded; cleared when another tab becomes current (D9). */
  const [excludedTabId, setExcludedTabId] = useState<number | null>(null);
  /** The pin an "Already pinned" notice is about (spec 5.4). */
  const [alreadyPinnedId, setAlreadyPinnedId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<PinError>('none');
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
  /** The session shown, for broadcasts that arrive between renders. */
  const activeId = useRef<string | null>(null);
  activeId.current = active?.id ?? null;
  /** A broadcast arrived before the session was loaded. */
  const missedSync = useRef(false);
  /** An "Already pinned" that arrived before the session was loaded (D17). */
  const missedAlreadyPinned = useRef<{ sessionId: string; pinId: string } | null>(null);
  /** Only the latest pin read is applied. */
  const pinsRead = useRef(0);
  /** A pin whose Unpin button gets focus once it is listed. */
  const focusPinId = useRef<string | null>(null);
  const chat = useChat({
    repo,
    session: active,
    providers,
    onTitleChanged: (id) => {
      if (repo) void reloadPins(repo, id);
    },
  });

  /**
   * Re-reads the pins of session `id` and its title (the first pin sets the
   * fallback title, D11), if that session is still shown.
   */
  const reloadPins = async (r: Repository, id: string | null): Promise<void> => {
    if (!id) return;
    const read = ++pinsRead.current;
    const [list, session] = await Promise.all([r.listPins(id), r.getSession(id)]);
    if (read !== pinsRead.current || activeId.current !== id) return;
    setPins(list);
    if (!session) return;
    setActive((shown) =>
      shown?.id === id &&
      (shown.title !== session.title || shown.titleSource !== session.titleSource)
        ? { ...shown, title: session.title, titleSource: session.titleSource }
        : shown,
    );
  };

  useEffect(() => {
    // An object, so the async closure sees the cleanup's write.
    const effect = { cancelled: false };
    (async () => {
      const opened = await repository;
      const [session, settings] = await Promise.all([openActiveSession(opened), getSettings()]);
      const list = await opened.listPins(session.id);
      if (effect.cancelled) return;
      setRepo(opened);
      setActive(session);
      setPins(list);
      activeId.current = session.id;
      if (missedSync.current) {
        missedSync.current = false;
        void reloadPins(opened, session.id);
      }
      if (missedAlreadyPinned.current?.sessionId === session.id) {
        setAlreadyPinnedId(missedAlreadyPinned.current.pinId);
      }
      missedAlreadyPinned.current = null;
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
    // Live sync (decisions.md T07): the background and other sidebars announce
    // pin changes; the sidebar showing that session re-reads it. Registered
    // at once, so nothing is missed while the session loads.
    const onMessage = (message: unknown): undefined => {
      if (!isSidekickMessage(message)) return;
      if (
        message.type !== 'pins-changed' &&
        message.type !== 'already-pinned' &&
        message.type !== 'title-changed'
      ) {
        return;
      }
      const id = activeId.current;
      if (id === null) {
        missedSync.current = true;
        if (message.type === 'already-pinned') missedAlreadyPinned.current = message;
        return;
      }
      if (message.sessionId !== id) return;
      if (message.type === 'already-pinned') setAlreadyPinnedId(message.pinId);
      void repository.then((r) => reloadPins(r, id));
    };
    browser.runtime.onMessage.addListener(onMessage);
    const unwatchTab = watchCurrentTab(setCurrentTab);
    const unwatchOpenTabs = watchOpenTabs(setOpenTabs);
    return () => {
      effect.cancelled = true;
      browser.runtime.onMessage.removeListener(onMessage);
      unwatch();
      unwatchAccess();
      unwatchTab();
      unwatchOpenTabs();
    };
  }, [repository]);

  // The eye toggle's exclusion lasts until another tab becomes current (D9).
  const currentTabId = currentTab.state === 'none' ? null : currentTab.tabId;
  useEffect(() => {
    setExcludedTabId((excluded) => (excluded === currentTabId ? excluded : null));
  }, [currentTabId]);

  useEffect(() => {
    const id = focusPinId.current;
    if (!id) return;
    const button = document.querySelector<HTMLElement>(`[data-pin-id="${id}"] .unpin-button`);
    if (button) {
      focusPinId.current = null;
      button.focus();
    }
  }, [pins]);

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
    const read = ++pinsRead.current;
    const list = await r.listPins(session.id);
    if (read !== pinsRead.current) return;
    setPins(list);
    setAlreadyPinnedId(null);
    setPinError('none');
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

  const isOpen = (pin: Pin) => findTab(openTabs, pin.url) !== undefined;
  const alreadyPinned = pins.find((p) => p.id === alreadyPinnedId) ?? null;

  // The needle (D9, D10). A tab readable only through `activeTab` asks for
  // its site first, synchronously in the click (Firefox refuses later), so
  // Refresh keeps working after `activeTab` lapses. Pinning goes ahead
  // either way: `activeTab` still allows this read.
  const pinCurrent = () => {
    if (currentTab.state !== 'readable') return;
    const tab = currentTab;
    const access = tab.siteAccess ? Promise.resolve(true) : requestSiteAccess(tab.url);
    const sessionId = active.id;
    run(async (r) => {
      await access;
      const outcome = await sendToBackground({ type: 'pin-tab', sessionId, tabId: tab.tabId });
      setPinError(outcome.status === 'refused' ? 'pin' : 'none');
      setAlreadyPinnedId(outcome.status === 'duplicate' ? outcome.pinId : null);
      if (outcome.status === 'pinned') focusPinId.current = outcome.pinId;
      await reloadPins(r, sessionId);
    });
  };

  const refreshPin = (pin: Pin) => {
    setAlreadyPinnedId(null);
    run(async (r) => {
      const outcome = await sendToBackground({ type: 'refresh-pin', pinId: pin.id });
      setPinError(outcome.status === 'refused' ? 'refresh' : 'none');
      await reloadPins(r, pin.sessionId);
    });
  };

  // Unpinning leaves past messages and their sources alone (spec 5.4).
  const unpin = (pin: Pin) => {
    if (alreadyPinnedId === pin.id) setAlreadyPinnedId(null);
    run(async (r) => {
      await r.deletePin(pin.id);
      await reloadPins(r, pin.sessionId);
      document.querySelector<HTMLElement>('.session-tabs-toggle')?.focus();
      await broadcast({ type: 'pins-changed', sessionId: pin.sessionId });
    });
  };

  const groups = modelGroups(providers);
  const sessionProvider = providers.find((p) => p.id === active.providerId);

  // The input (spec 5.2 item 6, 5.7): a session on a provider without host
  // access shows that state with Grant access instead of sending.
  let composerState: ComposerState = { kind: 'ready' };
  if (sessionProvider && !sessionProvider.hasAccess) {
    composerState = { kind: 'noAccess', providerLabel: sessionProvider.label };
  } else if (!sessionProvider && !providers.some(isUsable)) {
    composerState = { kind: 'noProvider' };
  }

  const currentTabExcluded = currentTabId !== null && excludedTabId === currentTabId;
  const tabContext = (): TabContext => ({ currentTab, excluded: currentTabExcluded });

  // Summarize (D4): all ready pins plus the current tab, if there is anything.
  const summarize = summarizeState({
    provider: sessionProvider,
    model: active.model,
    busy: chat.busy,
    pages: summaryPageSet(pins, currentTab, currentTabExcluded),
  });

  const grantSessionProvider = () => {
    if (!sessionProvider) return;
    const pattern = accessPattern(sessionProvider);
    if (!pattern) return;
    // Asked synchronously in the click: Firefox refuses after an await.
    const id = sessionProvider.id;
    run(async () => {
      if (await requestHostAccess(pattern)) await setProviderAccess(id, true);
    });
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
              await broadcast({ type: 'title-changed', sessionId: active.id });
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
        {pinError !== 'none' && (
          <p class="error" role="alert">
            {t(pinError === 'pin' ? 'pinFailed' : 'refreshFailed')}
          </p>
        )}
        <SessionTabs
          pins={pins}
          currentTab={currentTab}
          currentTabExcluded={currentTabExcluded}
          isOpen={isOpen}
          alreadyPinned={alreadyPinned}
          onPinCurrent={pinCurrent}
          onToggleExcluded={() => {
            setExcludedTabId((excluded) => (excluded === currentTabId ? null : currentTabId));
          }}
          onOpen={(pin) => {
            focusOrOpen(pin.url).catch(() => {
              console.error('Sidekick: a page could not be opened.');
            });
          }}
          onRefresh={refreshPin}
          onUnpin={unpin}
          onDismissNotice={() => {
            setAlreadyPinnedId(null);
          }}
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
        <Transcript
          messages={chat.messages}
          live={chat.live}
          errorOf={chat.errorOf}
          onStop={() => {
            chat.stop();
            document.getElementById('composer-input')?.focus();
          }}
          onRetry={(failed) => {
            chat.retry(failed, tabContext());
          }}
          onOpenSource={(url) => {
            focusOrOpen(url).catch(() => {
              console.error('Sidekick: a page could not be opened.');
            });
          }}
        />
        <ActionBar
          state={summarize}
          onSummarize={() => {
            chat.summarize(tabContext());
          }}
        />
        <Composer
          state={composerState}
          busy={chat.busy}
          onSend={(question) => {
            chat.send(question, tabContext());
          }}
          onGrantAccess={grantSessionProvider}
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
