# Thinking levels: final report

Spec: `specs/thinking-levels.md` (GitHub issue #4). Branch `feature/thinking-levels`, tasks T13 to T16, written 2026-10-01. The branch is not pushed and no PR is open; both wait for the owner's approval (spec 7). Details per task are in `docs/progress.md` and `docs/decisions.md` under "Thinking levels".

## What shipped

- **Thinking level per session** (T13, T15). The header has a "Thinking: Default / Low / Medium / High" control next to the model menu. The level is stored on the session, a new session starts at Default, and the control is hidden when the session has no provider or model or when the model is known not to take a level. Ask and Summarize send the level; Test connection and title generation send the request bodies they sent before.
- **Per-provider mapping** (T13). Anthropic: adaptive thinking with `output_config.effort`, or `thinking.budget_tokens` for models that only know budgets. Gemini: `thinkingConfig` with `thinkingLevel`, or `thinkingBudget` for `gemini-2.5` ids. OpenAI-compatible: `reasoning_effort`.
- **Capability discovery** (T13). Loading a provider's model list also stores, per model, whether it supports thinking (`ProviderConfig.modelInfo`): from Anthropic's `capabilities`, Gemini's `thinking` flag and OpenRouter's `supported_parameters`. A model the list says nothing about counts as unknown and keeps the control.
- **Rejected level** (T13, T15). A 400 or 422 that names reasoning, thinking or effort on a request that carried a level shows "This model doesn't accept a thinking level. Set thinking to Default and try again." with Retry. There is no automatic retry without the level.
- **Reasoning in the stream and in storage** (T14). The adapters yield reasoning and answer text as separate events. The reasoning that arrived is saved with the answer (`Message.reasoning`) on completion, Stop and failure, replaced by a Retry, and deleted with the session. It is never sent back to the model, never counted in the context budget and never logged.
- **Reasoning block** (T16). An answer with reasoning has a toggle row above its text, collapsed by default: "Thinking…" while only reasoning has arrived, "Reasoning" afterwards. Opened, it shows the reasoning through the answer's sanitised Markdown renderer, without citation buttons, in the secondary colour with a left border, and updates live while the answer streams. It is shown again when the session is reopened.
- Strings in English and German; README Features and Limits lines; no new manifest permission, no new dependency, no IndexedDB version bump.

Tests at the end of T16: 1192 unit and component tests in 49 files, 16 Playwright tests in 10 files (Chromium, against the local mock LLM). Screenshots of the UI states are in `test-results/screens/T15-*.png` and `T16-*.png` (not committed).

## Deviations from the spec

- **The thinking control is never disabled** (decisions.md T15-6). Spec 4.1 says it follows the model menu's rules for when it is disabled, "for example while an answer streams". The model menu has no disabled state, so the control has none either; a level chosen while an answer streams applies to the next request. See open question 1.
- **A level is not sent for a model known as unsupported, whatever the caller passes** (T13-6). The mapping tables have no row for this case; the adapters send no thinking field then.
- **`thinking-unsupported` only replaces what would otherwise be the generic bad-request error** (T13-9). A 400 that already maps to an invalid key, a missing model or a too-long context keeps that code.
- **The button's accessible name includes the value** (T15-5): "Thinking level: High" rather than "Thinking level" alone, as the model button does.
- **Header layout below 520 px** (T15-7): the thinking control wraps under the model menu instead of cutting off its value.
- **Open state of the reasoning block** (T16-4, T16-5): kept in memory so a block opened while streaming stays open when the answer is stored; switching sessions or reloading collapses it. Opening or closing a block doesn't scroll the transcript.
- **Provider documentation was not re-read** during T13 and T14 (T13-12, T14-10): the run had no way to fetch it, so spec 4.2 to 4.4 are implemented as written.

## Known limitations

Per provider:

- **OpenAI (`api.openai.com`)**: returns no reasoning text over Chat Completions, so OpenAI models never show a reasoning block. The level is still sent as `reasoning_effort`.
- **OpenRouter**: the only OpenAI-compatible host whose model list says which models take a level. Reasoning is read from `delta.reasoning` or `delta.reasoning_content` when it is a plain string; other shapes (such as `reasoning_details`) are ignored.
- **Groq, Ollama**: every model counts as unknown, so the control always shows. A model that doesn't take `reasoning_effort` either ignores it or rejects it; a rejection shows the message above only if the provider's text mentions reasoning, thinking or effort, and the generic bad-request message otherwise.
- **LM Studio**: its chat endpoint documents no reasoning field, so a reasoning block may never appear there, and it may ignore or reject `reasoning_effort` like the hosts above.
- **Anthropic**:
  - On models with adaptive thinking and effort (Opus 4.6 to 4.8, Sonnet 4.6), Default now sends `thinking: {type: "adaptive", display: "summarized"}`, where the bare API default is no thinking. This is needed to get reasoning text (owner decision O6) and may add cost.
  - Whenever a thinking parameter is sent, `max_tokens` is 32000 (lowered to the model's output cap when the model list gave one) instead of 4096.
  - A model id typed in by hand has no known cap. If its real output cap is below 32000 and a level is set, the request fails with the generic bad-request message, not the thinking message.
  - With adaptive thinking the request asks for summarised thinking (`display: "summarized"`), so the block shows a summary, not the raw thinking.
- **Gemini**: ids containing `gemini-2.5` get a token budget, all others a level name. A model the list doesn't describe gets no `includeThoughts` at Default, so it shows no reasoning until a level is set.

General:

- Model info arrives only when the model list is next refreshed by the existing paths (Load models in the provider form). Providers saved before this feature, and model ids typed as free text, count as unknown until then.
- The provider mappings and the reasoning parsing are verified against mocks only, never against a live provider.
- German strings are covered by component tests only; the e2e browser runs in English.
- The e2e suite runs in Chromium. Firefox was checked by loading `dist/firefox-ext` headless, not by driving the UI.
- A level change in one sidebar window reaches another window showing the same session only when that window next loads the session (T15-9), like a model change.
- Reasoning can't be copied separately, exported or sent back to the model (spec 3).

## Manual checks

Done so far, without a real provider:

- T15: the orchestrator reviewed the Chromium screenshots and loaded `dist/firefox-ext` headless in Firefox 140 ESR as a temporary add-on, without extension errors.
- T16: the e2e flow passes in Chromium and wrote the screens `T16-01` to `T16-08` (light and dark, one at 320 px). The orchestrator reviewed them and loaded the final `dist/firefox-ext` headless in Firefox 140 ESR as a temporary add-on, without extension errors. The sidebar itself was not rendered in Firefox, so how the control and the reasoning block look there is the owner's check.
- No request has gone to a real provider.

For the owner, in Chrome and in Firefox, with your own keys:

- [ ] Refresh the model list of each saved provider (Settings, the provider, Load models, Save), so the models' thinking support is known.
- [ ] Anthropic, a model with adaptive thinking (for example Sonnet 4.6): ask at Default and at High. A "Thinking…" row appears before the answer and turns into "Reasoning"; opened, it shows the summary. The answer isn't cut short.
- [ ] Anthropic, an older model with budgets only, if you have one: Low and High both answer; Default shows no reasoning block.
- [ ] Anthropic, a model without thinking support: the control is hidden.
- [ ] Gemini, a 2.5 model and a newer one: Low and High both answer and show a reasoning block; a model listed without thinking has no control.
- [ ] OpenAI: Low and High answer on a reasoning model, and no reasoning block appears. On a model without reasoning support, note whether High shows the "doesn't accept a thinking level" message or the generic one; after setting Default, Retry succeeds.
- [ ] OpenRouter: the control is hidden for a model without reasoning and shown for one with it; a reasoning model shows the block.
- [ ] Ollama or LM Studio with a local reasoning model, if you use one: note whether the level is accepted and whether a reasoning block appears.
- [ ] Open the block while an answer streams: it grows live and the transcript keeps following; scrolling up stops the following.
- [ ] Stop an answer while it reads "Thinking…": the row reads "Reasoning" and the answer is marked "Stopped".
- [ ] Close and reopen the sidebar, and in Chrome restart the browser: the level of each session and the reasoning of old answers are still there, the blocks collapsed.
- [ ] Summarize with a level set: it answers and shows the block like Ask.
- [ ] Keyboard only: reach the thinking control and the reasoning row with Tab, operate them with Enter, Space and the arrow keys.
- [ ] Look at both in light and dark mode, in a narrow sidebar, and once with the browser set to German.
- [ ] Delete a session, and use "Delete all data": the answers and their reasoning are gone.

## Open questions

1. **Should the thinking control (and the model menu) be disabled while an answer streams?** Today both stay usable and a change applies to the next request (T15-6). The spec's example assumes they are disabled; disabling the model menu would change MVP behaviour.

`docs/questions.md` has no open entry for T13 to T16.
