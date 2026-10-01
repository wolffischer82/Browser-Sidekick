import { useLayoutEffect, useRef } from 'preact/hooks';
import { renderAnswer } from '@/shared/chat/markdown';
import { t } from '@/shared/i18n';
import { LlmError } from '@/shared/llm';
import { llmErrorText } from '@/shared/llm-messages';
import type { Message, MessageSource } from '@/shared/model';
import type { LiveAnswer } from '../chat/useChat';

interface Props {
  messages: Message[];
  live: LiveAnswer | null;
  /** The full error of an answer that failed in this sidebar, if still known. */
  errorOf: (messageId: string) => LlmError | undefined;
  onStop: () => void;
  /** Resends the question of a failed answer. */
  onRetry: (failed: Message) => void;
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

interface AnswerProps {
  message: Message;
  /** The full error, or `undefined` when only the stored code is known. */
  error: LlmError | undefined;
  /** Retry is offered on the newest message only. */
  onRetry: (() => void) | null;
}

function Answer({ message, error, onRetry }: AnswerProps) {
  const failure = message.error ? llmErrorText(error ?? new LlmError(message.error)) : null;
  return (
    <article
      class="chat-answer"
      aria-label={t('chatAnswerLabel')}
      data-stopped={message.stopped ? '' : undefined}
      data-failed={failure ? '' : undefined}
    >
      {message.text !== '' && <AnswerBody text={message.text} sources={message.sources} />}
      {message.stopped && <p class="answer-mark">{t('answerStopped')}</p>}
      <Notices trimmed={message.trimmed} />
      {failure && (
        <div class="error answer-error" role="alert">
          <p>{failure.message}</p>
          {failure.detail && <p class="answer-error-detail">{failure.detail}</p>}
          {onRetry && (
            <button type="button" class="button" onClick={onRetry}>
              {t('retry')}
            </button>
          )}
        </div>
      )}
      {message.model && (
        <p class="answer-meta">
          {message.providerLabel ? `${message.providerLabel} · ${message.model}` : message.model}
        </p>
      )}
    </article>
  );
}

function Live({ answer, onStop }: { answer: LiveAnswer; onStop: () => void }) {
  return (
    <article
      class="chat-answer"
      aria-label={t('chatAnswerLabel')}
      aria-busy="true"
      data-status={answer.status}
    >
      {answer.text !== '' && <AnswerBody text={answer.text} sources={answer.sources} />}
      {answer.status === 'waiting' && <p class="muted">{t('answerWaiting')}</p>}
      <Notices trimmed={answer.trimmed} tabSkipped={answer.tabSkipped} />
      <button type="button" class="button stop-button" onClick={onStop}>
        {t('stop')}
      </button>
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
export function Transcript({ messages, live, errorOf, onStop, onRetry, onOpenSource }: Props) {
  const ref = useRef<HTMLElement>(null);
  const follow = useRef(true);
  // A retried answer is replaced by the one on its way.
  const shown = live ? messages.filter((m) => m.id !== live.replacesId) : messages;
  const liveQuestionStored = live !== null && shown.some((m) => m.id === live.questionId);
  const last = shown.at(-1);

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

  const empty = shown.length === 0 && live === null;
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
          {shown.map((m) =>
            m.role === 'user' ? (
              <Question key={m.id} message={m} />
            ) : (
              <Answer
                key={m.id}
                message={m}
                error={errorOf(m.id)}
                onRetry={
                  m === last && live === null
                    ? () => {
                        onRetry(m);
                      }
                    : null
                }
              />
            ),
          )}
          {live && !liveQuestionStored && (
            <Question message={{ kind: 'ask', text: live.question }} />
          )}
          {live && <Live answer={live} onStop={onStop} />}
        </div>
      )}
    </section>
  );
}
