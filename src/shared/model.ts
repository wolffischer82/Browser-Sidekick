/**
 * Data model (spec 5.4-5.7, 6 "Storage", D9-D16).
 *
 * Sessions, pins and messages live in IndexedDB (`src/shared/db/`).
 * Settings, including providers and their API keys, live in `storage.local`
 * (`src/shared/settings.ts`). Timestamps are milliseconds since the epoch.
 */

import type { LlmErrorCode } from './llm/types';

/** Where the session title came from (D11). A `user` title is never overwritten. */
export type TitleSource = 'fallback' | 'llm' | 'user';

export interface Session {
  id: string;
  /**
   * The displayed title. With `titleSource: 'fallback'` an empty string means
   * the UI shows the localised "New session".
   */
  title: string;
  titleSource: TitleSource;
  /** The session's provider (D15); `null` when no provider is configured. */
  providerId: string | null;
  /** The session's model (D15); `null` when no provider is configured. */
  model: string | null;
  createdAt: number;
  /** Last activity; bumped whenever a pin or message is added. */
  updatedAt: number;
}

/** Extractor kind, shown as the Page / YouTube / PDF badge (spec 5.2, 5.5). */
export type PinKind = 'page' | 'youtube' | 'pdf';

export type PinStatus = 'extracting' | 'ready' | 'failed';

/** A pinned page with the snapshot of its extracted content (D3, spec 5.5). */
export interface Pin {
  id: string;
  sessionId: string;
  /** Pin order within the session; defines citation numbers (spec 5.2). */
  position: number;
  url: string;
  title: string;
  faviconUrl: string | null;
  kind: PinKind;
  /** Extracted text, capped at 200,000 characters (spec 5.5). */
  text: string;
  /** Length of `text` as stored. */
  charCount: number;
  /** True when the extracted text was cut at the cap. */
  truncated: boolean;
  status: PinStatus;
  /** When the snapshot was taken; `null` until extraction has finished. */
  extractedAt: number | null;
  /** Failure reason code set by the extractor when `status` is `failed`. */
  failureReason: string | null;
  createdAt: number;
}

export type MessageRole = 'user' | 'assistant';

/** A user message is a typed question or the fixed Summarize request (spec 5.6). */
export type MessageKind = 'ask' | 'summarize';

/** One page a message was sent with; `index` is its citation number `[n]` (D13). */
export interface MessageSource {
  index: number;
  title: string;
  url: string;
  /** Whether the page was a pin or the unpinned current tab. */
  origin: 'pin' | 'currentTab';
}

export interface Message {
  id: string;
  sessionId: string;
  /** Order within the session. */
  position: number;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  createdAt: number;
  /** Label of the provider that produced an answer (D15); `null` for user messages. */
  providerLabel: string | null;
  /** Model that produced an answer (D15); `null` for user messages. */
  model: string | null;
  /** Sources the request carried; kept so citations survive unpinning (spec 5.6). */
  sources: MessageSource[];
  /** The answer was stopped by the user and is partial (spec 5.6). */
  stopped: boolean;
  /** Pages or history were trimmed to fit the context budget (spec 5.6). */
  trimmed: boolean;
  /**
   * Why the answer failed: an `LlmError` code, never the provider's text.
   * `null` for a question and for an answer that didn't fail; missing in
   * records written before the field existed, which means the same
   * (owner decision 2026-10-01, decisions.md T10). `text` is what had
   * arrived before the failure. A successful Retry clears it.
   */
  error?: LlmErrorCode | null;
}

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini';

/**
 * A session's thinking level (specs/thinking-levels.md 4.1). "Default" is
 * the absence of a level: nothing is sent and the model decides.
 */
export type ThinkingLevel = 'low' | 'medium' | 'high';

/**
 * What a provider's model list says about one model (specs/thinking-levels.md
 * 4.2, 5). A model without an entry is unknown: its support can't be told.
 */
export interface ModelInfo {
  thinking: 'supported' | 'unsupported';
  /** Anthropic only: how a supported model takes its level. */
  thinkingMode?: 'effort' | 'budget';
  /** Anthropic only: the model's output cap in tokens. */
  maxOutputTokens?: number;
}

/** A saved LLM provider (spec 5.7). Stored in `storage.local` only (D5). */
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  /** The API key; may be empty for OpenAI-compatible local servers. */
  apiKey: string;
  defaultModel: string;
  /** Context budget in tokens (spec 5.6); default `DEFAULT_CONTEXT_BUDGET`. */
  contextBudget: number;
  /** Models from the provider's list endpoint; `null` if listing failed or is unsupported. */
  cachedModels: string[] | null;
  /**
   * Per-model info from the same list, keyed by model id. Written wherever
   * `cachedModels` is written and cleared with it; a missing field or key
   * means unknown (specs/thinking-levels.md 5).
   */
  modelInfo?: Record<string, ModelInfo>;
  /**
   * False when the host permission for a custom origin was declined: the
   * provider is saved but can't be default or chosen for a session (spec 5.7).
   */
  hasAccess: boolean;
}

export const DEFAULT_CONTEXT_BUDGET = 100_000;

/** Everything kept in `storage.local` (spec 6 "Storage"). */
export interface Settings {
  providers: ProviderConfig[];
  defaultProviderId: string | null;
  activeSessionId: string | null;
  /** Whether the Session tabs section is expanded (spec 5.2). */
  sessionTabsExpanded: boolean;
  /** Whether the all-sites access banner was dismissed (spec 5.3). */
  accessBannerDismissed: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  providers: [],
  defaultProviderId: null,
  activeSessionId: null,
  sessionTabsExpanded: true,
  accessBannerDismissed: false,
};
