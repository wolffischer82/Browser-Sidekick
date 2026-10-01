import type {
  Message,
  MessageKind,
  MessageRole,
  MessageSource,
  Pin,
  PinKind,
  Session,
  TitleSource,
} from '../model';
import { openSidekickDb, type OpenDbOptions, type SidekickDb } from './schema';

export interface NewSession {
  providerId: string | null;
  model: string | null;
  /** Defaults to `''` with `titleSource: 'fallback'` (D11). */
  title?: string;
  titleSource?: TitleSource;
}

/** `thinkingLevel: null` sets the session back to Default; left out keeps it. */
export type SessionUpdate = Partial<Pick<Session, 'providerId' | 'model' | 'thinkingLevel'>>;

export interface NewPin {
  url: string;
  title: string;
  kind: PinKind;
  faviconUrl?: string | null;
}

/** Fields that change while a pin is extracted or refreshed. `charCount` follows `text`. */
export type PinUpdate = Partial<
  Pick<
    Pin,
    | 'title'
    | 'faviconUrl'
    | 'kind'
    | 'text'
    | 'truncated'
    | 'status'
    | 'extractedAt'
    | 'failureReason'
  >
>;

export interface NewMessage {
  role: MessageRole;
  text: string;
  kind?: MessageKind;
  providerLabel?: string | null;
  model?: string | null;
  sources?: MessageSource[];
  stopped?: boolean;
  trimmed?: boolean;
  error?: Message['error'];
  /** An answer's reasoning; ignored for a user message. */
  reasoning?: string | null;
}

/** Fields that change while an answer streams and completes, or when it is retried. */
export type MessageUpdate = Partial<
  Pick<
    Message,
    'text' | 'providerLabel' | 'model' | 'sources' | 'stopped' | 'trimmed' | 'error' | 'reasoning'
  >
>;

export interface RepositoryOptions extends OpenDbOptions {
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Id generator, injectable for tests. */
  newId?: () => string;
}

/**
 * The single owner of every IndexedDB read and write (spec 6 "Storage").
 * Adding a pin or a message bumps the session's `updatedAt` in the same
 * transaction, and deleting a session removes its pins and messages with it.
 */
export interface Repository {
  createSession(input: NewSession): Promise<Session>;
  getSession(id: string): Promise<Session | undefined>;
  /** All sessions, most recent activity first. */
  listSessions(): Promise<Session[]>;
  updateSession(id: string, patch: SessionUpdate): Promise<Session | undefined>;
  /**
   * Sets the title. An `llm` or `fallback` title never replaces a `user`
   * title (D11). Returns whether the title was applied.
   */
  setSessionTitle(id: string, title: string, source: TitleSource): Promise<boolean>;
  /** Deletes the session with all its pins and messages. */
  deleteSession(id: string): Promise<void>;

  /** Adds a pin with status `extracting` at the end of the pin order. */
  addPin(sessionId: string, input: NewPin): Promise<Pin>;
  getPin(id: string): Promise<Pin | undefined>;
  /** The session's pins in pin order. */
  listPins(sessionId: string): Promise<Pin[]>;
  countPins(sessionId: string): Promise<number>;
  updatePin(id: string, patch: PinUpdate): Promise<Pin | undefined>;
  deletePin(id: string): Promise<void>;

  addMessage(sessionId: string, input: NewMessage): Promise<Message>;
  /** The session's messages in order. */
  listMessages(sessionId: string): Promise<Message[]>;
  updateMessage(id: string, patch: MessageUpdate): Promise<Message | undefined>;

  /** Removes all sessions, pins and messages (D12). Settings are untouched. */
  deleteAll(): Promise<void>;
  close(): void;
}

export class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found.');
    this.name = 'SessionNotFoundError';
  }
}

/** Drops `undefined` values so a patch never blanks a stored field. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function byPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position;
}

function nextPosition(items: { position: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
}

export async function openRepository(options: RepositoryOptions = {}): Promise<Repository> {
  const db: SidekickDb = await openSidekickDb(options);
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());

  return {
    async createSession(input) {
      const time = now();
      const session: Session = {
        id: newId(),
        title: input.title ?? '',
        titleSource: input.titleSource ?? 'fallback',
        providerId: input.providerId,
        model: input.model,
        createdAt: time,
        updatedAt: time,
      };
      await db.add('sessions', session);
      return session;
    },

    getSession(id) {
      return db.get('sessions', id);
    },

    async listSessions() {
      const sessions = await db.getAllFromIndex('sessions', 'updatedAt');
      return sessions.reverse();
    },

    async updateSession(id, patch) {
      const tx = db.transaction('sessions', 'readwrite');
      const current = await tx.store.get(id);
      if (!current) {
        await tx.done;
        return undefined;
      }
      const updated: Session = { ...current, ...defined(patch) };
      await Promise.all([tx.store.put(updated), tx.done]);
      return updated;
    },

    async setSessionTitle(id, title, source) {
      const tx = db.transaction('sessions', 'readwrite');
      const current = await tx.store.get(id);
      if (!current || (current.titleSource === 'user' && source !== 'user')) {
        await tx.done;
        return false;
      }
      await Promise.all([tx.store.put({ ...current, title, titleSource: source }), tx.done]);
      return true;
    },

    async deleteSession(id) {
      const tx = db.transaction(['sessions', 'pins', 'messages'], 'readwrite');
      const [pinIds, messageIds] = await Promise.all([
        tx.objectStore('pins').index('sessionId').getAllKeys(id),
        tx.objectStore('messages').index('sessionId').getAllKeys(id),
      ]);
      await Promise.all([
        ...pinIds.map((key) => tx.objectStore('pins').delete(key)),
        ...messageIds.map((key) => tx.objectStore('messages').delete(key)),
        tx.objectStore('sessions').delete(id),
        tx.done,
      ]);
    },

    async addPin(sessionId, input) {
      const tx = db.transaction(['sessions', 'pins'], 'readwrite');
      const sessions = tx.objectStore('sessions');
      const pins = tx.objectStore('pins');
      const [session, existing] = await Promise.all([
        sessions.get(sessionId),
        pins.index('sessionId').getAll(sessionId),
      ]);
      if (!session) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new SessionNotFoundError();
      }
      const time = now();
      const pin: Pin = {
        id: newId(),
        sessionId,
        position: nextPosition(existing),
        url: input.url,
        title: input.title,
        faviconUrl: input.faviconUrl ?? null,
        kind: input.kind,
        text: '',
        charCount: 0,
        truncated: false,
        status: 'extracting',
        extractedAt: null,
        failureReason: null,
        createdAt: time,
      };
      await Promise.all([pins.add(pin), sessions.put({ ...session, updatedAt: time }), tx.done]);
      return pin;
    },

    getPin(id) {
      return db.get('pins', id);
    },

    async listPins(sessionId) {
      const pins = await db.getAllFromIndex('pins', 'sessionId', sessionId);
      return pins.sort(byPosition);
    },

    countPins(sessionId) {
      return db.countFromIndex('pins', 'sessionId', sessionId);
    },

    async updatePin(id, patch) {
      const tx = db.transaction('pins', 'readwrite');
      const current = await tx.store.get(id);
      if (!current) {
        await tx.done;
        return undefined;
      }
      const updated: Pin = { ...current, ...defined(patch) };
      updated.charCount = updated.text.length;
      await Promise.all([tx.store.put(updated), tx.done]);
      return updated;
    },

    deletePin(id) {
      return db.delete('pins', id);
    },

    async addMessage(sessionId, input) {
      const tx = db.transaction(['sessions', 'messages'], 'readwrite');
      const sessions = tx.objectStore('sessions');
      const messages = tx.objectStore('messages');
      const [session, existing] = await Promise.all([
        sessions.get(sessionId),
        messages.index('sessionId').getAll(sessionId),
      ]);
      if (!session) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new SessionNotFoundError();
      }
      const time = now();
      const message: Message = {
        id: newId(),
        sessionId,
        position: nextPosition(existing),
        role: input.role,
        kind: input.kind ?? 'ask',
        text: input.text,
        createdAt: time,
        providerLabel: input.providerLabel ?? null,
        model: input.model ?? null,
        sources: input.sources ?? [],
        stopped: input.stopped ?? false,
        trimmed: input.trimmed ?? false,
        error: input.error ?? null,
        // Assistant messages only (specs/thinking-levels.md 5).
        ...(input.role === 'assistant' ? { reasoning: input.reasoning ?? null } : {}),
      };
      await Promise.all([
        messages.add(message),
        sessions.put({ ...session, updatedAt: time }),
        tx.done,
      ]);
      return message;
    },

    async listMessages(sessionId) {
      const messages = await db.getAllFromIndex('messages', 'sessionId', sessionId);
      return messages.sort(byPosition);
    },

    async updateMessage(id, patch) {
      const tx = db.transaction('messages', 'readwrite');
      const current = await tx.store.get(id);
      if (!current) {
        await tx.done;
        return undefined;
      }
      const updated: Message = { ...current, ...defined(patch) };
      await Promise.all([tx.store.put(updated), tx.done]);
      return updated;
    },

    async deleteAll() {
      const tx = db.transaction(['sessions', 'pins', 'messages'], 'readwrite');
      await Promise.all([
        tx.objectStore('sessions').clear(),
        tx.objectStore('pins').clear(),
        tx.objectStore('messages').clear(),
        tx.done,
      ]);
    },

    close() {
      db.close();
    },
  };
}
