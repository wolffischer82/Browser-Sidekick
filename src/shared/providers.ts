import type { MessageKey } from './i18n';
import { DEFAULT_BASE_URLS } from './llm';
import {
  DEFAULT_CONTEXT_BUDGET,
  type ProviderConfig,
  type ProviderKind,
  type Session,
} from './model';

/**
 * Provider rules for the settings view and the header model dropdown
 * (spec 5.7, D15). Pure functions; browser permission calls live in
 * `provider-access.ts`.
 */

export const MIN_CONTEXT_BUDGET = 1_000;
export const MAX_CONTEXT_BUDGET = 10_000_000;

/**
 * The host permission pattern for a base URL: `scheme://host[:port]/*`, or
 * `null` if it isn't an http(s) URL. Firefox match patterns can't carry a
 * port (MDN "Match patterns"), so Firefox asks for the host on every port;
 * Chrome asks for the exact origin (decisions.md T05).
 */
export function originPattern(baseUrl: string, options: { includePort: boolean }): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = options.includePort ? url.host : url.hostname;
  return `${url.protocol}//${host}/*`;
}

/**
 * The host a provider's requests go to. Anthropic and Gemini always call
 * their own host (decisions.md T04-5), whatever is stored as base URL.
 */
export function providerOriginPattern(
  provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>,
  includePort: boolean,
): string | null {
  const baseUrl =
    provider.kind === 'openai-compatible' ? provider.baseUrl : DEFAULT_BASE_URLS[provider.kind];
  return originPattern(baseUrl, { includePort });
}

/** `••••last4` (spec 5.7). Keys shorter than 8 characters show no characters at all. */
export function maskKey(key: string): string {
  if (!key) return '';
  return key.length >= 8 ? `••••${key.slice(-4)}` : '••••';
}

/** A provider can be default or chosen for a session only with host access (spec 5.7). */
export function isUsable(provider: ProviderConfig): boolean {
  return provider.hasAccess;
}

/**
 * Keeps exactly one usable default while any usable provider exists: a
 * missing or unusable default is replaced by the first usable provider.
 */
export function normaliseDefault(
  providers: ProviderConfig[],
  defaultId: string | null,
): string | null {
  const current = providers.find((p) => p.id === defaultId);
  if (current && isUsable(current)) return current.id;
  return providers.find(isUsable)?.id ?? null;
}

export interface ModelGroup {
  providerId: string;
  label: string;
  models: string[];
}

/**
 * The header dropdown's entries (spec 5.7 "Session model"): per usable
 * provider its cached models, or only its default model if listing isn't
 * supported. The default model is always listed.
 */
export function modelGroups(providers: ProviderConfig[]): ModelGroup[] {
  return providers.filter(isUsable).map((p) => {
    const cached = p.cachedModels ?? [];
    const models = cached.includes(p.defaultModel) ? cached : [p.defaultModel, ...cached];
    return { providerId: p.id, label: p.label, models };
  });
}

export interface SessionModel {
  providerId: string | null;
  model: string | null;
  /**
   * `deleted`: the session's provider was deleted and it moved to the
   * default (shown with a notice). `unset`: the session had no provider
   * and gets the default silently.
   */
  change: 'none' | 'deleted' | 'unset';
}

/** The provider and model a session should use now (spec 5.7, D15). */
export function resolveSessionModel(
  session: Pick<Session, 'providerId' | 'model'>,
  providers: ProviderConfig[],
  defaultId: string | null,
): SessionModel {
  const fallback = providers.find((p) => p.id === defaultId && isUsable(p));
  const own = providers.find((p) => p.id === session.providerId);
  if (own) {
    if (session.model) return { providerId: own.id, model: session.model, change: 'none' };
    return { providerId: own.id, model: own.defaultModel, change: 'unset' };
  }
  if (session.providerId !== null) {
    return fallback
      ? { providerId: fallback.id, model: fallback.defaultModel, change: 'deleted' }
      : { providerId: null, model: null, change: 'deleted' };
  }
  return fallback
    ? { providerId: fallback.id, model: fallback.defaultModel, change: 'unset' }
    : { providerId: null, model: null, change: 'none' };
}

/** The provider form's values, as typed. `apiKey` is a newly typed key only. */
export interface ProviderDraft {
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  contextBudget: string;
}

export type DraftField = 'label' | 'baseUrl' | 'apiKey' | 'defaultModel' | 'contextBudget';
export type DraftErrors = Partial<Record<DraftField, MessageKey>>;

/** A new provider's form, prefilled for its kind (spec 5.7). */
export function emptyDraft(kind: ProviderKind, label: string): ProviderDraft {
  return {
    kind,
    label,
    baseUrl: DEFAULT_BASE_URLS[kind],
    apiKey: '',
    defaultModel: '',
    contextBudget: String(DEFAULT_CONTEXT_BUDGET),
  };
}

/** Parses the budget field; `null` unless it is a whole number in range. */
export function parseBudget(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const budget = Number(value.trim());
  return budget >= MIN_CONTEXT_BUDGET && budget <= MAX_CONTEXT_BUDGET ? budget : null;
}

/** Field errors as message keys; empty when the draft can be saved. */
export function validateDraft(
  draft: ProviderDraft,
  options: { hasStoredKey: boolean },
): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.label.trim()) errors.label = 'errorLabelRequired';
  if (
    draft.kind === 'openai-compatible' &&
    originPattern(draft.baseUrl, { includePort: true }) === null
  ) {
    errors.baseUrl = 'errorBaseUrl';
  }
  if (draft.kind !== 'openai-compatible' && !draft.apiKey.trim() && !options.hasStoredKey) {
    errors.apiKey = 'errorKeyRequired';
  }
  if (!draft.defaultModel.trim()) errors.defaultModel = 'errorModelRequired';
  if (parseBudget(draft.contextBudget) === null) errors.contextBudget = 'errorBudget';
  return errors;
}
