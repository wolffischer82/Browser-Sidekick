import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import type { Message, Pin, Session } from '../model';

/** IndexedDB name (spec 6 "Storage"). */
export const DB_NAME = 'sidekick';

/** Current schema version. Raise it and append a step to `MIGRATIONS` to change the schema. */
export const DB_VERSION = 1;

export interface SidekickSchema extends DBSchema {
  sessions: { key: string; value: Session; indexes: { updatedAt: number } };
  pins: { key: string; value: Pin; indexes: { sessionId: string } };
  messages: { key: string; value: Message; indexes: { sessionId: string } };
}

export type SidekickDb = IDBPDatabase<SidekickSchema>;

export type UpgradeTransaction = IDBPTransaction<
  SidekickSchema,
  StoreNames<SidekickSchema>[],
  'versionchange'
>;

/**
 * One step per schema version: `migrations[n - 1]` upgrades version `n - 1`
 * to `n`. Steps get the upgrade transaction so they can rewrite records.
 */
export type Migration = (db: SidekickDb, tx: UpgradeTransaction) => void | Promise<void>;

/** Version 1: the initial stores. */
const v1: Migration = (db) => {
  db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
  db.createObjectStore('pins', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
  db.createObjectStore('messages', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
};

export const MIGRATIONS: readonly Migration[] = [v1];

export interface OpenDbOptions {
  name?: string;
  /** Tests pass extra steps to exercise the migration hook. */
  migrations?: readonly Migration[];
}

/**
 * Opens the database and runs every migration step between the stored
 * version and the target version (`migrations.length`).
 */
export async function openSidekickDb(options: OpenDbOptions = {}): Promise<SidekickDb> {
  const migrations = options.migrations ?? MIGRATIONS;
  let steps: Promise<void> = Promise.resolve();
  const opening = openDB<SidekickSchema>(options.name ?? DB_NAME, migrations.length, {
    upgrade(database, oldVersion, newVersion, tx) {
      const todo = migrations.slice(oldVersion, newVersion ?? migrations.length);
      // Steps run in order. Synchronous steps run inside this callback, while
      // the upgrade transaction is active; async steps may only await
      // requests on `tx`.
      const run = async (): Promise<void> => {
        for (const step of todo) {
          const result = step(database, tx);
          if (result) await result;
        }
      };
      steps = run();
      // A failing step aborts the upgrade, so the stored version stays unchanged.
      steps.catch(() => {
        tx.abort();
      });
      // The abort surfaces through `openDB`; `tx.done` must not reject unhandled.
      tx.done.catch(() => undefined);
    },
  });
  try {
    const db = await opening;
    // Let a newer version (another extension context after an update) upgrade.
    db.addEventListener('versionchange', () => {
      db.close();
    });
    return db;
  } catch (error) {
    // Report the failing migration step rather than the resulting AbortError.
    await steps;
    throw error;
  }
}
