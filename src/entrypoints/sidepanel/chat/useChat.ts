import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { assembleContext, requestCurrentTab } from '@/shared/chat/context';
import { readCurrentTabText } from '@/shared/chat/current-tab-text';
import { generateSessionTitle, isFirstAnswer } from '@/shared/chat/title';
import type { CurrentTab } from '@/shared/current-tab';
import type { Repository } from '@/shared/db/repository';
import { createProvider, LlmError } from '@/shared/llm';
import { broadcast, isSidekickMessage } from '@/shared/messages';
import type { Message, MessageSource, ProviderConfig, Session } from '@/shared/model';

/**
 * The ask flow (spec 5.6). Streaming lives in this sidebar: the answer
 * streams into memory and is stored once it finishes or is stopped, and
 * other sidebars showing the session then read the stored message
 * (`messages-changed`). A failed answer stays in memory with its error and
 * a Retry that resends the same question (decisions.md T10). Nothing about
 * the question, the pages or the answer is logged.
 */

/** An answer that isn't stored yet: waiting, streaming, or failed. */
export interface LiveAnswer {
  sessionId: string;
  /** The stored question this answers; `null` until it is saved. */
  questionId: string | null;
  question: string;
  status: 'waiting' | 'streaming' | 'error';
  text: string;
  sources: MessageSource[];
  trimmed: boolean;
  /** The current tab should have been sent but couldn't be read. */
  tabSkipped: boolean;
  error: LlmError | null;
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
  /** The active session's unfinished or failed answer. */
  live: LiveAnswer | null;
  /** A question of the active session is on its way. */
  busy: boolean;
  send: (question: string, tab: TabContext) => void;
  stop: () => void;
  retry: (tab: TabContext) => void;
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

  const ask = (question: string, tab: TabContext, retryOf: Message | null) => {
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
      questionId: retryOf?.id ?? null,
      question,
      status: 'waiting',
      text: '',
      sources: [],
      trimmed: false,
      tabSkipped: false,
      error: null,
    };
    live.current.set(id, answer);
    rerender();

    const llm = createProvider(provider);
    const finish = async (stopped: boolean) => {
      live.current.delete(id);
      const earlier = await repo.listMessages(id);
      await repo.addMessage(id, {
        role: 'assistant',
        kind: 'ask',
        text: answer.text,
        providerLabel: provider.label,
        model,
        sources: answer.sources,
        stopped,
        trimmed: answer.trimmed,
      });
      await reload(repo, id);
      rerender();
      await broadcast({ type: 'messages-changed', sessionId: id });
      if (stopped || answer.text === '') return;
      // D11: one title request after the first completed answer.
      const stored = await repo.getSession(id);
      if (stored?.titleSource !== 'fallback' || !isFirstAnswer(earlier)) return;
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

    void (async () => {
      const userMessage =
        retryOf ?? (await repo.addMessage(id, { role: 'user', kind: 'ask', text: question }));
      answer.questionId = userMessage.id;
      await reload(repo, id);
      if (!retryOf) await broadcast({ type: 'messages-changed', sessionId: id });

      const [all, pins] = await Promise.all([repo.listMessages(id), repo.listPins(id)]);
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
      for await (const delta of llm.stream(request, controller.signal)) {
        answer.text += delta;
        rerenderSoon();
      }
    })()
      .then(
        () => finish(false),
        async (error: unknown) => {
          const mapped = llm.mapError(error);
          if (mapped.code === 'aborted') {
            await finish(true);
            return;
          }
          answer.status = 'error';
          answer.error = mapped;
          rerender();
        },
      )
      .catch(() => {
        // Storing failed, e.g. the session was deleted meanwhile.
        live.current.delete(id);
        rerender();
      })
      .finally(() => {
        controllers.current.delete(id);
        rerender();
      });
  };

  const current = sessionId ? (live.current.get(sessionId) ?? null) : null;

  return {
    messages,
    live: current,
    busy: current !== null && current.status !== 'error',
    send: (question, tab) => {
      const text = question.trim();
      if (!text || !sessionId) return;
      // A new question replaces a failed answer's Retry.
      if (live.current.get(sessionId)?.status === 'error') live.current.delete(sessionId);
      ask(text, tab, null);
    },
    stop: () => {
      if (sessionId) controllers.current.get(sessionId)?.abort();
    },
    retry: (tab) => {
      if (!current || current.status !== 'error') return;
      const question = messages.find((m) => m.id === current.questionId);
      if (!question) {
        live.current.delete(current.sessionId);
        ask(current.question, tab, null);
        return;
      }
      ask(question.text, tab, question);
    },
  };
}
