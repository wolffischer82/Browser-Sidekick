import type { NewSession, Repository } from './db/repository';
import type { Session, Settings } from './model';
import { getSettings, updateSettings } from './settings';

/**
 * Session lifecycle rules (spec 5.1, 5.2, 5.7 "Session model"). The active
 * session id lives in `storage.local`; sessions live in the repository.
 */

/** A new session starts on the default provider and its default model (D15). */
export function newSessionInput(
  settings: Pick<Settings, 'providers' | 'defaultProviderId'>,
): NewSession {
  const provider = settings.providers.find((p) => p.id === settings.defaultProviderId);
  if (!provider?.hasAccess) return { providerId: null, model: null };
  return { providerId: provider.id, model: provider.defaultModel };
}

/** Creates an empty session and makes it the active one. */
export async function createActiveSession(repo: Repository): Promise<Session> {
  const session = await repo.createSession(newSessionInput(await getSettings()));
  await updateSettings({ activeSessionId: session.id });
  return session;
}

/**
 * The session the sidebar opens on: the stored active session, else the most
 * recent one, else a new empty session (first run).
 */
export async function openActiveSession(repo: Repository): Promise<Session> {
  const { activeSessionId } = await getSettings();
  if (activeSessionId) {
    const stored = await repo.getSession(activeSessionId);
    if (stored) return stored;
  }
  const [latest] = await repo.listSessions();
  if (latest) {
    await updateSettings({ activeSessionId: latest.id });
    return latest;
  }
  return createActiveSession(repo);
}

/** Makes `id` the active session; returns `undefined` if it doesn't exist. */
export async function activateSession(repo: Repository, id: string): Promise<Session | undefined> {
  const session = await repo.getSession(id);
  if (session) await updateSettings({ activeSessionId: id });
  return session;
}

/**
 * Deletes a session with its pins and messages. Deleting the active session
 * switches to the most recent remaining one, or to a new empty session.
 * Returns the active session afterwards.
 */
export async function deleteSessionAndResolveActive(
  repo: Repository,
  id: string,
  activeId: string,
): Promise<Session> {
  await repo.deleteSession(id);
  if (id !== activeId) {
    const active = await repo.getSession(activeId);
    if (active) return active;
  }
  const [latest] = await repo.listSessions();
  if (latest) {
    await updateSettings({ activeSessionId: latest.id });
    return latest;
  }
  return createActiveSession(repo);
}
