// Installs IDBRequest, IDBKeyRange and the other IndexedDB globals idb needs.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRepository, SessionNotFoundError, type Repository } from '@/shared/db/repository';

let repo: Repository;
let clock: number;

function tick(ms = 1000): void {
  clock += ms;
}

beforeEach(async () => {
  // A fresh, empty IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory();
  clock = 1_700_000_000_000;
  let id = 0;
  repo = await openRepository({ now: () => clock, newId: () => `id-${String(++id)}` });
});

afterEach(() => {
  repo.close();
});

const page = { url: 'https://example.com/a', title: 'Page A', kind: 'page' } as const;

describe('sessions', () => {
  it('creates a session with the fallback title and its provider and model', async () => {
    const session = await repo.createSession({ providerId: 'p1', model: 'gpt-x' });
    expect(session).toEqual({
      id: 'id-1',
      title: '',
      titleSource: 'fallback',
      providerId: 'p1',
      model: 'gpt-x',
      createdAt: clock,
      updatedAt: clock,
    });
    expect(await repo.getSession(session.id)).toEqual(session);
  });

  it('accepts an initial title and a session without a provider', async () => {
    const session = await repo.createSession({
      providerId: null,
      model: null,
      title: 'Page A',
      titleSource: 'fallback',
    });
    expect(session).toMatchObject({ title: 'Page A', providerId: null, model: null });
  });

  it('returns undefined for an unknown session', async () => {
    expect(await repo.getSession('missing')).toBeUndefined();
  });

  it('lists sessions by last activity, most recent first', async () => {
    const a = await repo.createSession({ providerId: null, model: null });
    tick();
    const b = await repo.createSession({ providerId: null, model: null });
    tick();
    const c = await repo.createSession({ providerId: null, model: null });
    expect((await repo.listSessions()).map((s) => s.id)).toEqual([c.id, b.id, a.id]);

    tick();
    await repo.addPin(a.id, page);
    tick();
    await repo.addMessage(b.id, { role: 'user', text: 'Hi' });
    expect((await repo.listSessions()).map((s) => s.id)).toEqual([b.id, a.id, c.id]);
  });

  it('returns an empty list when there are no sessions', async () => {
    expect(await repo.listSessions()).toEqual([]);
  });

  it('changes the provider and model of one session only', async () => {
    const a = await repo.createSession({ providerId: 'p1', model: 'm1' });
    const b = await repo.createSession({ providerId: 'p1', model: 'm1' });
    const updated = await repo.updateSession(a.id, { providerId: 'p2', model: 'm2' });
    expect(updated).toMatchObject({ providerId: 'p2', model: 'm2', updatedAt: a.updatedAt });
    expect(await repo.getSession(a.id)).toEqual(updated);
    expect(await repo.getSession(b.id)).toEqual(b);
  });

  it('ignores undefined fields in an update', async () => {
    const a = await repo.createSession({ providerId: 'p1', model: 'm1' });
    expect(await repo.updateSession(a.id, { model: undefined })).toEqual(a);
  });

  it('returns undefined when updating an unknown session', async () => {
    expect(await repo.updateSession('missing', { model: 'm' })).toBeUndefined();
    expect(await repo.listSessions()).toEqual([]);
  });

  describe('setSessionTitle', () => {
    it('applies llm and user titles', async () => {
      const s = await repo.createSession({ providerId: null, model: null });
      expect(await repo.setSessionTitle(s.id, 'LLM title', 'llm')).toBe(true);
      expect(await repo.getSession(s.id)).toMatchObject({ title: 'LLM title', titleSource: 'llm' });
      expect(await repo.setSessionTitle(s.id, 'Mine', 'user')).toBe(true);
      expect(await repo.getSession(s.id)).toMatchObject({ title: 'Mine', titleSource: 'user' });
    });

    it('never overwrites a manual rename with an llm or fallback title', async () => {
      const s = await repo.createSession({ providerId: null, model: null });
      await repo.setSessionTitle(s.id, 'Mine', 'user');
      expect(await repo.setSessionTitle(s.id, 'LLM title', 'llm')).toBe(false);
      expect(await repo.setSessionTitle(s.id, 'Page A', 'fallback')).toBe(false);
      expect(await repo.getSession(s.id)).toMatchObject({ title: 'Mine', titleSource: 'user' });
      expect(await repo.setSessionTitle(s.id, 'Renamed again', 'user')).toBe(true);
    });

    it('does not bump updatedAt', async () => {
      const s = await repo.createSession({ providerId: null, model: null });
      tick();
      await repo.setSessionTitle(s.id, 'Mine', 'user');
      expect((await repo.getSession(s.id))?.updatedAt).toBe(s.updatedAt);
    });

    it('returns false for an unknown session', async () => {
      expect(await repo.setSessionTitle('missing', 'x', 'user')).toBe(false);
    });
  });
});

describe('pins', () => {
  it('adds a pin in extracting state and bumps updatedAt', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    tick();
    const pin = await repo.addPin(s.id, { ...page, faviconUrl: 'https://example.com/f.ico' });
    expect(pin).toEqual({
      id: 'id-2',
      sessionId: s.id,
      position: 0,
      url: page.url,
      title: page.title,
      faviconUrl: 'https://example.com/f.ico',
      kind: 'page',
      text: '',
      charCount: 0,
      truncated: false,
      status: 'extracting',
      extractedAt: null,
      failureReason: null,
      createdAt: clock,
    });
    expect(await repo.getPin(pin.id)).toEqual(pin);
    expect((await repo.getSession(s.id))?.updatedAt).toBe(clock);
  });

  it('defaults the favicon to null', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    expect((await repo.addPin(s.id, page)).faviconUrl).toBeNull();
  });

  it('refuses a pin for an unknown session and writes nothing', async () => {
    await expect(repo.addPin('missing', page)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(await repo.listPins('missing')).toEqual([]);
  });

  it('lists pins of one session in pin order, also within the same millisecond', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const other = await repo.createSession({ providerId: null, model: null });
    const first = await repo.addPin(s.id, { ...page, url: 'https://z.example/' });
    const second = await repo.addPin(s.id, { ...page, url: 'https://a.example/' });
    await repo.addPin(other.id, page);
    const third = await repo.addPin(s.id, { ...page, url: 'https://m.example/' });
    expect((await repo.listPins(s.id)).map((p) => p.id)).toEqual([first.id, second.id, third.id]);
    expect((await repo.listPins(s.id)).map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it('keeps later pins after earlier ones when a pin in between is removed', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const a = await repo.addPin(s.id, page);
    const b = await repo.addPin(s.id, page);
    await repo.deletePin(b.id);
    const c = await repo.addPin(s.id, page);
    expect(c.position).toBe(1);
    expect((await repo.listPins(s.id)).map((p) => p.id)).toEqual([a.id, c.id]);
  });

  it('counts pins per session', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const other = await repo.createSession({ providerId: null, model: null });
    await repo.addPin(s.id, page);
    await repo.addPin(s.id, page);
    await repo.addPin(other.id, page);
    expect(await repo.countPins(s.id)).toBe(2);
    expect(await repo.countPins(other.id)).toBe(1);
    expect(await repo.countPins('missing')).toBe(0);
  });

  it('stores the snapshot, keeps charCount in step with the text and does not bump updatedAt', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const pin = await repo.addPin(s.id, page);
    tick();
    const ready = await repo.updatePin(pin.id, {
      status: 'ready',
      text: 'Hello world',
      truncated: false,
      extractedAt: clock,
      title: 'Page A (updated)',
    });
    expect(ready).toMatchObject({
      status: 'ready',
      text: 'Hello world',
      charCount: 11,
      extractedAt: clock,
      title: 'Page A (updated)',
      position: 0,
    });
    expect(await repo.getPin(pin.id)).toEqual(ready);
    expect((await repo.getSession(s.id))?.updatedAt).toBe(pin.createdAt);
  });

  it('records a failure reason', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const pin = await repo.addPin(s.id, { ...page, kind: 'pdf' });
    const failed = await repo.updatePin(pin.id, { status: 'failed', failureReason: 'pdfTooLarge' });
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'pdfTooLarge', kind: 'pdf' });
  });

  it('returns undefined when updating an unknown pin', async () => {
    expect(await repo.updatePin('missing', { status: 'ready' })).toBeUndefined();
    expect(await repo.getPin('missing')).toBeUndefined();
  });

  it('unpins without touching messages and their sources', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const pin = await repo.addPin(s.id, page);
    const sources = [{ index: 1, title: page.title, url: page.url, origin: 'pin' as const }];
    const answer = await repo.addMessage(s.id, { role: 'assistant', text: 'See [1]', sources });
    await repo.deletePin(pin.id);
    expect(await repo.getPin(pin.id)).toBeUndefined();
    expect(await repo.listMessages(s.id)).toEqual([answer]);
  });
});

describe('messages', () => {
  it('adds user and assistant messages in order and bumps updatedAt', async () => {
    const s = await repo.createSession({ providerId: 'p1', model: 'm1' });
    tick();
    const question = await repo.addMessage(s.id, { role: 'user', text: 'What is A?' });
    const sources = [
      { index: 1, title: 'Page A', url: 'https://example.com/a', origin: 'pin' as const },
      { index: 2, title: 'Tab', url: 'https://example.com/t', origin: 'currentTab' as const },
    ];
    const answer = await repo.addMessage(s.id, {
      role: 'assistant',
      text: 'A is [1].',
      providerLabel: 'OpenAI',
      model: 'm1',
      sources,
      trimmed: true,
    });
    expect(question).toEqual({
      id: 'id-2',
      sessionId: s.id,
      position: 0,
      role: 'user',
      kind: 'ask',
      text: 'What is A?',
      createdAt: clock,
      providerLabel: null,
      model: null,
      sources: [],
      stopped: false,
      trimmed: false,
      error: null,
    });
    expect(answer).toMatchObject({
      position: 1,
      role: 'assistant',
      providerLabel: 'OpenAI',
      model: 'm1',
      sources,
      stopped: false,
      trimmed: true,
    });
    expect(await repo.listMessages(s.id)).toEqual([question, answer]);
    expect((await repo.getSession(s.id))?.updatedAt).toBe(clock);
  });

  it('stores a Summarize request as its own kind', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const m = await repo.addMessage(s.id, { role: 'user', kind: 'summarize', text: '' });
    expect(m.kind).toBe('summarize');
  });

  it('keeps the messages of each session apart', async () => {
    const a = await repo.createSession({ providerId: null, model: null });
    const b = await repo.createSession({ providerId: null, model: null });
    await repo.addMessage(a.id, { role: 'user', text: 'in a' });
    await repo.addMessage(b.id, { role: 'user', text: 'in b' });
    expect((await repo.listMessages(a.id)).map((m) => m.text)).toEqual(['in a']);
    expect(await repo.listMessages('missing')).toEqual([]);
  });

  it('refuses a message for an unknown session and writes nothing', async () => {
    await expect(repo.addMessage('missing', { role: 'user', text: 'x' })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    expect(await repo.listMessages('missing')).toEqual([]);
  });

  it('updates a streamed answer and marks it stopped', async () => {
    const s = await repo.createSession({ providerId: null, model: null });
    const answer = await repo.addMessage(s.id, { role: 'assistant', text: '' });
    const stopped = await repo.updateMessage(answer.id, { text: 'Partial', stopped: true });
    expect(stopped).toEqual({ ...answer, text: 'Partial', stopped: true });
    expect(await repo.listMessages(s.id)).toEqual([stopped]);
  });

  it('stores a failed answer with its error code, and a retry clears it', async () => {
    const s = await repo.createSession({ providerId: 'p1', model: 'm1' });
    await repo.addMessage(s.id, { role: 'user', text: 'Q' });
    const failed = await repo.addMessage(s.id, {
      role: 'assistant',
      text: 'Partial',
      error: 'rate-limit',
    });
    expect(failed.error).toBe('rate-limit');
    expect((await repo.listMessages(s.id))[1]?.error).toBe('rate-limit');

    const again = await repo.updateMessage(failed.id, { error: 'network', text: '' });
    expect(again).toMatchObject({ id: failed.id, position: 1, error: 'network', text: '' });

    const fixed = await repo.updateMessage(failed.id, {
      text: 'Answer',
      error: null,
      model: 'm2',
      providerLabel: 'P',
    });
    expect(fixed).toMatchObject({ id: failed.id, position: 1, text: 'Answer', error: null });
    expect((await repo.listMessages(s.id)).map((m) => m.error)).toEqual([null, null]);
  });

  it("stores an answer's reasoning, and an update replaces or clears it", async () => {
    const s = await repo.createSession({ providerId: 'p1', model: 'm1' });
    const question = await repo.addMessage(s.id, { role: 'user', text: 'Q', reasoning: 'never' });
    // Assistant messages only (specs/thinking-levels.md 5).
    expect(question).not.toHaveProperty('reasoning');
    const answer = await repo.addMessage(s.id, {
      role: 'assistant',
      text: 'Partial',
      error: 'server',
      reasoning: 'First thought.',
    });
    expect(answer.reasoning).toBe('First thought.');
    expect((await repo.listMessages(s.id)).map((m) => m.reasoning)).toEqual([
      undefined,
      'First thought.',
    ]);

    // An update that leaves the reasoning out keeps it.
    expect((await repo.updateMessage(answer.id, { trimmed: true }))?.reasoning).toBe(
      'First thought.',
    );
    const retried = await repo.updateMessage(answer.id, {
      text: 'Answer',
      error: null,
      reasoning: 'Second thought.',
    });
    expect(retried).toMatchObject({ id: answer.id, text: 'Answer', reasoning: 'Second thought.' });
    expect((await repo.updateMessage(answer.id, { reasoning: null }))?.reasoning).toBeNull();
    expect((await repo.listMessages(s.id))[1]?.reasoning).toBeNull();
  });

  it('an answer without reasoning stores null, and deleting the session deletes the reasoning', async () => {
    const s = await repo.createSession({ providerId: 'p1', model: 'm1' });
    const plain = await repo.addMessage(s.id, { role: 'assistant', text: 'A' });
    expect(plain.reasoning).toBeNull();
    await repo.addMessage(s.id, { role: 'assistant', text: 'B', reasoning: 'Thought.' });
    await repo.deleteSession(s.id);
    expect(await repo.listMessages(s.id)).toEqual([]);
  });

  it('an update that leaves the error out keeps it', async () => {
    const s = await repo.createSession({ providerId: 'p1', model: 'm1' });
    const failed = await repo.addMessage(s.id, { role: 'assistant', text: '', error: 'server' });
    expect((await repo.updateMessage(failed.id, { trimmed: true }))?.error).toBe('server');
  });

  it('returns undefined when updating an unknown message', async () => {
    expect(await repo.updateMessage('missing', { text: 'x' })).toBeUndefined();
  });
});

describe('deletion', () => {
  async function seed(): Promise<{ keep: string; drop: string }> {
    const drop = await repo.createSession({ providerId: null, model: null });
    const keep = await repo.createSession({ providerId: null, model: null });
    for (const id of [drop.id, keep.id]) {
      await repo.addPin(id, page);
      await repo.addPin(id, page);
      await repo.addMessage(id, { role: 'user', text: 'q' });
      await repo.addMessage(id, { role: 'assistant', text: 'a' });
    }
    return { keep: keep.id, drop: drop.id };
  }

  async function dumpStores(): Promise<{
    sessions: unknown[];
    pins: unknown[];
    messages: unknown[];
  }> {
    const { openSidekickDb } = await import('@/shared/db/schema');
    const db = await openSidekickDb();
    const result = {
      sessions: await db.getAll('sessions'),
      pins: await db.getAll('pins'),
      messages: await db.getAll('messages'),
    };
    db.close();
    return result;
  }

  it('cascade-deletes a session and leaves no orphan pins or messages', async () => {
    const { keep, drop } = await seed();
    await repo.deleteSession(drop);

    expect(await repo.getSession(drop)).toBeUndefined();
    const stores = await dumpStores();
    expect(stores.sessions).toHaveLength(1);
    expect(stores.pins).toHaveLength(2);
    expect(stores.messages).toHaveLength(2);
    for (const record of [...stores.pins, ...stores.messages]) {
      expect(record).toMatchObject({ sessionId: keep });
    }
  });

  it('deleting an unknown session is a no-op', async () => {
    await seed();
    await repo.deleteSession('missing');
    const stores = await dumpStores();
    expect(stores.sessions).toHaveLength(2);
    expect(stores.pins).toHaveLength(4);
  });

  it('deleteAll empties every store', async () => {
    await seed();
    await repo.deleteAll();
    expect(await dumpStores()).toEqual({ sessions: [], pins: [], messages: [] });
    expect(await repo.listSessions()).toEqual([]);
  });
});

describe('defaults', () => {
  it('uses the real clock and random ids when none are injected', async () => {
    const real = await openRepository({ name: 'sidekick-defaults' });
    const before = Date.now();
    const s = await real.createSession({ providerId: null, model: null });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.createdAt).toBeGreaterThanOrEqual(before);
    real.close();
  });
});
