import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';
import type { ProviderConfig } from '@/shared/model';
import { BackIcon } from './icons';
import { DeleteAllData } from './settings/DeleteAllData';
import { ProviderForm } from './settings/ProviderForm';
import { ProviderList } from './settings/ProviderList';

interface Props {
  providers: ProviderConfig[];
  defaultProviderId: string | null;
  onBack: () => void;
  onDeleteAll: (includeProviders: boolean) => Promise<void>;
}

type Mode = { view: 'list'; focus: string | null } | { view: 'form'; id: string | null };

/**
 * Settings inside the sidebar (D14): providers (spec 5.7) and Delete all
 * data (D12). Back or Escape leaves the form first, then the settings.
 */
export function SettingsView({ providers, defaultProviderId, onBack, onDeleteAll }: Props) {
  const [mode, setMode] = useState<Mode>({ view: 'list', focus: null });
  const [saveError, setSaveError] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const editing =
    mode.view === 'form' && mode.id ? (providers.find((p) => p.id === mode.id) ?? null) : null;

  const closeForm = (savedId: string | null) => {
    const id = savedId ?? (mode.view === 'form' ? mode.id : null);
    setMode({ view: 'list', focus: id ? `edit-provider-${id}` : 'add-provider' });
  };

  const back = () => {
    if (mode.view === 'form') closeForm(null);
    else onBack();
  };

  return (
    <div
      class="settings"
      onKeyDown={(event) => {
        if (event.key === 'Escape') back();
      }}
    >
      <header class="header">
        <button
          ref={backRef}
          type="button"
          class="icon-button"
          aria-label={t('back')}
          title={t('back')}
          onClick={back}
        >
          <BackIcon />
        </button>
        <h2 class="settings-heading">{t('settings')}</h2>
      </header>
      <div class="settings-body">
        {saveError && (
          <p class="error form-error" role="alert">
            {t('saveError')}
          </p>
        )}
        {mode.view === 'form' ? (
          <ProviderForm key={mode.id ?? 'new'} existing={editing} onDone={closeForm} />
        ) : (
          <>
            <ProviderList
              providers={providers}
              defaultProviderId={defaultProviderId}
              initialFocus={mode.focus}
              onAdd={() => {
                setSaveError(false);
                setMode({ view: 'form', id: null });
              }}
              onEdit={(id) => {
                setSaveError(false);
                setMode({ view: 'form', id });
              }}
              onError={() => {
                setSaveError(true);
              }}
            />
            <DeleteAllData onDeleteAll={onDeleteAll} />
          </>
        )}
      </div>
    </div>
  );
}
