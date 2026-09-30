import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';
import type { ProviderConfig } from '@/shared/model';
import { accessPattern, requestHostAccess } from '@/shared/provider-access';
import { makeDefaultProvider, removeProvider, setProviderAccess } from '@/shared/provider-settings';
import { TrashIcon } from '../icons';
import { KIND_LABELS } from './ProviderForm';

interface Props {
  providers: ProviderConfig[];
  defaultProviderId: string | null;
  /** Element id to focus after the first render (returning from the form). */
  initialFocus: string | null;
  onAdd: () => void;
  onEdit: (id: string) => void;
  /** A provider write failed. */
  onError: () => void;
}

/**
 * The saved providers (spec 5.7): the default is marked, a provider without
 * host access shows "No access" with Grant access, and each row can be made
 * default, edited or deleted (with confirmation).
 */
export function ProviderList(props: Props) {
  const { providers, defaultProviderId } = props;
  const [confirming, setConfirming] = useState<string | null>(null);
  const focusNext = useRef<string | null>(props.initialFocus);

  useEffect(() => {
    if (!focusNext.current) return;
    const target = document.getElementById(focusNext.current);
    if (!target) return;
    target.focus();
    focusNext.current = null;
  });

  const run = (action: Promise<void>, focusId: string | null = null) => {
    focusNext.current = focusId;
    action.catch(() => {
      console.error('Sidekick: a provider change could not be saved.');
      props.onError();
    });
  };

  const grant = (provider: ProviderConfig) => {
    const pattern = accessPattern(provider);
    if (!pattern) return;
    // Asked synchronously in the click: Firefox refuses after an await.
    run(
      requestHostAccess(pattern).then((granted) =>
        granted ? setProviderAccess(provider.id, true) : undefined,
      ),
    );
  };

  return (
    <section class="settings-section" aria-labelledby="providers-heading">
      <div class="settings-section-header">
        <h3 id="providers-heading" class="settings-subheading">
          {t('providersHeading')}
        </h3>
        <button id="add-provider" type="button" class="button" onClick={props.onAdd}>
          {t('addProvider')}
        </button>
      </div>
      {providers.length === 0 ? (
        <p class="muted">{t('settingsNoProviders')}</p>
      ) : (
        <ul class="provider-list">
          {providers.map((p) => {
            const isDefault = p.id === defaultProviderId;
            return (
              <li key={p.id} class="provider-row">
                {confirming === p.id ? (
                  <div
                    class="confirm"
                    role="group"
                    aria-label={p.label}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.stopPropagation();
                      focusNext.current = `delete-provider-${p.id}`;
                      setConfirming(null);
                    }}
                  >
                    <p class="confirm-title">{p.label}</p>
                    <p class="confirm-text">{t('deleteProviderConfirm')}</p>
                    <div class="confirm-actions">
                      <button
                        id="provider-confirm-cancel"
                        type="button"
                        class="button"
                        onClick={() => {
                          focusNext.current = `delete-provider-${p.id}`;
                          setConfirming(null);
                        }}
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        class="button button-danger"
                        onClick={() => {
                          setConfirming(null);
                          run(removeProvider(p.id), 'add-provider');
                        }}
                      >
                        {t('delete')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div class="provider-main">
                      <p class="provider-title">
                        <span class="provider-label">{p.label}</span>
                        {isDefault && <span class="badge">{t('providerDefaultBadge')}</span>}
                        {!p.hasAccess && (
                          <span class="badge badge-warning">{t('providerNoAccessBadge')}</span>
                        )}
                      </p>
                      <p class="provider-meta">
                        {t(KIND_LABELS[p.kind])} · {p.defaultModel}
                      </p>
                      {!p.hasAccess && (
                        <p class="provider-meta">
                          {t('providerNoAccessHint')}{' '}
                          <button
                            type="button"
                            class="link-button"
                            onClick={() => {
                              grant(p);
                            }}
                          >
                            {t('grantAccess')}
                          </button>
                        </p>
                      )}
                      <div class="provider-actions">
                        {!isDefault && p.hasAccess && (
                          <button
                            type="button"
                            class="link-button"
                            aria-label={t('makeDefaultNamed', p.label)}
                            onClick={() => {
                              run(makeDefaultProvider(p.id));
                            }}
                          >
                            {t('makeDefault')}
                          </button>
                        )}
                        <button
                          id={`edit-provider-${p.id}`}
                          type="button"
                          class="link-button"
                          aria-label={t('editProviderNamed', p.label)}
                          onClick={() => {
                            props.onEdit(p.id);
                          }}
                        >
                          {t('edit')}
                        </button>
                      </div>
                    </div>
                    <button
                      id={`delete-provider-${p.id}`}
                      type="button"
                      class="icon-button"
                      aria-label={t('deleteProviderNamed', p.label)}
                      title={t('deleteProviderNamed', p.label)}
                      onClick={() => {
                        focusNext.current = 'provider-confirm-cancel';
                        setConfirming(p.id);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
