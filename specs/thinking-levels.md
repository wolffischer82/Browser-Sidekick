# Thinking levels and reasoning display

Spec for GitHub issue #4, "Add thinking levels to the session (if possible for the selected model)". It builds on `specs/sidekick-mvp.md` (the "MVP spec"); everything there still holds unless this spec changes it. Task ids continue the MVP numbering (T13 onwards) so the shared logs stay unambiguous.

## 1. Goal

A session gets an adjustable thinking level, sent to the session's model in the form its provider expects. The model's reasoning, where the provider returns it, is shown in a collapsed block above each answer and saved with the answer.

## 2. Owner decisions (2026-10-01)

- **O1 Levels.** One unified set for every provider: Default, Low, Medium, High. Default sends no level and leaves the model's own behaviour.
- **O2 Unknown models.** The control is hidden only when the model is known not to support thinking levels. For models whose support is unknown it stays usable; if the provider rejects the level, the error tells the user to set thinking back to Default. No automatic retry without the level.
- **O3 Reasoning display.** Reasoning is shown in a collapsible block, collapsed by default.
- **O4 New sessions.** A new session always starts at Default. The level is stored on the session only.
- **O5 Reasoning storage.** Reasoning text is saved with the answer in IndexedDB, shown again when the session is reopened, and deleted with the session. It is never sent back to the model and never counted in the context budget.
- **O6 Reasoning visibility.** Reasoning is requested and shown whenever the model returns it, also at Default.

## 3. Out of scope

- Levels beyond the unified set (Off, minimal, xhigh, max) and token-budget inputs.
- A default thinking level in settings, per provider or global.
- Any other model parameter (temperature etc.).
- Sending reasoning back to the model, exporting it, or using it for titles.
- OpenAI's Responses API. `api.openai.com` returns no reasoning text over Chat Completions, so OpenAI models show no reasoning block.
- New manifest permissions, new dependencies.

## 4. Behaviour

### 4.1 Thinking level

- `ThinkingLevel` is `'low' | 'medium' | 'high'`. Default is the absence of a level.
- The level belongs to the session (see §5). Changing it takes effect with the next request. It applies to Ask and Summarize requests only; Test connection and title generation send exactly the request body they send today.
- The control sits in the side-panel header next to the model menu and follows the model menu's rules for when it is disabled (for example while an answer streams).
- The control is hidden when the session has no provider or model, or when the model's thinking support is `unsupported` (§4.2). While it is hidden no level is sent; the stored level is kept and applies again when the session switches to a model that shows the control.

### 4.2 Capability discovery

Each adapter's `listModels` reports, per model, whether thinking is `supported` or `unsupported`; a model it can say nothing about is `unknown`. A model id typed as free text, and any model cached before this feature, is `unknown` until the list is next refreshed by the existing refresh paths. No new refresh is added.

| Provider kind | Source | Rule |
|---|---|---|
| Anthropic | `GET /v1/models`, each model's `capabilities` and `max_tokens` | Mode `effort` when `capabilities.effort.supported` and `capabilities.thinking.types.adaptive.supported`. Otherwise mode `budget` when `capabilities.thinking.types.enabled.supported`. Otherwise `unsupported`. A model object without `capabilities` is `unknown`. Keep the model's `max_tokens` as its output cap. |
| Gemini | `models.list`, each model's boolean `thinking` | `true` is `supported`, `false` is `unsupported`, a missing field is `unknown`. |
| OpenAI-compatible | the model-list entry's `supported_parameters` array, when present (OpenRouter) | `supported` when the array contains `reasoning` or `reasoning_effort`, `unsupported` when the array is present without them, `unknown` when there is no array (OpenAI, Groq, Ollama, LM Studio). |

### 4.3 Request mapping

When the request carries no thinking information (Test connection, title generation) nothing below applies.

**Anthropic** (`POST /v1/messages`)

| Model support | Level | Sent |
|---|---|---|
| `effort` mode | Default | `thinking: {type: "adaptive", display: "summarized"}` |
| `effort` mode | low / medium / high | the same `thinking`, plus `output_config: {effort: "<level>"}` |
| `budget` mode | Default | nothing |
| `budget` mode | low / medium / high | `thinking: {type: "enabled", budget_tokens: 2048 / 8192 / 16384}` |
| `unknown` | Default | nothing |
| `unknown` | low / medium / high | as `effort` mode |

- Whenever a `thinking` parameter is sent and the caller gave no `maxOutputTokens`, `max_tokens` is 32000, lowered to the model's output cap when that is known and smaller. Reasoning counts against `max_tokens`, so the current 4096 would cut answers short. Requests without a `thinking` parameter keep today's value.
- `budget_tokens` must stay below `max_tokens`; if the cap forces `max_tokens` to or below the budget, lower the budget to `max_tokens - 1024`, and send no `thinking` parameter if that falls under 1024.
- Never send `temperature`, `top_p` or `top_k`, and never send `thinking: {type: "disabled"}`.
- History stays text only: thinking blocks are never sent back.

**Gemini** (`streamGenerateContent`, `generationConfig.thinkingConfig`)

| Model support | Level | Sent |
|---|---|---|
| `supported` | Default | `{includeThoughts: true}` |
| `supported` or `unknown` | low / medium / high | `{includeThoughts: true}` plus the level field below |
| `unknown` | Default | nothing |

- Model ids containing `gemini-2.5` take `thinkingBudget`: 2048 / 8192 / 24576.
- Every other model id takes `thinkingLevel`: `"low"` / `"medium"` / `"high"`.
- Never send both fields.

**OpenAI-compatible** (`POST /chat/completions`)

- low / medium / high: top-level `reasoning_effort: "<level>"`.
- Default: nothing.
- This one field is accepted by OpenAI, OpenRouter, Groq and Ollama. No per-host variants.

### 4.4 Reasoning output

- `LlmProvider.stream` yields events instead of bare strings: `{type: 'text', delta}` and `{type: 'reasoning', delta}`. All callers are updated; title generation and Test connection ignore reasoning events.
- Anthropic: `content_block_delta` events whose delta is a `thinking_delta` yield its `thinking` text. `signature_delta` and empty thinking text yield nothing.
- Gemini: parts with `thought: true` yield their text as reasoning.
- OpenAI-compatible: `choices[0].delta.reasoning_content` or `choices[0].delta.reasoning`, when it is a non-empty string, yields reasoning. Other reasoning shapes are ignored.
- The assistant message keeps the reasoning that arrived, in order, in `Message.reasoning` (§5): on completion, on Stop (partial) and on failure (what arrived before it). A successful Retry replaces it.
- Reasoning is not part of the history sent to the model, the context budget, title generation, or anything that copies or reuses the answer text.
- Reasoning is page-derived user data: it is never logged, printed or transmitted anywhere except its display and its IndexedDB record.

### 4.5 Reasoning block

- An assistant message with non-empty reasoning shows a toggle row above the answer text. It is collapsed by default, also while streaming, and its open state is not stored.
- While reasoning is arriving and no answer text has arrived yet, the row reads "Thinking…". Otherwise it reads "Reasoning".
- Expanded, it shows the reasoning through the same sanitised renderer as answers, without citation linking, visually subdued against the answer. Open while streaming, it updates live.
- The row is a real button with `aria-expanded`, operable by keyboard.
- A message without reasoning looks exactly as today.

### 4.6 Errors

- New `LlmErrorCode`: `thinking-unsupported`. An adapter maps to it when the request carried a level, the provider answered 400 or 422, and the provider's message matches `/reasoning|thinking|effort/i`. Everything else maps as today.
- The transcript shows the localised message below for this code, with the existing Retry. The provider's own text is not needed.

### 4.7 Strings

Both locales, following the MVP spec's style rules.

| Key purpose | en | de |
|---|---|---|
| Control label | Thinking | Denken |
| Control accessible name | Thinking level | Denkstufe |
| Option | Default | Standard |
| Option | Low | Niedrig |
| Option | Medium | Mittel |
| Option | High | Hoch |
| Reasoning row, streaming before the answer | Thinking… | Denkt nach … |
| Reasoning row | Reasoning | Gedankengang |
| Error `thinking-unsupported` | This model doesn't accept a thinking level. Set thinking to Default and try again. | Dieses Modell unterstützt keine Denkstufe. Stell das Denken auf Standard und versuch es erneut. |

The control shows label and current value, e.g. "Thinking: Default".

## 5. Data

All additions are optional fields; a missing field means the same as the stated default, so there is no IndexedDB version bump and no `storage.local` migration.

- `Session.thinkingLevel?: ThinkingLevel | null`: missing or `null` is Default.
- `Message.reasoning?: string | null`: missing or `null` is no reasoning. Assistant messages only.
- `ProviderConfig.modelInfo?: Record<string, ModelInfo>`, keyed by model id, written wherever `cachedModels` is written and cleared with it. A missing key is `unknown`.
  `ModelInfo = { thinking: 'supported' | 'unsupported'; thinkingMode?: 'effort' | 'budget'; maxOutputTokens?: number }`. `thinkingMode` and `maxOutputTokens` are set by the Anthropic adapter only.

## 6. Task list

| ID | Task | Depends on |
|---|---|---|
| T13 | LLM layer: thinking level in requests and capability discovery | MVP done |
| T14 | LLM layer: reasoning in the stream | T13 |
| T15 | Thinking-level control in the session header | T13 |
| T16 | Reasoning block, README, final report | T14, T15 |

### T13 LLM layer: thinking level in requests and capability discovery
**Scope**: `ThinkingLevel`, the `ModelInfo` type and `ProviderConfig.modelInfo` (§5), `listModels` returning per-model info (§4.2), the optional thinking information on `LlmRequest`, the request mapping for all three adapters (§4.3), and the `thinking-unsupported` code (§4.6) without its UI string. No UI change: nothing passes thinking information yet, so behaviour is unchanged.

**Acceptance**:
- Requests without thinking information produce byte-identical bodies to before, for all three adapters.
- Every row of the three mapping tables in §4.3 produces exactly the stated body fields, including the Anthropic `max_tokens` and budget rules.
- `listModels` reports support per §4.2 for each adapter, and the settings code stores it in `modelInfo` next to `cachedModels`.
- A 400 that mentions reasoning, thinking or effort on a request with a level maps to `thinking-unsupported`; the same 400 on a request without a level maps as before.

**Tests**:
- Table-driven request-body tests per adapter covering every mapping row and the no-thinking-information case.
- Anthropic `max_tokens` tests: known cap below 32000, unknown cap, caller-given `maxOutputTokens`, budget lowered or dropped by a small cap.
- `listModels` parsing tests per adapter: supported, unsupported, unknown, malformed capability data.
- Error-mapping tests for `thinking-unsupported`, with and without a level.
- A settings test that `modelInfo` is written and cleared together with `cachedModels`.

### T14 LLM layer: reasoning in the stream
**Scope**: the stream event type and reasoning parsing in all three adapters (§4.4, first five bullets), with every caller updated. The ask flow collects reasoning and stores it in `Message.reasoning` (§4.4, §5); nothing renders it yet. The mock LLM (`tests/mock-llm/`) learns to emit reasoning deltas.

**Acceptance**:
- Each adapter yields reasoning and text events in arrival order and yields nothing for signatures or empty reasoning.
- Title generation and Test connection behave as before.
- The stored assistant message carries the reasoning on completion, Stop and failure, and a successful Retry replaces it.
- Reasoning is absent from the turns sent on the next request and from the context-budget calculation.
- Decision 8 in `docs/decisions.md` ("Thinking output … is never yielded") is superseded with a dated entry.

**Tests**:
- Per-adapter stream tests replacing the existing "thinking is dropped" tests: reasoning only, interleaved reasoning and text, both OpenAI-compatible field names, non-string reasoning ignored.
- Ask-flow tests with a mocked provider: reasoning stored on completion, Stop, failure, Retry; reasoning not in the next request's turns.
- A title-generation test that reasoning events don't leak into the title.

### T15 Thinking-level control in the session header
**Scope**: `Session.thinkingLevel` (§5), the header control (§4.1), passing level and model info into Ask and Summarize requests, the `thinking-unsupported` message (§4.6), the strings for these (§4.7), and the README Features line. The mock LLM records the `reasoning_effort` it received and can reject it with a 400 for a designated model.

**Acceptance**:
- The control shows the session's level, changes it, and the change persists across reopening the side panel and switching sessions.
- A new session starts at Default.
- The control is hidden with no provider or model and for an `unsupported` model, shown for `supported` and `unknown`; a hidden control sends no level and keeps the stored one.
- Ask and Summarize send the level; Test connection and title generation never do.
- A provider rejection shows the `thinking-unsupported` message with Retry; after setting Default, Retry succeeds.
- The control is keyboard operable and has its accessible name in both locales.

**Tests**:
- Repository test for reading and writing `thinkingLevel`, including records without the field.
- Component tests for the control: options, selection, hidden states, disabled state.
- Ask-flow tests that level and model info reach the provider request, and that a hidden control sends none.
- e2e against the mock LLM: set High, ask, assert the mock received `reasoning_effort: "high"`; switch session and back; reject flow with the error message, then Default and Retry. Screenshots of the control closed, open, and the error.

**UI check** in both browsers.

### T16 Reasoning block, README, final report
**Scope**: the reasoning block (§4.5) and its strings (§4.7), the README Features and Limits lines for reasoning (including that OpenAI's own API returns none), and the final report `docs/thinking-levels-report.md`.

**Acceptance**:
- Every bullet of §4.5 holds, for a live answer and for a reopened session.
- Injected `<script>` or `onerror` in reasoning text does not execute.
- A message without reasoning renders exactly as before.
- The final report covers what shipped, deviations, known limitations per provider, manual check results and open questions.

**Tests**:
- Component tests: no reasoning, collapsed, expanded, the two labels, live update while open, keyboard toggle.
- Sanitiser test for reasoning content.
- e2e against the mock LLM: ask with reasoning streamed before the answer, see "Thinking…" then "Reasoning", expand it, reopen the session and expand again. Screenshots of collapsed, streaming and expanded states.

**UI check** in both browsers.

## 7. Working method

The MVP spec's "9. Working method" applies with the changes below; read its subsections "Task loop", "Definition of done", "Verification gate" and "Browser automation".

### Branching and commits
- Branch: `feature/thinking-levels` from `main`. Never commit to `main`.
- Conventional commits carrying the task id, e.g. `feat(llm): map thinking level per provider [T13]`, using the repo-local noreply address.
- Pushing the branch and opening the PR happen only after the owner approves.

### Logs (in `docs/`)
- `progress.md`, `decisions.md` and `questions.md` continue, with T13–T16 added under a "Thinking levels" heading.
- `thinking-levels-report.md`: the final report, written in T16.

### Task loop and definition of done
As in the MVP spec, including the rebuilt and committed `dist/` and the README rule.

### Verification gate
`npm run lint && npm run typecheck && npm run test && npm run build && npm run check:dist && npm run lint:firefox && npm run e2e`

### Browser automation
As in the MVP spec. UI tasks (T15, T16) extend the Playwright suite and write screenshots to `test-results/screens/<task>-<step>.png`. Nothing ever calls a real provider.

### Stop and ask
Stop and ask the owner about:
- Any new manifest permission or host permission.
- Any new dependency.
- Any stored data beyond §5.
- Any user-visible behaviour or wording not covered here.
- Anything that calls a real LLM provider or spends money.
- A provider rule in §4.2–§4.4 that contradicts what the code or its tests show the provider actually does.
