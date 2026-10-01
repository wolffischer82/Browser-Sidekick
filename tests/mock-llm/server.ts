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
 * - A scripted stream with `reasoning` sends those chunks as reasoning deltas
 *   before the answer, in `delta.reasoning_content` or, with
 *   `reasoningField: 'reasoning'`, in `delta.reasoning`. Nothing else makes
 *   the server send reasoning, so every other reply is the plain answer.
 * - A scripted stream with `holdAt` stops before the chunks with those
 *   numbers (reasoning chunks first, then answer chunks, from 0) until the
 *   test calls `release()`, so a test can look at a half-streamed answer
 *   without timing.
 * - A model-list entry may be an object with `supported_parameters`, as
 *   OpenRouter lists them; a plain id is listed without the field.
 * - A completion request for `MOCK_REJECTING_MODEL` that carries a
 *   `reasoning_effort` is answered 400 with a message naming the parameter,
 *   without using up a scripted reply. Without the field the model answers
 *   like any other.
 * - Every request is recorded in `requests` (method, path, headers, parsed
 *   body), and the `reasoning_effort` of every completion request in
 *   `reasoningEfforts`. Nothing is printed.
 * - CORS is open (`*`), so it also answers extension pages without host access.
 */

export type ScriptedReply =
  | {
      kind: 'stream';
      chunks: string[];
      delayMs?: number;
      /** Reasoning deltas sent before `chunks`; none when left out. */
      reasoning?: string[];
      /** The delta field that carries `reasoning`; default `reasoning_content`. */
      reasoningField?: 'reasoning_content' | 'reasoning';
      /**
       * Wait for `release()` before sending the chunks with these numbers,
       * counting the `reasoning` chunks first and then `chunks`, from 0.
       */
      holdAt?: number[];
      /** Leave the stream open. */ hang?: boolean;
    }
  | { kind: 'error'; status: number; body: unknown };

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** A model-list entry: an id, or an id with the parameters the model takes. */
export type MockModel = string | { id: string; supported_parameters: string[] };

export interface MockLlmOptions {
  /** Port to listen on; `0` (default) picks a free one. */
  port?: number;
  /** Required bearer key; unset accepts any request (like a local server). */
  apiKey?: string;
  /** Models returned by `/v1/models`. */
  models?: MockModel[];
  /** Default streamed answer. */
  reply?: string;
}

export interface MockLlm {
  /** Base URL including the version path, e.g. `http://127.0.0.1:4321/v1`. */
  baseUrl: string;
  origin: string;
  port: number;
  requests: RecordedRequest[];
  /**
   * The `reasoning_effort` of each completion request, in order; `undefined`
   * for a request that didn't carry the field.
   */
  reasoningEfforts: unknown[];
  /** Queues replies for the next completion requests, in order. */
  script(...replies: ScriptedReply[]): void;
  /** Lets every stream that waits at a `holdAt` continue to its next hold. */
  release(): void;
  /** Changes the required key (`undefined` accepts any). */
  setApiKey(key: string | undefined): void;
  /** Changes the model list; `null` makes `/v1/models` answer 404. */
  setModels(models: MockModel[] | null): void;
  /** Clears the request log, the recorded efforts and the script. */
  reset(): void;
  close(): Promise<void>;
}

export const MOCK_MODELS = ['mock-large', 'mock-small'];
export const MOCK_REPLY = 'Mock answer from the local test server.';

/** The model that refuses a `reasoning_effort` with a 400 (decisions.md T15). */
export const MOCK_REJECTING_MODEL = 'mock-no-effort';
export const MOCK_REJECTION = "Unsupported parameter: 'reasoning_effort' is not supported here.";

/**
 * A model list for the thinking-level flows: one model whose list entry says
 * it takes a reasoning level, one whose entry says it doesn't, the rejecting
 * model and a plain one, both without `supported_parameters` (unknown).
 */
export const MOCK_THINKING_MODEL = 'mock-thinking';
export const MOCK_PLAIN_MODEL = 'mock-plain';
export const MOCK_THINKING_MODELS: MockModel[] = [
  'mock-large',
  { id: MOCK_THINKING_MODEL, supported_parameters: ['max_tokens', 'reasoning', 'temperature'] },
  { id: MOCK_PLAIN_MODEL, supported_parameters: ['max_tokens', 'temperature'] },
  MOCK_REJECTING_MODEL,
];

const idOf = (model: MockModel) => (typeof model === 'string' ? model : model.id);

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
  let models: MockModel[] | null = options.models ?? MOCK_MODELS;
  const reply = options.reply ?? MOCK_REPLY;
  const queue: ScriptedReply[] = [];
  const requests: RecordedRequest[] = [];
  const reasoningEfforts: unknown[] = [];
  const open = new Set<ServerResponse>();
  /** Streams waiting at a `holdAt`, each with what lets it continue. */
  const held = new Set<() => void>();

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
    const field = scripted.reasoningField ?? 'reasoning_content';
    const deltas = [
      ...(scripted.reasoning ?? []).map((chunk) => ({ [field]: chunk })),
      ...scripted.chunks.map((chunk) => ({ content: chunk })),
    ];
    for (const [index, delta] of deltas.entries()) {
      if (scripted.holdAt?.includes(index)) {
        await new Promise<void>((resolve) => {
          const go = () => {
            held.delete(go);
            resolve();
          };
          held.add(go);
          res.on('close', go);
        });
      }
      if (res.destroyed) return;
      if (scripted.delayMs) await sleep(scripted.delayMs);
      res.write(event(delta, null));
    }
    if (scripted.hang || res.destroyed) return;
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
    const isChat = req.method === 'POST' && path === '/v1/chat/completions';
    const effort =
      typeof body === 'object' && body !== null && 'reasoning_effort' in body
        ? body.reasoning_effort
        : undefined;
    if (isChat) reasoningEfforts.push(effort);

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
        data: models.map((model) => ({
          id: idOf(model),
          object: 'model',
          created: 0,
          owned_by: 'mock',
          ...(typeof model === 'string'
            ? {}
            : { supported_parameters: model.supported_parameters }),
        })),
      });
      return;
    }

    if (isChat) {
      const model =
        typeof body === 'object' &&
        body !== null &&
        'model' in body &&
        typeof body.model === 'string'
          ? body.model
          : '';
      if (model === MOCK_REJECTING_MODEL && effort !== undefined) {
        sendJson(res, 400, {
          error: {
            message: MOCK_REJECTION,
            type: 'invalid_request_error',
            param: 'reasoning_effort',
            code: 'unsupported_parameter',
          },
        });
        return;
      }
      const scripted = queue.shift() ?? { kind: 'stream', chunks: chunkText(reply) };
      if (scripted.kind === 'error') {
        sendJson(res, scripted.status, scripted.body);
        return;
      }
      if (models && !models.some((m) => idOf(m) === model)) {
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
    reasoningEfforts,
    script: (...replies) => {
      queue.push(...replies);
    },
    release: () => {
      for (const go of [...held]) go();
    },
    setApiKey: (key) => {
      apiKey = key;
    },
    setModels: (list) => {
      models = list;
    },
    reset: () => {
      requests.length = 0;
      reasoningEfforts.length = 0;
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
