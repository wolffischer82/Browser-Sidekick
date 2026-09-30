import { t } from '@/shared/i18n';

interface Props {
  canSummarize: boolean;
}

/**
 * Action bar (spec 5.2 item 5). Summarize stays visible; while unavailable it
 * is `aria-disabled` rather than `disabled`, so it stays focusable and its
 * tooltip shows. T11 wires the action.
 */
export function ActionBar({ canSummarize }: Props) {
  return (
    <div class="action-bar">
      <button
        type="button"
        class="button"
        aria-disabled={!canSummarize}
        title={canSummarize ? undefined : t('summarizeUnavailable')}
      >
        {t('summarize')}
      </button>
    </div>
  );
}
