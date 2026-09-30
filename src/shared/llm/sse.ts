/**
 * Server-sent events parser for streamed LLM replies, following the WHATWG
 * event-stream format: `event` and `data` fields, comments, and CRLF, CR or
 * LF line endings. Chunks may split lines, fields and UTF-8 characters.
 *
 * Leniency for OpenAI-compatible servers (decisions.md T04): a final event
 * without the closing blank line is still dispatched, and with
 * `bareJsonLines` a line starting with `{` is treated as one data event.
 */

export interface SseEvent {
  /** The `event` field, or `message` when absent. */
  event: string;
  data: string;
}

export interface SseOptions {
  bareJsonLines?: boolean;
}

function present(event: SseEvent | null): SseEvent[] {
  return event ? [event] : [];
}

export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  options: SseOptions = {},
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let data: string[] = [];
  let done = false;

  const dispatch = (): SseEvent | null => {
    const event = data.length > 0 ? { event: eventName || 'message', data: data.join('\n') } : null;
    eventName = '';
    data = [];
    return event;
  };

  /** Processes one line; returns the events it completes. */
  const processLine = (line: string): SseEvent[] => {
    if (line === '') return present(dispatch());
    if (line.startsWith(':')) return [];
    if (options.bareJsonLines && line.startsWith('{')) {
      // A lone JSON line is its own event; flush anything pending first.
      const pending = dispatch();
      data = [line];
      return [...present(pending), ...present(dispatch())];
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') data.push(value);
    // `id`, `retry` and unknown fields are ignored.
    return [];
  };

  try {
    while (!done) {
      const result = await reader.read();
      if (result.done) {
        done = true;
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(result.value, { stream: true });
      }

      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        // A trailing CR may be the first half of a CRLF split across chunks.
        if (match[0] === '\r' && match.index === buffer.length - 1 && !done) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        yield* processLine(line);
      }
    }
    if (buffer !== '') {
      const line = buffer;
      buffer = '';
      yield* processLine(line);
    }
    const last = dispatch();
    if (last) yield last;
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
