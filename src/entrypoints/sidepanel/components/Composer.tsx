import { useState } from 'preact/hooks';
import { t } from '@/shared/i18n';

/** Why the input can or can't send (spec 5.2 item 6, 5.7). */
export type ComposerState =
  | { kind: 'ready' }
  | { kind: 'noProvider' }
  /** The session's provider lost or never had host access (spec 5.7 "no access"). */
  | { kind: 'noAccess'; providerLabel: string };

interface Props {
  state: ComposerState;
  /** A question is on its way; Enter doesn't send another. */
  busy: boolean;
  onSend: (question: string) => void;
  onOpenSettings: () => void;
  /** Requests the provider's host access; must run in the click (Firefox). */
  onGrantAccess: () => void;
}

/**
 * Question input (spec 5.2 item 6): Enter sends, Shift+Enter adds a newline.
 * Disabled with a link to settings while no provider is configured, and with
 * Grant access while the session's provider has no access.
 */
export function Composer({ state, busy, onSend, onOpenSettings, onGrantAccess }: Props) {
  const [text, setText] = useState('');
  const disabled = state.kind !== 'ready';
  const hintId = disabled ? 'composer-hint' : undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (busy || text.trim() === '') return;
    onSend(text);
    setText('');
  };

  return (
    <div class="composer">
      <textarea
        id="composer-input"
        class="composer-input"
        rows={2}
        placeholder={t('inputPlaceholder')}
        aria-label={t('inputPlaceholder')}
        aria-describedby={hintId}
        disabled={disabled}
        value={text}
        onInput={(event) => {
          setText(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
      />
      {state.kind === 'noProvider' && (
        <p id="composer-hint" class="composer-hint">
          {t('noProviderHint')}{' '}
          <button id="settings-link" type="button" class="link-button" onClick={onOpenSettings}>
            {t('openSettings')}
          </button>
        </p>
      )}
      {state.kind === 'noAccess' && (
        <p id="composer-hint" class="composer-hint">
          {t('providerNoAccessComposer', state.providerLabel)}{' '}
          <button type="button" class="link-button" onClick={onGrantAccess}>
            {t('grantAccess')}
          </button>
        </p>
      )}
    </div>
  );
}
