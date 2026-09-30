import { t } from '@/shared/i18n';

/** Chat transcript (spec 5.2 item 4). T03 renders the empty state; T10 fills it. */
export function Transcript() {
  return (
    <section class="transcript" aria-live="polite">
      <p class="muted transcript-empty">{t('transcriptEmpty')}</p>
    </section>
  );
}
