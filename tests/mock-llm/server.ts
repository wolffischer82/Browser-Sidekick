import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local OpenAI-compatible server for tests (spec 9 "Browser automation").
 * Nothing ever calls a real provider: component tests, adapter integration
 * tests and the Playwright suite point an OpenAI-compatible provider at this
 * server instead.
 *
 * - `GET /v1/models` lists `models`.
 * - `POST /v1/chat/completions` streams the next scripted reply as SSE, or
 *   `reply` split into small chunks when nothing is scripted.
 * - With `apiKey` set, both endpoints answer 401 unless the request carries
 *   `Authorization: Bearer <apiKey>`.
 * - `script()` queues replies for the next completion requests: a streamed
 *   answer with optional per-chunk delay, or an error with any status and body.
 * - Every request is recorded in `requests` (method, path, headers, parsed
 *   body). Nothing is printed.
 * - CORS is open (`*`), so it also answers extension pages without host access.
 */

export type ScriptedReply =
  | {
      kind: 'stream';
      chunks: string[];
      delayMs?: number;
      /** Leave the stream open. */ hang?: boolean;
    }
  | { kind: 'error'; status: number; body: unknown };

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MockLlmOptions {
  /** Port to listen on; `0` (default) picks a free one. */
  port?: number;
  /** Required bearer key; unset accepts any request (like a local server). */
  apiKey?: string;
  /** Model ids returned by `/v1/models`. */
  models?: string[];
  /** Default streamed answer. */
  reply?: string;
}

export interface MockLlm {
  /** Base URL including the version path, e.g. `http://127.0.0.1:4321/v1`. */
  baseUrl: string;
  origin: string;
  port: number;
  requests: RecordedRequest[];
  /** Queues replies for the next completion requests, in order. */
  script(...replies: ScriptedReply[]): void;
  /** Changes the required key (`undefined` accepts any). */
  setApiKey(key: string | undefined): void;
  /** Changes the model list; `null` makes `/v1/models` answer 404. */
  setModels(models: string[] | null): void;
  /** Clears the request log and the script. */
  reset(): void;
  close(): Promise<void>;
}

export const MOCK_MODELS = ['mock-large', 'mock-small'];
export const MOCK_REPLY = 'Mock answer from the local test server.';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function openAiError(message: string, type: string, code: string | null): unknown {
  return { error: { message, type, param: null, code } };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Splits text into chunks of a few characters, like a streamed answer. */
export function chunkText(text: string, size = 6): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startMockLlm(options: MockLlmOptions = {}): Promise<MockLlm> {
  let apiKey = options.apiKey;
  let models: string[] | null = options.models ?? MOCK_MODELS;
  const reply = options.reply ?? MOCK_REPLY;
  const queue: ScriptedReply[] = [];
  const requests: RecordedRequest[] = [];
  const open = new Set<ServerResponse>();

  async function stream(
    res: ServerResponse,
    scripted: ScriptedReply & { kind: 'stream' },
    model: string,
  ) {
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    open.add(res);
    res.on('close', () => open.delete(res));
    const created = Math.floor(Date.now() / 1000);
    const event = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.write(event({ role: 'assistant', content: '' }, null));
    for (const chunk of scripted.chunks) {
      if (res.destroyed) return;
      if (scripted.delayMs) await sleep(scripted.delayMs);
      res.write(event({ content: chunk }, null));
    }
    if (scripted.hang) return;
    res.write(event({}, 'stop'));
    res.end('data: [DONE]\n\n');
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    const body = await readBody(req);
    requests.push({ method: req.method ?? '', path, headers: { ...req.headers }, body });

    if (apiKey !== undefined && req.headers.authorization !== `Bearer ${apiKey}`) {
      sendJson(
        res,
        401,
        openAiError('Incorrect API key provided.', 'invalid_request_error', 'invalid_api_key'),
      );
      return;
    }

    if (req.method === 'GET' && path === '/v1/models') {
      if (!models) {
        sendJson(res, 404, openAiError('Not found.', 'invalid_request_error', null));
        return;
      }
      sendJson(res, 200, {
        object: 'list',
        data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'mock' })),
      });
      return;
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const model =
        typeof body === 'object' &&
        body !== null &&
        'model' in body &&
        typeof body.model === 'string'
          ? body.model
          : '';
      const scripted = queue.shift() ?? { kind: 'stream', chunks: chunkText(reply) };
      if (scripted.kind === 'error') {
        sendJson(res, scripted.status, scripted.body);
        return;
      }
      if (models && !models.includes(model)) {
        sendJson(
          res,
          404,
          openAiError(
            `The model '${model}' does not exist.`,
            'invalid_request_error',
            'model_not_found',
          ),
        );
        return;
      }
      await stream(res, scripted, model);
      return;
    }

    sendJson(res, 404, openAiError('Not found.', 'invalid_request_error', null));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, openAiError('Mock failure.', 'server_error', null));
      else res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;

  return {
    baseUrl: `${origin}/v1`,
    origin,
    port,
    requests,
    script: (...replies) => {
      queue.push(...replies);
    },
    setApiKey: (key) => {
      apiKey = key;
    },
    setModels: (list) => {
      models = list;
    },
    reset: () => {
      requests.length = 0;
      queue.length = 0;
    },
    close: async () => {
      for (const res of open) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
