import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';

interface Props {
  /** Deletes sessions, pins and history, and providers when ticked (D12). */
  onDeleteAll: (includeProviders: boolean) => Promise<void>;
}

type Status = 'idle' | 'confirming' | 'deleting' | 'done' | 'error';

/** Delete all data (D12), with a confirmation that says what goes. */
export function DeleteAllData({ onDeleteAll }: Props) {
  const [includeProviders, setIncludeProviders] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const refocusOpen = useRef(false);

  useEffect(() => {
    if (status === 'confirming') cancelRef.current?.focus();
    if (status !== 'confirming' && refocusOpen.current) {
      refocusOpen.current = false;
      openRef.current?.focus();
    }
  }, [status]);

  const cancel = () => {
    refocusOpen.current = true;
    setStatus('idle');
  };

  return (
    <section class="settings-section" aria-labelledby="delete-all-heading">
      <h3 id="delete-all-heading" class="section-label settings-label">
        {t('deleteAllHeading')}
      </h3>
      <div class="settings-card settings-card-body">
        <p class="settings-text">{t('deleteAllText')}</p>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={includeProviders}
            disabled={status === 'confirming' || status === 'deleting'}
            onChange={(event) => {
              setIncludeProviders(event.currentTarget.checked);
            }}
          />
          {t('deleteAllProviders')}
        </label>
        {status === 'confirming' || status === 'deleting' ? (
          <div
            class="confirm"
            role="group"
            aria-labelledby="delete-all-heading"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              cancel();
            }}
          >
            <p class="confirm-text">
              {t(includeProviders ? 'deleteAllConfirmProviders' : 'deleteAllConfirm')}
            </p>
            <div class="confirm-actions">
              <button ref={cancelRef} type="button" class="button" onClick={cancel}>
                {t('cancel')}
              </button>
              <button
                type="button"
                class="button button-danger"
                aria-disabled={status === 'deleting' ? 'true' : undefined}
                onClick={() => {
                  if (status === 'deleting') return;
                  setStatus('deleting');
                  onDeleteAll(includeProviders).then(
                    () => {
                      refocusOpen.current = true;
                      setIncludeProviders(false);
                      setStatus('done');
                    },
                    () => {
                      console.error('Sidekick: the data could not be deleted.');
                      refocusOpen.current = true;
                      setStatus('error');
                    },
                  );
                }}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={openRef}
            type="button"
            class="button button-danger-outline"
            onClick={() => {
              setStatus('confirming');
            }}
          >
            {t('deleteAllHeading')}
          </button>
        )}
        <div role="status">
          {status === 'done' && <p class="result-ok">{t('deleteAllDone')}</p>}
        </div>
        {status === 'error' && (
          <p class="error form-error" role="alert">
            {t('deleteAllError')}
          </p>
        )}
      </div>
    </section>
  );
}
