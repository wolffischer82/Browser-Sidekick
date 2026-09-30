import { useLayoutEffect, useRef } from 'preact/hooks';
import { renderAnswer } from '@/shared/chat/markdown';
import { t } from '@/shared/i18n';
import { llmErrorText } from '@/shared/llm-messages';
import type { Message, MessageSource } from '@/shared/model';
import type { LiveAnswer } from '../chat/useChat';

interface Props {
  messages: Message[];
  live: LiveAnswer | null;
  onStop: () => void;
  onRetry: () => void;
  /** A citation was clicked: focus the page's tab or open it (D13). */
  onOpenSource: (url: string) => void;
}

const citationLabel = (index: number, title: string) => t('citationLabel', String(index), title);

/** Sanitised Markdown with citation links; re-rendered as the text grows. */
function AnswerBody({ text, sources }: { text: string; sources: MessageSource[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(renderAnswer(text, sources, citationLabel));
  }, [text, sources]);
  return <div class="answer-body" ref={ref} />;
}

function Question({ message }: { message: Pick<Message, 'kind' | 'text'> }) {
  return (
    <article class="chat-question" aria-label={t('chatQuestionLabel')}>
      <p>{message.kind === 'summarize' ? t('summarize') : message.text}</p>
    </article>
  );
}

function Notices({ trimmed, tabSkipped }: { trimmed: boolean; tabSkipped?: boolean }) {
  return (
    <>
      {tabSkipped && <p class="answer-notice">{t('currentTabSkipped')}</p>}
      {trimmed && <p class="answer-notice">{t('answerTrimmed')}</p>}
    </>
  );
}

function Answer({ message }: { message: Message }) {
  return (
    <article
      class="chat-answer"
      aria-label={t('chatAnswerLabel')}
      data-stopped={message.stopped ? '' : undefined}
    >
      <AnswerBody text={message.text} sources={message.sources} />
      {message.stopped && <p class="answer-mark">{t('answerStopped')}</p>}
      <Notices trimmed={message.trimmed} />
      {message.model && (
        <p class="answer-meta">
          {message.providerLabel ? `${message.providerLabel} · ${message.model}` : message.model}
        </p>
      )}
    </article>
  );
}

function Live({
  answer,
  onStop,
  onRetry,
}: { answer: LiveAnswer } & Pick<Props, 'onStop' | 'onRetry'>) {
  const error = answer.error ? llmErrorText(answer.error) : null;
  return (
    <article
      class="chat-answer"
      aria-label={t('chatAnswerLabel')}
      aria-busy={answer.status !== 'error'}
      data-status={answer.status}
    >
      {answer.text !== '' && <AnswerBody text={answer.text} sources={answer.sources} />}
      {answer.status === 'waiting' && <p class="muted">{t('answerWaiting')}</p>}
      <Notices trimmed={answer.trimmed} tabSkipped={answer.tabSkipped} />
      {answer.status !== 'error' && (
        <button type="button" class="button stop-button" onClick={onStop}>
          {t('stop')}
        </button>
      )}
      {error && (
        <div class="error answer-error" role="alert">
          <p>{error.message}</p>
          {error.detail && <p class="answer-error-detail">{error.detail}</p>}
          <button type="button" class="button" onClick={onRetry}>
            {t('retry')}
          </button>
        </div>
      )}
    </article>
  );
}

/** Whether the list is scrolled to (near) its end. */
function atEnd(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

/**
 * Chat transcript (spec 5.2 item 4): questions, answers as sanitised
 * Markdown with clickable citations (D13), Stop while streaming, errors
 * inline with Retry. It follows a streaming answer unless the user has
 * scrolled up.
 */
export function Transcript({ messages, live, onStop, onRetry, onOpenSource }: Props) {
  const ref = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const liveQuestionStored = live !== null && messages.some((m) => m.id === live.questionId);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  });

  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest('a.citation');
    const href = link?.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    onOpenSource(href);
  };

  const empty = messages.length === 0 && live === null;
  return (
    <section
      class="transcript"
      ref={ref}
      onScroll={(event) => {
        follow.current = atEnd(event.currentTarget);
      }}
      onClick={onClick}
    >
      {empty ? (
        <p class="muted transcript-empty">{t('transcriptEmpty')}</p>
      ) : (
        <div class="chat-log" aria-live="polite">
          {messages.map((m) =>
            m.role === 'user' ? (
              <Question key={m.id} message={m} />
            ) : (
              <Answer key={m.id} message={m} />
            ),
          )}
          {live && !liveQuestionStored && (
            <Question message={{ kind: 'ask', text: live.question }} />
          )}
          {live && <Live answer={live} onStop={onStop} onRetry={onRetry} />}
        </div>
      )}
    </section>
  );
}
