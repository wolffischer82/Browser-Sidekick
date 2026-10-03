import { useEffect, useRef, useState } from 'preact/hooks';
import { t, type MessageKey } from '@/shared/i18n';
import { createProvider, DEFAULT_BASE_URLS, type LlmProvider } from '@/shared/llm';
import { llmErrorText } from '@/shared/llm-messages';
import type { ModelInfo, ProviderConfig, ProviderKind } from '@/shared/model';
import { accessPattern, hasHostAccess, requestHostAccess } from '@/shared/provider-access';
import { storeProvider } from '@/shared/provider-settings';
import {
  emptyDraft,
  maskKey,
  parseBudget,
  validateDraft,
  type DraftErrors,
  type DraftField,
  type ProviderDraft,
} from '@/shared/providers';

export const KIND_LABELS: Readonly<Record<ProviderKind, MessageKey>> = {
  'openai-compatible': 'kindOpenAi',
  anthropic: 'kindAnthropic',
  gemini: 'kindGemini',
};

const KINDS: ProviderKind[] = ['openai-compatible', 'anthropic', 'gemini'];

/** Test connection gives up after this long (spec 5.7). */
export const TEST_TIMEOUT_MS = 30_000;

const FIELD_ORDER: DraftField[] = ['label', 'baseUrl', 'apiKey', 'defaultModel', 'contextBudget'];

type ModelsStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type TestResult =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok' }
  | { state: 'error'; message: string; detail: string | null };

interface Props {
  /** The provider being edited, or `null` to add one. */
  existing: ProviderConfig | null;
  /** Called after saving (with the provider's id) or cancelling (`null`). */
  onDone: (savedId: string | null) => void;
}

function draftOf(provider: ProviderConfig): ProviderDraft {
  return {
    kind: provider.kind,
    label: provider.label,
    baseUrl: provider.baseUrl,
    apiKey: '',
    defaultModel: provider.defaultModel,
    contextBudget: String(provider.contextBudget),
  };
}

/**
 * Add or edit one provider (spec 5.7). The saved key is never put back into
 * the page: the key field only holds a newly typed key, and the saved one
 * is shown masked. Saving asks for the server's host access from the click
 * when it isn't covered yet; declining saves the provider as "no access".
 */
export function ProviderForm({ existing, onDone }: Props) {
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    existing ? draftOf(existing) : emptyDraft('openai-compatible', t('kindOpenAi')),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [models, setModels] = useState<string[] | null>(existing?.cachedModels ?? null);
  /** What the list said about its models; kept and cleared together with `models`. */
  const [modelInfo, setModelInfo] = useState<Record<string, ModelInfo> | null>(
    existing?.cachedModels ? (existing.modelInfo ?? null) : null,
  );
  const [modelsStatus, setModelsStatus] = useState<ModelsStatus>('idle');
  const [test, setTest] = useState<TestResult>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** The access pattern already granted, so saving needn't ask again. */
  const [coveredPattern, setCoveredPattern] = useState<string | null>(null);
  const requests = useRef<AbortController[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  const storedKey = existing?.apiKey ?? '';
  const isOpenAi = draft.kind === 'openai-compatible';
  const pattern = accessPattern(draft);

  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLElement>(existing ? '#provider-label' : '#provider-kind')
      ?.focus();
    const pending = requests.current;
    return () => {
      for (const controller of pending) controller.abort();
    };
  }, [existing]);

  useEffect(() => {
    if (!pattern) return;
    let current = true;
    void hasHostAccess(pattern).then((covered) => {
      if (current) setCoveredPattern(covered ? pattern : null);
    });
    return () => {
      current = false;
    };
  }, [pattern]);

  const newRequest = (): AbortController => {
    const controller = new AbortController();
    requests.current.push(controller);
    return controller;
  };

  const connection = (): LlmProvider =>
    createProvider({
      kind: draft.kind,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim() || storedKey,
    });

  const update = (patch: Partial<ProviderDraft>) => {
    const next = { ...draft, ...patch };
    if (patch.kind && patch.kind !== draft.kind) {
      next.baseUrl = DEFAULT_BASE_URLS[patch.kind];
      // A name the user hasn't changed follows the type.
      if (draft.label === t(KIND_LABELS[draft.kind])) next.label = t(KIND_LABELS[patch.kind]);
    }
    if (next.kind !== draft.kind || next.baseUrl !== draft.baseUrl) {
      setModels(null);
      setModelInfo(null);
      setModelsStatus('idle');
    }
    if (
      next.kind !== draft.kind ||
      next.baseUrl !== draft.baseUrl ||
      next.apiKey !== draft.apiKey
    ) {
      setTest({ state: 'idle' });
    }
    setDraft(next);
    const cleared = { ...errors };
    for (const key of Object.keys(patch) as DraftField[]) Reflect.deleteProperty(cleared, key);
    setErrors(cleared);
  };

  /** Shows `found` and focuses the first field with an error; true if there were errors. */
  const showErrors = (found: DraftErrors): boolean => {
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
    return first !== undefined;
  };

  const connectionErrors = (fields: DraftField[]): DraftErrors => {
    const all = validateDraft(draft, { hasStoredKey: storedKey !== '' });
    return Object.fromEntries(fields.flatMap((f) => (all[f] ? [[f, all[f]]] : [])));
  };

  const loadModels = () => {
    if (showErrors(connectionErrors(['baseUrl', 'apiKey']))) return;
    const controller = newRequest();
    setModelsStatus('loading');
    connection()
      .listModels(controller.signal)
      .then(
        (list) => {
          setModels(list.models);
          setModelInfo(list.models ? list.info : null);
          setModelsStatus(list.models ? 'loaded' : 'failed');
        },
        () => undefined, // Aborted because the form closed.
      );
  };

  const testConnection = () => {
    if (showErrors(connectionErrors(['baseUrl', 'apiKey', 'defaultModel']))) return;
    const controller = newRequest();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TEST_TIMEOUT_MS);
    const provider = connection();
    setTest({ state: 'running' });
    (async () => {
      const request = {
        model: draft.defaultModel.trim(),
        system: '',
        turns: [{ role: 'user' as const, content: 'Hi' }],
        maxOutputTokens: 1,
      };
      for await (const event of provider.stream(request, controller.signal)) {
        if (event.type === 'text') break;
      }
    })()
      .then(
        () => {
          setTest({ state: 'ok' });
        },
        (error: unknown) => {
          const mapped = provider.mapError(error);
          if (mapped.code === 'aborted' && !timedOut) return; // The form closed.
          const text = timedOut
            ? { message: t('llmErrorTimeout'), detail: null }
            : llmErrorText(mapped);
          setTest({ state: 'error', ...text });
        },
      )
      .finally(() => {
        clearTimeout(timer);
      });
  };

  const save = (event: Event) => {
    event.preventDefault();
    if (saving) return;
    if (showErrors(validateDraft(draft, { hasStoredKey: storedKey !== '' }))) return;
    // Asked here, synchronously in the click: Firefox refuses after an await.
    const access =
      pattern && pattern !== coveredPattern ? requestHostAccess(pattern) : Promise.resolve(true);
    setSaving(true);
    setSaveFailed(false);
    access
      .then(async (hasAccess) => {
        const config: ProviderConfig = {
          id: existing?.id ?? crypto.randomUUID(),
          kind: draft.kind,
          label: draft.label.trim(),
          baseUrl: isOpenAi ? draft.baseUrl.trim() : DEFAULT_BASE_URLS[draft.kind],
          apiKey: draft.apiKey.trim() || storedKey,
          defaultModel: draft.defaultModel.trim(),
          contextBudget: parseBudget(draft.contextBudget) ?? 0,
          cachedModels: models,
          ...(models && modelInfo ? { modelInfo } : {}),
          hasAccess,
        };
        await storeProvider(config);
        onDone(config.id);
      })
      .catch(() => {
        console.error('Sidekick: a provider could not be saved.');
        setSaving(false);
        setSaveFailed(true);
      });
  };

  const describedBy = (field: DraftField, ...hints: (string | false)[]) =>
    [errors[field] ? `provider-${field}-error` : false, ...hints].filter(Boolean).join(' ') ||
    undefined;

  const fieldError = (field: DraftField) =>
    errors[field] && (
      <p id={`provider-${field}-error`} class="field-error">
        {t(errors[field])}
      </p>
    );

  const modelOptions =
    models && models.length > 0
      ? draft.defaultModel && !models.includes(draft.defaultModel)
        ? [draft.defaultModel, ...models]
        : models
      : null;

  return (
    <form
      ref={formRef}
      class="provider-form"
      aria-labelledby="provider-form-heading"
      noValidate
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onDone(null);
      }}
    >
      <h3 id="provider-form-heading" class="section-label settings-label">
        {t(existing ? 'editProvider' : 'addProvider')}
      </h3>
      <div class="settings-card settings-card-body">
        <div class="field">
          <label for="provider-kind">{t('fieldKind')}</label>
          <select
            id="provider-kind"
            value={draft.kind}
            disabled={existing !== null}
            onChange={(event) => {
              update({ kind: event.currentTarget.value as ProviderKind });
            }}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(KIND_LABELS[kind])}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <label for="provider-label">{t('fieldLabel')}</label>
          <input
            id="provider-label"
            data-field="label"
            type="text"
            value={draft.label}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={describedBy('label')}
            onInput={(event) => {
              update({ label: event.currentTarget.value });
            }}
          />
          {fieldError('label')}
        </div>

        <div class="field">
          <label for="provider-baseUrl">{t('fieldBaseUrl')}</label>
          <input
            id="provider-baseUrl"
            data-field="baseUrl"
            type="url"
            spellcheck={false}
            autocomplete="off"
            value={draft.baseUrl}
            readOnly={!isOpenAi}
            aria-invalid={errors.baseUrl ? true : undefined}
            aria-describedby={describedBy('baseUrl', !isOpenAi && 'provider-baseUrl-hint')}
            onInput={(event) => {
              update({ baseUrl: event.currentTarget.value });
            }}
          />
          {fieldError('baseUrl')}
          {!isOpenAi && (
            <p id="provider-baseUrl-hint" class="field-hint">
              {t('baseUrlFixedHint')}
            </p>
          )}
        </div>

        <div class="field">
          <label for="provider-apiKey">{t('fieldApiKey')}</label>
          <input
            id="provider-apiKey"
            data-field="apiKey"
            type="password"
            spellcheck={false}
            autocomplete="off"
            value={draft.apiKey}
            aria-invalid={errors.apiKey ? true : undefined}
            aria-describedby={describedBy(
              'apiKey',
              storedKey !== '' && !draft.apiKey && 'provider-apiKey-saved',
              'provider-apiKey-hint',
            )}
            onInput={(event) => {
              update({ apiKey: event.currentTarget.value });
            }}
          />
          {fieldError('apiKey')}
          {storedKey !== '' && !draft.apiKey && (
            <p id="provider-apiKey-saved" class="field-hint">
              {t('apiKeySaved', maskKey(storedKey))}
            </p>
          )}
          <p id="provider-apiKey-hint" class="field-hint">
            {isOpenAi ? `${t('apiKeyOptionalHint')} ` : ''}
            {t('apiKeyStorageHint')}
          </p>
        </div>

        <div class="field">
          <label for="provider-defaultModel">{t('fieldDefaultModel')}</label>
          <div class="field-row">
            {modelOptions ? (
              <select
                id="provider-defaultModel"
                data-field="defaultModel"
                value={draft.defaultModel}
                aria-invalid={errors.defaultModel ? true : undefined}
                aria-describedby={describedBy('defaultModel', 'provider-models-status')}
                onChange={(event) => {
                  update({ defaultModel: event.currentTarget.value });
                }}
              >
                <option value="">{t('chooseModel')}</option>
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="provider-defaultModel"
                data-field="defaultModel"
                type="text"
                spellcheck={false}
                autocomplete="off"
                value={draft.defaultModel}
                aria-invalid={errors.defaultModel ? true : undefined}
                aria-describedby={describedBy('defaultModel', 'provider-models-status')}
                onInput={(event) => {
                  update({ defaultModel: event.currentTarget.value });
                }}
              />
            )}
            <button
              type="button"
              class="button"
              aria-disabled={modelsStatus === 'loading' ? 'true' : undefined}
              onClick={() => {
                if (modelsStatus !== 'loading') loadModels();
              }}
            >
              {t('loadModels')}
            </button>
          </div>
          {fieldError('defaultModel')}
          <p id="provider-models-status" class="field-hint" role="status">
            {modelsStatus === 'loading' && t('modelsLoading')}
            {modelsStatus === 'loaded' && t('modelsLoaded')}
            {modelsStatus === 'failed' && t('modelsFailed')}
          </p>
        </div>

        <div class="field">
          <label for="provider-contextBudget">{t('fieldContextBudget')}</label>
          <input
            id="provider-contextBudget"
            data-field="contextBudget"
            type="text"
            inputMode="numeric"
            value={draft.contextBudget}
            aria-invalid={errors.contextBudget ? true : undefined}
            aria-describedby={describedBy('contextBudget', 'provider-contextBudget-hint')}
            onInput={(event) => {
              update({ contextBudget: event.currentTarget.value });
            }}
          />
          {fieldError('contextBudget')}
          <p id="provider-contextBudget-hint" class="field-hint">
            {t('contextBudgetHint')}
          </p>
        </div>

        {isOpenAi && <p class="field-hint help">{t('localServerHelp')}</p>}

        <div class="test-connection">
          <button
            type="button"
            class="button"
            aria-disabled={test.state === 'running' ? 'true' : undefined}
            onClick={() => {
              if (test.state !== 'running') testConnection();
            }}
          >
            {t('testConnection')}
          </button>
          <div class="test-result" role="status">
            {test.state === 'running' && <p class="muted">{t('testing')}</p>}
            {test.state === 'ok' && <p class="result-ok">{t('testOk')}</p>}
            {test.state === 'error' && (
              <>
                <p class="result-error">{test.message}</p>
                {test.detail && <p class="result-detail">{test.detail}</p>}
              </>
            )}
          </div>
        </div>

        {saveFailed && (
          <p class="error form-error" role="alert">
            {t('saveError')}
          </p>
        )}

        <div class="form-actions">
          <button
            type="button"
            class="button"
            onClick={() => {
              onDone(null);
            }}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            class="button button-primary"
            aria-disabled={saving ? 'true' : undefined}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </form>
  );
}
