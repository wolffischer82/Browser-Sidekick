// Installs IDBRequest, IDBKeyRange and the other IndexedDB globals idb needs.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { IDBPDatabase } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  MIGRATIONS,
  openSidekickDb,
  type Migration,
} from '@/shared/db/schema';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('schema version 1', () => {
  it('creates the sidekick database with its stores and indexes', async () => {
    const db = await openSidekickDb();
    expect(db.name).toBe(DB_NAME);
    expect(db.name).toBe('sidekick');
    expect(db.version).toBe(1);
    expect(DB_VERSION).toBe(MIGRATIONS.length);
    expect([...db.objectStoreNames].sort()).toEqual(['messages', 'pins', 'sessions']);

    const tx = db.transaction(['sessions', 'pins', 'messages']);
    expect([...tx.objectStore('sessions').indexNames]).toEqual(['updatedAt']);
    expect([...tx.objectStore('pins').indexNames]).toEqual(['sessionId']);
    expect([...tx.objectStore('messages').indexNames]).toEqual(['sessionId']);
    expect(tx.objectStore('sessions').keyPath).toBe('id');
    await tx.done;
    db.close();
  });

  it('reopening at the same version runs no migration', async () => {
    (await openSidekickDb()).close();
    const step = vi.fn<Migration>();
    const db = await openSidekickDb({ migrations: [step] });
    expect(step).not.toHaveBeenCalled();
    db.close();
  });
});

describe('migration hook', () => {
  it('runs only the steps above the stored version, in order', async () => {
    const [v1] = MIGRATIONS;
    if (!v1) throw new Error('missing v1');
    const calls: string[] = [];
    const first = vi.fn<Migration>((db, tx) => {
      calls.push('v1');
      return v1(db, tx);
    });
    (await openSidekickDb({ migrations: [first] })).close();
    expect(calls).toEqual(['v1']);

    const v2: Migration = async (_db, tx) => {
      calls.push('v2');
      // Async steps may rewrite records through the upgrade transaction.
      const sessions = tx.objectStore('sessions');
      for (const session of await sessions.getAll()) {
        await sessions.put({ ...session, title: `${session.title} (v2)` });
      }
    };
    const v3: Migration = (db) => {
      calls.push('v3');
      // A store outside the typed schema, as a later version might add.
      (db as unknown as IDBPDatabase).createObjectStore('extra');
    };

    // Seed a record at version 1.
    const seeded = await openSidekickDb({ migrations: [first] });
    await seeded.put('sessions', {
      id: 's1',
      title: 'Old',
      titleSource: 'user',
      providerId: null,
      model: null,
      createdAt: 1,
      updatedAt: 1,
    });
    seeded.close();

    const db = await openSidekickDb({ migrations: [first, v2, v3] });
    expect(db.version).toBe(3);
    expect(calls).toEqual(['v1', 'v2', 'v3']);
    expect(first).toHaveBeenCalledTimes(1);
    expect((await db.get('sessions', 's1'))?.title).toBe('Old (v2)');
    expect([...db.objectStoreNames].sort()).toEqual(['extra', 'messages', 'pins', 'sessions']);
    db.close();
  });

  it('a failing step aborts the upgrade and keeps the stored version', async () => {
    (await openSidekickDb()).close();
    const broken: Migration = () => {
      throw new Error('broken step');
    };
    await expect(openSidekickDb({ migrations: [...MIGRATIONS, broken] })).rejects.toThrow(
      'broken step',
    );
    const db = await openSidekickDb();
    expect(db.version).toBe(1);
    db.close();
  });

  it('closes an open connection when a newer version upgrades', async () => {
    const old = await openSidekickDb();
    const noop: Migration = () => undefined;
    const newer = await openSidekickDb({ migrations: [...MIGRATIONS, noop] });
    expect(newer.version).toBe(2);
    newer.close();
    // The old connection was closed by its versionchange handler.
    expect(() => old.transaction('sessions')).toThrow();
  });
});
