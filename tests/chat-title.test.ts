import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TITLE_ANSWER_CHARS,
  cleanTitle,
  generateSessionTitle,
  isFirstAnswer,
  titleRequest,
} from '@/shared/chat/title';
import { openRepository, type Repository } from '@/shared/db/repository';
import { LlmError, type LlmProvider, type LlmRequest, type LlmStreamEvent } from '@/shared/llm';
import type { Message } from '@/shared/model';

// The LLM session title (D11, spec 5.6): one request after the first answer,
// with the first question and the first 2,000 characters of the answer;
// never replaces a manual rename, also when the rename lands meanwhile.

let repo: Repository;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repo = await openRepository();
});

afterEach(() => {
  repo.close();
});

function provider(
  reply: (request: LlmRequest, signal: AbortSignal) => AsyncIterable<LlmStreamEvent>,
): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    kind: 'openai-compatible',
    calls,
    listModels: () => Promise.resolve({ models: [], info: {} }),
    stream(request, signal) {
      calls.push(request);
      return reply(request, signal);
    },
    mapError: (error) => (error instanceof LlmError ? error : new LlmError('unknown')),
  };
}

const text = (delta: string): LlmStreamEvent => ({ type: 'text', delta });
const reasoning = (delta: string): LlmStreamEvent => ({ type: 'reasoning', delta });

async function* events(...parts: LlmStreamEvent[]): AsyncIterable<LlmStreamEvent> {
  for (const part of parts) {
    await Promise.resolve();
    yield part;
  }
}

/** A reply of text deltas only. */
const chunks = (...parts: string[]) => events(...parts.map(text));

describe('titleRequest', () => {
  it('carries the question and the first 2,000 characters of the answer', () => {
    const answer = 'a'.repeat(TITLE_ANSWER_CHARS) + 'TAIL';
    const request = titleRequest('m-1', 'Why trains?', answer);
    expect(request.model).toBe('m-1');
    expect(request.system).toMatch(/6 words/);
    expect(request.system).toMatch(/language of the conversation/);
    expect(request.turns).toHaveLength(1);
    const text = request.turns[0]?.content ?? '';
    expect(text).toContain('Why trains?');
    expect(text).toContain('a'.repeat(TITLE_ANSWER_CHARS));
    expect(text).not.toContain('TAIL');
  });
});

describe('cleanTitle', () => {
  it.each([
    ['Night trains in Europe', 'Night trains in Europe'],
    ['"Night trains in Europe."', 'Night trains in Europe'],
    ['Title: **Night trains**', 'Night trains'],
    ['# Nachtzüge in Europa\n\nMore text', 'Nachtzüge in Europa'],
    ['  \n„Nachtzüge kehren zurück“  ', 'Nachtzüge kehren zurück'],
    ['one two three four five six seven eight', 'one two three four five six'],
    ['', null],
    ['   \n  ', null],
    ['"."', null],
  ])('%j -> %j', (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });

  it('caps very long words', () => {
    expect(cleanTitle('x'.repeat(300))?.length).toBeLessThanOrEqual(80);
  });
});

describe('isFirstAnswer', () => {
  const msg = (patch: Partial<Message>): Message => ({
    id: 'x',
    sessionId: 's',
    position: 0,
    role: 'assistant',
    kind: 'ask',
    text: 'answer',
    createdAt: 0,
    providerLabel: null,
    model: null,
    sources: [],
    stopped: false,
    trimmed: false,
    ...patch,
  });

  it('is true when no earlier answer completed', () => {
    expect(isFirstAnswer([])).toBe(true);
    expect(isFirstAnswer([msg({ role: 'user' }), msg({ stopped: true })])).toBe(true);
    expect(isFirstAnswer([msg({ role: 'user' }), msg({ error: 'server' })])).toBe(true);
  });

  it('is false after a completed answer', () => {
    expect(isFirstAnswer([msg({ role: 'user' }), msg({})])).toBe(false);
  });
});

describe('generateSessionTitle', () => {
  it('applies the cleaned title as an llm title', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    const p = provider(() => chunks('"Night ', 'trains ', 'return."'));
    const applied = await generateSessionTitle({
      repo,
      provider: p,
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(true);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]?.model).toBe('m');
    const stored = await repo.getSession(session.id);
    expect(stored?.title).toBe('Night trains return');
    expect(stored?.titleSource).toBe('llm');
  });

  it('replaces the first-pin fallback title', async () => {
    const session = await repo.createSession({
      providerId: 'p',
      model: 'm',
      title: 'Pinned page title',
    });
    await generateSessionTitle({
      repo,
      provider: provider(() => chunks('New title')),
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect((await repo.getSession(session.id))?.title).toBe('New title');
  });

  it('keeps the fallback title on failure, silently', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    const failing = provider(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new LlmError('rate-limit', { status: 429 })),
      }),
    }));
    const applied = await generateSessionTitle({
      repo,
      provider: failing,
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(false);
    const stored = await repo.getSession(session.id);
    expect(stored?.title).toBe('');
    expect(stored?.titleSource).toBe('fallback');
  });

  it('keeps the fallback title when the reply is empty', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    const applied = await generateSessionTitle({
      repo,
      provider: provider(() => chunks('  ', '\n')),
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(false);
    expect((await repo.getSession(session.id))?.titleSource).toBe('fallback');
  });

  it('keeps reasoning events out of the title', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    let seen: AbortSignal | undefined;
    const p = provider((_request, signal) => {
      seen = signal;
      return events(
        // Longer than the runaway limit: reasoning doesn't count towards it.
        reasoning('The user wants a short title. '.repeat(20)),
        text('Night '),
        reasoning('Shorter? No.\n'),
        text('trains'),
        reasoning(' Done.'),
      );
    });
    const applied = await generateSessionTitle({
      repo,
      provider: p,
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(true);
    expect(seen?.aborted).toBe(false);
    const stored = await repo.getSession(session.id);
    expect(stored?.title).toBe('Night trains');
    expect(stored?.titleSource).toBe('llm');
  });

  it('keeps the fallback title when only reasoning arrives', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    const applied = await generateSessionTitle({
      repo,
      provider: provider(() => events(reasoning('A title made of thoughts'))),
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(false);
    const stored = await repo.getSession(session.id);
    expect(stored?.title).toBe('');
    expect(stored?.titleSource).toBe('fallback');
  });

  it('makes no request when the user already renamed the session', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    await repo.setSessionTitle(session.id, 'Mine', 'user');
    const p = provider(() => chunks('LLM title'));
    const applied = await generateSessionTitle({
      repo,
      provider: p,
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(false);
    expect(p.calls).toHaveLength(0);
    expect((await repo.getSession(session.id))?.title).toBe('Mine');
  });

  it('never overwrites a rename that lands while the title request runs', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    const p = provider(async function* () {
      yield text('LLM ');
      // The user renames the session mid-request.
      await repo.setSessionTitle(session.id, 'Renamed meanwhile', 'user');
      yield text('title');
    });
    const applied = await generateSessionTitle({
      repo,
      provider: p,
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(false);
    const stored = await repo.getSession(session.id);
    expect(stored?.title).toBe('Renamed meanwhile');
    expect(stored?.titleSource).toBe('user');
  });

  it('does nothing for a deleted session', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    await repo.deleteSession(session.id);
    const applied = await generateSessionTitle({
      repo,
      provider: provider(() => chunks('Title')),
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(applied).toBe(false);
  });

  it('stops reading a runaway reply and aborts the request', async () => {
    const session = await repo.createSession({ providerId: 'p', model: 'm' });
    let seen: AbortSignal | undefined;
    let yielded = 0;
    const p = provider(async function* (_request, signal) {
      seen = signal;
      for (let i = 0; i < 1000; i += 1) {
        await Promise.resolve();
        yielded += 1;
        yield text('word ');
      }
    });
    const applied = await generateSessionTitle({
      repo,
      provider: p,
      sessionId: session.id,
      model: 'm',
      question: 'Q',
      answer: 'A',
    });
    expect(seen?.aborted).toBe(true);
    expect(yielded).toBeLessThan(100);
    expect(applied).toBe(true);
    expect((await repo.getSession(session.id))?.title).toBe('word word word word word word');
  });
});
