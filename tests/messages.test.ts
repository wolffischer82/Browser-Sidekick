import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  broadcast,
  broadcastWhenHeard,
  isPinOutcome,
  isSidekickMessage,
  sendToBackground,
  type SidekickMessage,
} from '@/shared/messages';

// Spec 6 "Messaging": one typed union with a runtime guard on every receiver.

afterEach(() => {
  fakeBrowser.reset();
});

describe('isSidekickMessage', () => {
  const valid: SidekickMessage[] = [
    { type: 'pin-tab', sessionId: 's1', tabId: 3 },
    { type: 'refresh-pin', pinId: 'p1' },
    { type: 'pins-changed', sessionId: 's1' },
    { type: 'already-pinned', sessionId: 's1', pinId: 'p1' },
    { type: 'messages-changed', sessionId: 's1' },
    { type: 'title-changed', sessionId: 's1' },
    { type: 'pdf-extract', url: 'https://example.com/a.pdf', requirePdfType: false },
  ];

  it.each(valid)('accepts $type', (message) => {
    expect(isSidekickMessage(message)).toBe(true);
  });

  it.each([
    null,
    undefined,
    'pin-tab',
    42,
    {},
    { type: 'unknown' },
    { type: 'pin-tab', sessionId: 's1' },
    { type: 'pin-tab', sessionId: 's1', tabId: '3' },
    { type: 'pin-tab', sessionId: 1, tabId: 3 },
    { type: 'pin-tab', sessionId: 's1', tabId: Number.NaN },
    { type: 'refresh-pin' },
    { type: 'refresh-pin', pinId: 5 },
    { type: 'pins-changed' },
    { type: 'already-pinned', sessionId: 's1' },
    { type: 'messages-changed' },
    { type: 'messages-changed', sessionId: '' },
    { type: 'title-changed', sessionId: 3 },
    { type: 'pdf-extract', url: 'https://example.com/a.pdf' },
    { type: 'pdf-extract', url: 'file:///a.pdf', requirePdfType: false },
    { type: 'pdf-extract', url: 7, requirePdfType: true },
  ])('rejects %j', (value) => {
    expect(isSidekickMessage(value)).toBe(false);
  });
});

describe('isPinOutcome', () => {
  it.each([
    { status: 'pinned', pinId: 'p1' },
    { status: 'duplicate', pinId: 'p1' },
    { status: 'refreshing', pinId: 'p1' },
    { status: 'refused', reason: 'restricted' },
    { status: 'refused', reason: 'no-access' },
    { status: 'refused', reason: 'not-open' },
    { status: 'refused', reason: 'not-found' },
  ])('accepts %j', (value) => {
    expect(isPinOutcome(value)).toBe(true);
  });

  it.each([
    undefined,
    {},
    { status: 'pinned' },
    { status: 'refused', reason: 'other' },
    { status: 'ok', pinId: 'p1' },
  ])('rejects %j', (value) => {
    expect(isPinOutcome(value)).toBe(false);
  });
});

describe('broadcast', () => {
  it('sends the message and ignores a missing receiver', async () => {
    const send = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockRejectedValue(
        new Error('Could not establish connection. Receiving end does not exist.'),
      );
    await expect(broadcast({ type: 'pins-changed', sessionId: 's1' })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({ type: 'pins-changed', sessionId: 's1' });
  });
});

describe('sendToBackground', () => {
  it('returns a valid outcome', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({
      status: 'pinned',
      pinId: 'p1',
    });
    await expect(sendToBackground({ type: 'refresh-pin', pinId: 'p1' })).resolves.toEqual({
      status: 'pinned',
      pinId: 'p1',
    });
  });

  it('rejects an invalid reply', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ status: 'weird' });
    await expect(sendToBackground({ type: 'refresh-pin', pinId: 'p1' })).rejects.toThrow();
  });

  it('rejects when the background is unreachable', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValue(new Error('No receiver'));
    await expect(
      sendToBackground({ type: 'pin-tab', sessionId: 's1', tabId: 1 }),
    ).rejects.toThrow();
  });
});

describe('broadcastWhenHeard', () => {
  const message = { type: 'already-pinned', sessionId: 's1', pinId: 'p1' } as const;

  it('tries again until a page listens', async () => {
    const send = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
      .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
      .mockResolvedValue(undefined);
    expect(await broadcastWhenHeard(message, { delayMs: 1 })).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith(message);
  });

  it('gives up quietly when no page ever listens', async () => {
    const send = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockRejectedValue(new Error('Receiving end does not exist.'));
    expect(await broadcastWhenHeard(message, { tries: 3, delayMs: 1 })).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
