import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { CITATION_CLASS, renderAnswer } from '@/shared/chat/markdown';
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
  /** A citation was clicked: focus the tab of that stored source, or open it (D13). */
  onOpenSource: (url: string) => void;
}

const citationLabel = (index: number, title: string) => t('citationLabel', String(index), title);

/** Opens a cited page; provided by the transcript to every answer. */
const OpenSource = createContext<(url: string) => void>(() => undefined);

/**
 * Sanitised Markdown with citation buttons; re-rendered as the text grows.
 * A citation button carries only its number: the page comes from this
 * answer's stored source list, never from the rendered output (D13).
 */
function AnswerBody({ text, sources }: { text: string; sources: MessageSource[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const openSource = useContext(OpenSource);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(renderAnswer(text, sources, citationLabel));
  }, [text, sources]);
  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(
      `button.${CITATION_CLASS}`,
    );
    if (!button) return;
    const source = sources.find((s) => String(s.index) === button.dataset.citation);
    if (source) openSource(source.url);
  };
  return <div class="answer-body" ref={ref} onClick={onClick} />;
}

function Question({ message }: { message: Pick<Message, 'kind' | 'text'> }) {
  return (
    <article class="chat-question" aria-label={t('chatQuestionLabel')}>
      <p>{message.kind === 'summarize' ? t('summarize') : message.text}</p>
    </article>
  );
}

interface NoticesProps {
  trimmed: boolean;
  tabSkipped?: boolean;
  pinsSkipped?: boolean;
}

function Notices({ trimmed, tabSkipped, pinsSkipped }: NoticesProps) {
  return (
    <>
      {pinsSkipped && <p class="answer-notice">{t('pinsSkipped')}</p>}
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
      {answer.status === 'waiting' && (
        <p class="muted">{t(answer.waitingForPins ? 'answerWaitingPins' : 'answerWaiting')}</p>
      )}
      <Notices
        trimmed={answer.trimmed}
        tabSkipped={answer.tabSkipped}
        pinsSkipped={answer.pinsSkipped}
      />
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

  const empty = shown.length === 0 && live === null;
  return (
    <section
      class="transcript"
      ref={ref}
      onScroll={(event) => {
        follow.current = atEnd(event.currentTarget);
      }}
    >
      {empty ? (
        <p class="muted transcript-empty">{t('transcriptEmpty')}</p>
      ) : (
        <OpenSource.Provider value={onOpenSource}>
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
              <Question message={{ kind: live.kind, text: live.question }} />
            )}
            {live && <Live answer={live} onStop={onStop} />}
          </div>
        </OpenSource.Provider>
      )}
    </section>
  );
}
