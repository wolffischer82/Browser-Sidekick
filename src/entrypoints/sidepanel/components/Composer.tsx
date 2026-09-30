import { t } from '@/shared/i18n';

interface Props {
  hasProvider: boolean;
  onOpenSettings: () => void;
}

/**
 * Question input (spec 5.2 item 6). Disabled with a link to settings while no
 * provider is configured; sending arrives with T10.
 */
export function Composer({ hasProvider, onOpenSettings }: Props) {
  return (
    <div class="composer">
      <textarea
        class="composer-input"
        rows={2}
        placeholder={t('inputPlaceholder')}
        aria-label={t('inputPlaceholder')}
        aria-describedby={hasProvider ? undefined : 'no-provider-hint'}
        disabled={!hasProvider}
      />
      {!hasProvider && (
        <p id="no-provider-hint" class="composer-hint">
          {t('noProviderHint')}{' '}
          <button id="settings-link" type="button" class="link-button" onClick={onOpenSettings}>
            {t('openSettings')}
          </button>
        </p>
      )}
    </div>
  );
}
