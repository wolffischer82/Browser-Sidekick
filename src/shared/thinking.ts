import type { LlmRequest } from './llm';
import type { ModelInfo, ProviderConfig, Session, ThinkingLevel } from './model';

/**
 * The rules behind the composer's thinking control (specs/thinking-levels.md
 * 4.1, 4.2, 5). Pure functions: the control and the ask flow both use them,
 * so what is shown and what is sent can't drift apart.
 */

/** The control's options in order; `null` is Default. */
export const THINKING_OPTIONS: readonly (ThinkingLevel | null)[] = [null, 'low', 'medium', 'high'];

const LEVELS: readonly unknown[] = ['low', 'medium', 'high'];

/** The session's level; a missing field, `null` or anything unreadable is Default. */
export function sessionThinkingLevel(
  session: Pick<Session, 'thinkingLevel'>,
): ThinkingLevel | null {
  const level: unknown = session.thinkingLevel;
  return LEVELS.includes(level) ? (level as ThinkingLevel) : null;
}

/**
 * What the provider's model list said about `model`, or `undefined` when its
 * support is unknown: no entry (a typed model id, a list that says nothing,
 * a provider cached before the feature) or an unreadable one. Own keys only,
 * so a model id such as `constructor` finds nothing (decisions.md T13-3).
 */
export function modelInfoFor(
  provider: Pick<ProviderConfig, 'modelInfo'> | undefined,
  model: string | null,
): ModelInfo | undefined {
  const all = provider?.modelInfo;
  if (!all || !model || !Object.hasOwn(all, model)) return undefined;
  const info: unknown = all[model];
  if (typeof info !== 'object' || info === null) return undefined;
  const thinking = (info as { thinking?: unknown }).thinking;
  return thinking === 'supported' || thinking === 'unsupported' ? (info as ModelInfo) : undefined;
}

/**
 * Whether the control shows (spec 4.1, owner decision O2): the session has a
 * provider and a model, and the model isn't known not to support thinking.
 */
export function showsThinkingControl(
  provider: Pick<ProviderConfig, 'modelInfo'> | undefined,
  model: string | null,
): boolean {
  if (!provider || !model) return false;
  return modelInfoFor(provider, model)?.thinking !== 'unsupported';
}

/**
 * The thinking information of an Ask or Summarize request. It is always
 * there, also at Default, so the adapters can ask a model known to think
 * for its reasoning (spec 4.3). While the control is hidden no level is
 * sent; the stored one is kept for a model that shows the control again.
 */
export function requestThinking(
  session: Pick<Session, 'thinkingLevel'>,
  provider: Pick<ProviderConfig, 'modelInfo'>,
  model: string,
): NonNullable<LlmRequest['thinking']> {
  return {
    level: showsThinkingControl(provider, model) ? sessionThinkingLevel(session) : null,
    info: modelInfoFor(provider, model),
  };
}
