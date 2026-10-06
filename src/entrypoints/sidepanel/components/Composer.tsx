import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { SummarizeState } from '@/shared/chat/summarize';
import { t } from '@/shared/i18n';
import { ArrowUpIcon, PlusIcon } from './icons';
import { SummarizeButton } from './SummarizeButton';

/** Why the input can or can't send (spec 5.2 item 6, 5.7). */
export type ComposerState =
  | { kind: 'ready' }
  | { kind: 'noProvider' }
  /** The session's provider lost or never had host access (spec 5.7 "no access"). */
  | { kind: 'noAccess'; providerLabel: string };

interface Props {
  state: ComposerState;
  /** A question is on its way; neither Enter nor Send sends another. */
  busy: boolean;
  onSend: (question: string) => void;
  onOpenSettings: () => void;
  /** Requests the provider's host access; must run in the click (Firefox). */
  onGrantAccess: () => void;
  /** Whether Summarize can be used, or why not. */
  summarize: SummarizeState;
  onSummarize: () => void;
  /**
   * Starts a new session (redesign spec O4, 5.4). Usable whenever the header
   * button it replaces was, including while asking is unavailable.
   */
  onNewSession: () => void;
  /** The session model dropdown (D15), first in the toolbar. */
  modelMenu?: ComponentChildren;
  /** The session's thinking level (specs/thinking-levels.md 4.1), next to the model. */
  thinkingMenu?: ComponentChildren;
}

/**
 * The composer (spec 5.2 item 6, redesign spec 5.4): one card holding the
 * question input and a toolbar with the model and thinking menus, New
 * session, Summarize and Send. Enter and Send send, Shift+Enter adds a newline; Send is
 * disabled whenever Enter wouldn't send. Under the card, the keyboard hint,
 * or why asking is unavailable: no provider (with a link to settings) or no
 * host access for the session's provider (with Grant access).
 */
export function Composer(props: Props) {
  const { state, busy, onSend } = props;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unavailable = state.kind !== 'ready';
  const hintId = unavailable ? 'composer-hint' : undefined;
  const canSend = !unavailable && !busy && text.trim() !== '';

  const send = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <div class="composer">
      <div class="composer-card" data-unavailable={unavailable ? '' : undefined}>
        <textarea
          ref={inputRef}
          id="composer-input"
          class="composer-input"
          rows={2}
          placeholder={t('inputPlaceholder')}
          aria-label={t('inputPlaceholder')}
          aria-describedby={hintId}
          disabled={unavailable}
          value={text}
          onInput={(event) => {
            setText(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
        <div class="composer-toolbar">
          {props.modelMenu}
          {props.thinkingMenu}
          <span class="composer-spacer" />
          <button
            id="new-session-button"
            type="button"
            class="button new-session-button"
            aria-label={t('newSession')}
            title={t('newSession')}
            onClick={props.onNewSession}
          >
            <PlusIcon />
          </button>
          <SummarizeButton state={props.summarize} onSummarize={props.onSummarize} />
          <button
            id="send-button"
            type="button"
            class="send-button"
            aria-label={t('send')}
            title={t('send')}
            disabled={!canSend}
            onClick={() => {
              send();
              inputRef.current?.focus();
            }}
          >
            <ArrowUpIcon />
          </button>
        </div>
      </div>
      {state.kind === 'ready' && <p class="composer-hint composer-keys">{t('composerHint')}</p>}
      {state.kind === 'noProvider' && (
        <p id="composer-hint" class="composer-hint">
          {t('noProviderHint')}{' '}
          <button
            id="settings-link"
            type="button"
            class="link-button"
            onClick={props.onOpenSettings}
          >
            {t('openSettings')}
          </button>
        </p>
      )}
      {state.kind === 'noAccess' && (
        <p id="composer-hint" class="composer-hint">
          {t('providerNoAccessComposer', state.providerLabel)}{' '}
          <button type="button" class="link-button" onClick={props.onGrantAccess}>
            {t('grantAccess')}
          </button>
        </p>
      )}
    </div>
  );
}
