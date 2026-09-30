import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/** The provider hosts the manifest declares (spec 6). */
export const NATIVE_HOSTS = [
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://generativelanguage.googleapis.com/*',
];

export interface FakePermissions {
  granted: Set<string>;
  /** The origins of every `permissions.request` call, in order. */
  requests: string[][];
  /** What the next requests answer: grant, decline, or throw like a refused prompt. */
  answer: 'grant' | 'decline' | 'throw';
  /** Grants or revokes from outside (browser settings) and fires the event. */
  grant(pattern: string): void;
  revoke(pattern: string): void;
}

function withoutPort(pattern: string): string {
  return pattern.replace(/^([a-z]+:\/\/[^/:]+):\d+\//, '$1/');
}

/**
 * fakeBrowser doesn't implement `permissions`. This fake grants like Chrome:
 * a pattern is covered by itself, by the same host without a port, or by
 * `<all_urls>`. Starts with the manifest's native provider hosts.
 */
export function fakePermissions(granted: string[] = NATIVE_HOSTS): FakePermissions {
  type Listener = () => void;
  const added = new Set<Listener>();
  const removed = new Set<Listener>();
  const state: FakePermissions = {
    granted: new Set(granted),
    requests: [],
    answer: 'grant',
    grant(pattern) {
      state.granted.add(pattern);
      for (const l of added) l();
    },
    revoke(pattern) {
      state.granted.delete(pattern);
      for (const l of removed) l();
    },
  };
  const covered = (pattern: string) =>
    state.granted.has('<all_urls>') ||
    state.granted.has(pattern) ||
    state.granted.has(withoutPort(pattern));
  const p = fakeBrowser.permissions;
  vi.spyOn(p, 'contains').mockImplementation(({ origins = [] }) =>
    Promise.resolve(origins.every(covered)),
  );
  vi.spyOn(p, 'request').mockImplementation(({ origins = [] }) => {
    state.requests.push(origins);
    if (state.answer === 'throw') return Promise.reject(new Error('Not allowed'));
    if (state.answer === 'decline') return Promise.resolve(false);
    for (const o of origins) state.granted.add(o);
    return Promise.resolve(true);
  });
  vi.spyOn(p.onAdded, 'addListener').mockImplementation((l) => {
    added.add(l as Listener);
  });
  vi.spyOn(p.onAdded, 'removeListener').mockImplementation((l) => {
    added.delete(l as Listener);
  });
  vi.spyOn(p.onRemoved, 'addListener').mockImplementation((l) => {
    removed.add(l as Listener);
  });
  vi.spyOn(p.onRemoved, 'removeListener').mockImplementation((l) => {
    removed.delete(l as Listener);
  });
  return state;
}
