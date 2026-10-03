import { t } from '@/shared/i18n';
import { ShieldIcon } from './icons';

interface Props {
  /** Must call `permissions.request` synchronously (Firefox; decisions.md T06). */
  onAllow: () => void;
  onDismiss: () => void;
}

/**
 * First-use banner asking for access to all sites (spec 5.3, D2). Shown
 * until access is granted, the request is declined, or it is dismissed.
 * A card with the shield tile (redesign spec 5.5).
 */
export function AccessBanner({ onAllow, onDismiss }: Props) {
  return (
    <section class="access-banner" aria-label={t('accessBannerLabel')}>
      <span class="access-banner-tile">
        <ShieldIcon />
      </span>
      <div class="access-banner-body">
        <p>{t('accessBannerText')}</p>
        <div class="access-banner-actions">
          <button type="button" class="button button-primary" onClick={onAllow}>
            {t('accessBannerAllow')}
          </button>
          <button type="button" class="button button-plain" onClick={onDismiss}>
            {t('accessBannerDismiss')}
          </button>
        </div>
      </div>
    </section>
  );
}
