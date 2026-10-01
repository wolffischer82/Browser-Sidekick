import { describe, expect, it } from 'vitest';
import { readSseEvents, type SseEvent } from '../src/shared/llm/sse';

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(
  chunks: (string | Uint8Array)[],
  options?: { bareJsonLines?: boolean },
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSseEvents(streamOf(chunks), options)) events.push(event);
  return events;
}

describe('readSseEvents', () => {
  it('parses named and unnamed events', async () => {
    expect(await collect(['event: ping\ndata: {"a":1}\n\ndata: two\n\n'])).toEqual([
      { event: 'ping', data: '{"a":1}' },
      { event: 'message', data: 'two' },
    ]);
  });

  it('joins multi-line data with newlines', async () => {
    expect(await collect(['data: a\ndata: b\n\n'])).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('handles chunks split mid-line, mid-field and mid-event', async () => {
    const text = 'event: x\ndata: {"t":"hello"}\n\ndata: {"t":"world"}\n\n';
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      expect(await collect(chunks)).toEqual([
        { event: 'x', data: '{"t":"hello"}' },
        { event: 'message', data: '{"t":"world"}' },
      ]);
    }
  });

  it('decodes a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: Grüße €\n\n');
    const events = await collect([bytes.slice(0, 9), bytes.slice(9, 15), bytes.slice(15)]);
    expect(events).toEqual([{ event: 'message', data: 'Grüße €' }]);
  });

  it('accepts CRLF, CR and LF line endings, including CRLF split across chunks', async () => {
    expect(await collect(['data: a\r\n\r\ndata: b\r\rdata: c\n\n'])).toHaveLength(3);
    expect(await collect(['data: a\r', '\n\r', '\ndata: b\r\n\r\n'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ]);
  });

  it('ignores comments, unknown fields and empty events', async () => {
    const events = await collect([
      ': OPENROUTER PROCESSING\n\nid: 7\nretry: 100\nfoo: bar\ndata: x\n\n\n\nevent: only\n\n',
    ]);
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('strips only one space after the colon and accepts none', async () => {
    expect(await collect(['data:x\n\ndata:  y\n\n'])).toEqual([
      { event: 'message', data: 'x' },
      { event: 'message', data: ' y' },
    ]);
  });

  it('dispatches a final event without a trailing blank line', async () => {
    expect(await collect(['data: a\n\ndata: b'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ]);
  });

  it('treats bare JSON lines as data events only when asked', async () => {
    const chunks = ['{"a":1}\n{"b":2}\n'];
    expect(await collect(chunks, { bareJsonLines: true })).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '{"b":2}' },
    ]);
    expect(await collect(chunks)).toEqual([]);
  });
});
