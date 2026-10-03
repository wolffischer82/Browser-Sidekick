import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';
import { hasAllSitesAccess, requestAllSitesAccess } from '@/shared/page-access';
import { watchHostAccess } from '@/shared/provider-access';

interface Props {
  /** Focus and scroll to this section on mount (opened from the current-tab row). */
  focusOnMount?: boolean;
}

/**
 * Page access in settings (spec 5.3; decisions.md T06-14): the state of the
 * all-sites grant and, while it is missing, a way to ask for it again after
 * the first-use banner was dismissed or declined.
 */
export function PageAccess({ focusOnMount = false }: Props) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const effect = { cancelled: false };
    const check = () => {
      void hasAllSitesAccess().then((granted) => {
        if (!effect.cancelled) setAllowed(granted);
      });
    };
    check();
    const unwatch = watchHostAccess(check);
    return () => {
      effect.cancelled = true;
      unwatch();
    };
  }, []);

  useEffect(() => {
    if (!focusOnMount) return;
    headingRef.current?.scrollIntoView({ block: 'start' });
    headingRef.current?.focus();
  }, [focusOnMount]);

  // The request must be the first call in the click (Firefox).
  const allow = () => {
    void requestAllSitesAccess().then((granted) => {
      if (granted) setAllowed(true);
    });
  };

  return (
    <section id="page-access" class="settings-section" aria-labelledby="page-access-heading">
      <h3
        id="page-access-heading"
        class="section-label settings-label"
        ref={headingRef}
        tabIndex={-1}
      >
        {t('pageAccessHeading')}
      </h3>
      <div class="settings-card settings-card-body">
        <p class="settings-text">{t('pageAccessText')}</p>
        <div class="page-access-row">
          {allowed !== null && (
            <p class="page-access-state" role="status">
              <span
                class={`state-dot ${allowed ? 'state-dot-ok' : 'state-dot-warning'}`}
                aria-hidden="true"
              />
              {t(allowed ? 'pageAccessAllowed' : 'pageAccessNotAllowed')}
            </p>
          )}
          {allowed === false && (
            <button type="button" class="button button-primary" onClick={allow}>
              {t('accessBannerAllow')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
