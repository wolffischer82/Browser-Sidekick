import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { assembleContext, requestCurrentTab } from '@/shared/chat/context';
import { readCurrentTabText } from '@/shared/chat/current-tab-text';
import { waitForPins } from '@/shared/chat/summarize';
import { generateSessionTitle, isFirstAnswer } from '@/shared/chat/title';
import type { CurrentTab } from '@/shared/current-tab';
import type { Repository } from '@/shared/db/repository';
import { t } from '@/shared/i18n';
import { createProvider, LlmError } from '@/shared/llm';
import { broadcast, isSidekickMessage } from '@/shared/messages';
import type { Message, MessageKind, MessageSource, ProviderConfig, Session } from '@/shared/model';

/**
 * The ask flow (spec 5.6). Streaming lives in this sidebar: the answer
 * streams into memory and is stored once it finishes, is stopped or fails,
 * and other sidebars showing the session then read the stored message
 * (`messages-changed`). A failed answer is stored with its error code
 * (decisions.md T10), so the error and Retry survive a reload; Retry resends
 * the same question and replaces the failed answer. Nothing about the
 * question, the pages or the answer is logged.
 *
 * Summarize (D4, decisions.md T11) is the same flow with the fixed prompt as
 * the question and `kind: 'summarize'`; it also waits briefly for pins that
 * are still being read.
 */

/** An answer on its way: waiting for the first text, or streaming. */
export interface LiveAnswer {
  sessionId: string;
  /** A typed question, or the Summarize request (shown as "Summarize"). */
  kind: MessageKind;
  question: string;
  /** The stored question this answers; `null` until it is saved. */
  questionId: string | null;
  /** The failed answer a Retry replaces; hidden while this one is on its way. */
  replacesId: string | null;
  status: 'waiting' | 'streaming';
  text: string;
  sources: MessageSource[];
  trimmed: boolean;
  /** The current tab should have been sent but couldn't be read. */
  tabSkipped: boolean;
  /** A summary is waiting for pins that are still being read. */
  waitingForPins: boolean;
  /** Pins were still being read after the wait and were left out. */
  pinsSkipped: boolean;
}

/** What the sidebar shows about the current tab when a question is sent. */
export interface TabContext {
  currentTab: CurrentTab;
  excluded: boolean;
}

interface Options {
  repo: Repository | null;
  session: Session | null;
  providers: ProviderConfig[];
  /** The session's title changed (the LLM title); re-read it. */
  onTitleChanged: (sessionId: string) => void;
}

export interface Chat {
  messages: Message[];
  /** The active session's answer that is on its way. */
  live: LiveAnswer | null;
  /** A question of the active session is on its way. */
  busy: boolean;
  /**
   * The full error of an answer that failed in this sidebar, for the
   * provider's own message; only the code is stored.
   */
  errorOf: (messageId: string) => LlmError | undefined;
  send: (question: string, tab: TabContext) => void;
  /** Sends the fixed Summarize request for D4's page set. */
  summarize: (tab: TabContext) => void;
  stop: () => void;
  /** Resends the question of the failed answer `failed`. */
  retry: (failed: Message, tab: TabContext) => void;
}

interface Retry {
  question: Message;
  failed: Message;
}

function frame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else setTimeout(callback, 16);
}

export function useChat({ repo, session, providers, onTitleChanged }: Options): Chat {
  const [messages, setMessages] = useState<Message[]>([]);
  /** Bumped to re-render when a live answer changes. */
  const [, setVersion] = useState(0);
  const live = useRef(new Map<string, LiveAnswer>());
  const controllers = useRef(new Map<string, AbortController>());
  const errors = useRef(new Map<string, LlmError>());
  const sessionId = session?.id ?? null;
  const shown = useRef<string | null>(null);
  shown.current = sessionId;
  const reads = useRef(0);
  const scheduled = useRef(false);
  const titleChanged = useRef(onTitleChanged);
  titleChanged.current = onTitleChanged;

  const rerender = () => {
    setVersion((v) => v + 1);
  };
  /** Streaming deltas re-render at most once per frame. */
  const rerenderSoon = () => {
    if (scheduled.current) return;
    scheduled.current = true;
    frame(() => {
      scheduled.current = false;
      rerender();
    });
  };

  const reload = async (r: Repository, id: string) => {
    const read = ++reads.current;
    const list = await r.listMessages(id);
    if (read === reads.current && shown.current === id) setMessages(list);
  };

  useEffect(() => {
    if (!repo || !sessionId) return;
    setMessages([]);
    reload(repo, sessionId).catch(() => {
      console.error('Sidekick: the chat history could not be read.');
    });
  }, [repo, sessionId]);

  // Other sidebars announce stored messages; the one showing that session re-reads.
  useEffect(() => {
    if (!repo) return;
    const onMessage = (message: unknown): undefined => {
      if (!isSidekickMessage(message) || message.type !== 'messages-changed') return;
      if (message.sessionId !== shown.current) return;
      reload(repo, message.sessionId).catch(() => {
        console.error('Sidekick: the chat history could not be read.');
      });
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [repo]);

  const ask = (kind: MessageKind, question: string, tab: TabContext, retry: Retry | null) => {
    if (!repo || !session) return;
    const provider = providers.find((p) => p.id === session.providerId);
    const model = session.model;
    if (!provider?.hasAccess || !model) return;
    const id = session.id;
    if (controllers.current.has(id)) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const answer: LiveAnswer = {
      sessionId: id,
      kind,
      question,
      questionId: retry?.question.id ?? null,
      replacesId: retry?.failed.id ?? null,
      status: 'waiting',
      text: '',
      sources: [],
      trimmed: false,
      tabSkipped: false,
      waitingForPins: false,
      pinsSkipped: false,
    };
    live.current.set(id, answer);
    rerender();

    const llm = createProvider(provider);

    /**
     * A summary waits a moment for pins that are still being read, so a page
     * pinned just before isn't missed; after that they are left out (D4).
     */
    const pinsForSummary = async () => {
      const waited = await waitForPins(
        () => repo.listPins(id),
        controller.signal,
        () => {
          answer.waitingForPins = true;
          rerender();
        },
      );
      answer.waitingForPins = false;
      answer.pinsSkipped = waited.stillExtracting > 0;
      if (controller.signal.aborted) throw new LlmError('aborted');
      return waited.pins;
    };

    /** Sends the question and collects the answer; rejects with what stopped it. */
    const stream = async () => {
      const userMessage =
        retry?.question ?? (await repo.addMessage(id, { role: 'user', kind, text: question }));
      answer.questionId = userMessage.id;
      await reload(repo, id);
      if (!retry) await broadcast({ type: 'messages-changed', sessionId: id });

      const pins = kind === 'summarize' ? await pinsForSummary() : await repo.listPins(id);
      const all = await repo.listMessages(id);
      const history = all.filter((m) => m.position < userMessage.position);
      const ref = requestCurrentTab(tab.currentTab, tab.excluded, pins);
      const page = ref ? await readCurrentTabText(ref) : null;
      answer.tabSkipped = ref !== null && page === null;
      const context = assembleContext({
        pins,
        currentTab: page,
        history,
        question,
        budgetTokens: provider.contextBudget,
      });
      answer.sources = context.sources;
      answer.trimmed = context.trimmed;
      if (controller.signal.aborted) throw new LlmError('aborted');
      answer.status = 'streaming';
      rerender();
      const request = { model, system: context.system, turns: context.turns };
      for await (const event of llm.stream(request, controller.signal)) {
        if (event.type === 'text') answer.text += event.delta;
        rerenderSoon();
      }
    };

    /** Stores the answer: finished, stopped (partial), or failed with its code. */
    const store = async (stopped: boolean, error: LlmError | null) => {
      const earlier = await repo.listMessages(id);
      const fields = {
        text: answer.text,
        providerLabel: provider.label,
        model,
        sources: answer.sources,
        stopped,
        trimmed: answer.trimmed,
        error: error?.code ?? null,
      };
      const stored =
        (retry && (await repo.updateMessage(retry.failed.id, fields))) ||
        (await repo.addMessage(id, { role: 'assistant', kind, ...fields }));
      if (error) errors.current.set(stored.id, error);
      else errors.current.delete(stored.id);
      await reload(repo, id);
      // The answer is stored: the session can ask again (or retry) at once.
      live.current.delete(id);
      controllers.current.delete(id);
      rerender();
      await broadcast({ type: 'messages-changed', sessionId: id });
      if (stopped || error || answer.text === '') return;
      // D11: one title request after the first completed answer.
      const current = await repo.getSession(id);
      if (current?.titleSource !== 'fallback' || !isFirstAnswer(earlier)) return;
      const applied = await generateSessionTitle({
        repo,
        provider: llm,
        sessionId: id,
        model,
        question,
        answer: answer.text,
      });
      if (!applied) return;
      titleChanged.current(id);
      await broadcast({ type: 'title-changed', sessionId: id });
    };

    stream()
      .then(
        () => store(false, null),
        (error: unknown) => {
          const mapped = llm.mapError(error);
          return mapped.code === 'aborted' ? store(true, null) : store(false, mapped);
        },
      )
      .catch(() => {
        // Storing failed, e.g. the session was deleted meanwhile.
        console.error('Sidekick: an answer could not be stored.');
      })
      .finally(() => {
        // Unless a new request of this session has started meanwhile.
        if (controllers.current.get(id) !== controller) return;
        live.current.delete(id);
        controllers.current.delete(id);
        rerender();
      });
  };

  const current = sessionId ? (live.current.get(sessionId) ?? null) : null;

  return {
    messages,
    live: current,
    busy: current !== null,
    errorOf: (messageId) => errors.current.get(messageId),
    send: (question, tab) => {
      const text = question.trim();
      if (text) ask('ask', text, tab, null);
    },
    summarize: (tab) => {
      ask('summarize', t('summarizePrompt'), tab, null);
    },
    stop: () => {
      if (sessionId) controllers.current.get(sessionId)?.abort();
    },
    retry: (failed, tab) => {
      const index = messages.findIndex((m) => m.id === failed.id);
      const question = messages
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((m) => m.role === 'user');
      if (index === -1 || !failed.error || !question) return;
      ask(question.kind, question.text, tab, { question, failed });
    },
  };
}
