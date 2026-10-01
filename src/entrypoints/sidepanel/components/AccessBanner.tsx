import { t } from '@/shared/i18n';

interface Props {
  /** Must call `permissions.request` synchronously (Firefox; decisions.md T06). */
  onAllow: () => void;
  onDismiss: () => void;
}

/**
 * First-use banner asking for access to all sites (spec 5.3, D2). Shown
 * until access is granted, the request is declined, or it is dismissed.
 */
export function AccessBanner({ onAllow, onDismiss }: Props) {
  return (
    <section class="access-banner" aria-label={t('accessBannerLabel')}>
      <p>{t('accessBannerText')}</p>
      <div class="access-banner-actions">
        <button type="button" class="button button-primary" onClick={onAllow}>
          {t('accessBannerAllow')}
        </button>
        <button type="button" class="button" onClick={onDismiss}>
          {t('accessBannerDismiss')}
        </button>
      </div>
    </section>
  );
}
