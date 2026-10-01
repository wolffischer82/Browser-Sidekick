import type { Repository } from '../db/repository';
import { LlmError, type LlmProvider, type LlmRequest } from '../llm/types';
import type { Message } from '../model';

/**
 * The LLM session title (D11, spec 5.6). After the first answer completes,
 * one request to the session's model carries the first question and the
 * first 2,000 characters of the answer. The title is stored as `llm` through
 * the repository's guard, which refuses it once the user has renamed the
 * session, also when the rename lands while the request runs. On failure the
 * fallback title stays and nothing is shown or logged.
 */

export const TITLE_ANSWER_CHARS = 2_000;
const MAX_WORDS = 6;
const MAX_CHARS = 80;
/** A title reply longer than this is cut off; the rest isn't needed. */
const MAX_REPLY_CHARS = 300;

const SYSTEM =
  'Write a title for the conversation below. Reply with the title only: at most 6 words, in the language of the conversation, without quotes or a full stop.';

export function titleRequest(model: string, question: string, answer: string): LlmRequest {
  return {
    model,
    system: SYSTEM,
    turns: [
      {
        role: 'user',
        content: `Question:\n${question}\n\nAnswer:\n${answer.slice(0, TITLE_ANSWER_CHARS)}`,
      },
    ],
  };
}

/** The title from a reply: first line, no Markdown, label, quotes or end punctuation. */
export function cleanTitle(raw: string): string | null {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (!line) return null;
  const words = line
    .replace(/^#+\s*/, '')
    .replace(/^(title|titel)\s*:\s*/i, '')
    .replace(/[*_`]/g, '')
    .replace(/^["'“”„«»‚‘’]+|["'“”„«»‚‘’]+$/g, '')
    .replace(/[.:;,!?。]+$/u, '')
    .replace(/^["'“”„«»‚‘’]+|["'“”„«»‚‘’]+$/g, '')
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, MAX_WORDS);
  const title = words.join(' ').slice(0, MAX_CHARS).trim();
  return /[\p{L}\p{N}]/u.test(title) ? title : null;
}

/** Whether no earlier answer of the session completed (a stopped or failed one doesn't count). */
export function isFirstAnswer(earlier: readonly Message[]): boolean {
  return !earlier.some((m) => m.role === 'assistant' && !m.stopped && !m.error && m.text !== '');
}

export interface TitleInput {
  repo: Repository;
  provider: LlmProvider;
  sessionId: string;
  model: string;
  question: string;
  answer: string;
}

/** Requests and stores the title. Resolves whether it was applied; never rejects. */
export async function generateSessionTitle(input: TitleInput): Promise<boolean> {
  try {
    const session = await input.repo.getSession(input.sessionId);
    if (!session || session.titleSource === 'user') return false;
    const controller = new AbortController();
    let reply = '';
    try {
      const request = titleRequest(input.model, input.question, input.answer);
      for await (const delta of input.provider.stream(request, controller.signal)) {
        reply += delta;
        if (reply.length > MAX_REPLY_CHARS) {
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof LlmError && error.code === 'aborted' && reply !== '')) return false;
    }
    const title = cleanTitle(reply);
    if (!title) return false;
    return await input.repo.setSessionTitle(input.sessionId, title, 'llm');
  } catch {
    return false;
  }
}
