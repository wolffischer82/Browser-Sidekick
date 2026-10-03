import { t } from '@/shared/i18n';
import type { SummarizeState } from '@/shared/chat/summarize';
import { LinesIcon } from './icons';

interface Props {
  /** Whether Summarize can be used, or why not. */
  state: SummarizeState;
  onSummarize: () => void;
}

/** Why Summarize is unavailable, as its tooltip. */
function reason(state: SummarizeState): string | null {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'noProvider':
      return t('summarizeNoProvider');
    case 'noAccess':
      return t('summarizeNoAccess', state.providerLabel);
    case 'busy':
      return t('summarizeBusy');
    case 'nothing':
      return t('summarizeUnavailable');
  }
}

/**
 * Summarize (spec 5.2 item 5) in the composer's toolbar (redesign spec 5.4).
 * It stays visible; while unavailable it is `aria-disabled` rather than
 * `disabled`, so it stays focusable and can say why. The tooltip is drawn by
 * the page instead of a `title`, so it also shows on keyboard focus
 * (decisions.md T11); it opens above the button. In a narrow panel only the
 * icon shows; the label stays as the accessible name (`style.css`).
 */
export function SummarizeButton({ state, onSummarize }: Props) {
  const hint = reason(state);
  return (
    <span class="tooltip-anchor summarize-anchor">
      <button
        id="summarize-button"
        type="button"
        class="button summarize-button"
        aria-disabled={hint !== null}
        aria-describedby={hint === null ? undefined : 'summarize-hint'}
        onClick={() => {
          if (hint === null) onSummarize();
        }}
      >
        <LinesIcon />
        <span class="summarize-label">{t('summarize')}</span>
      </button>
      {hint !== null && (
        <span id="summarize-hint" class="tooltip" role="tooltip">
          {hint}
        </span>
      )}
    </span>
  );
}
