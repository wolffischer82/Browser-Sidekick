import { useEffect, useRef } from 'preact/hooks';
import { t } from '@/shared/i18n';
import { BackIcon } from './icons';

interface Props {
  onBack: () => void;
}

/** Settings inside the sidebar (D14). T03 provides the frame; T05 adds providers. */
export function SettingsView({ onBack }: Props) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  return (
    <div
      class="settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onBack();
      }}
    >
      <header class="header">
        <button
          ref={backRef}
          type="button"
          class="icon-button"
          aria-label={t('back')}
          title={t('back')}
          onClick={onBack}
        >
          <BackIcon />
        </button>
        <h2 class="settings-heading">{t('settings')}</h2>
      </header>
      <div class="settings-body">
        <p class="muted">{t('settingsNoProviders')}</p>
      </div>
    </div>
  );
}
