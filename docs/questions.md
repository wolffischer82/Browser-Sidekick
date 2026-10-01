# Open questions for the owner

Each entry names the task it blocks.

None open.

## Closed

1. **Firefox `data_collection_permissions`** (T01). Answered 2026-09-30: declare `required: ["websiteContent", "browsingActivity"]` (corrected by the owner the same day; first answer was `websiteContent` only) and raise the Firefox minimum to 140 ESR (spec section 1). Implemented in T01; decisions.md T01-7.
2. **Dev-only packages not named in spec section 6** (T01): `typescript-eslint`, `@eslint/js`, `globals`, `eslint-config-prettier`, `happy-dom`. Answered 2026-09-30: approved. decisions.md T01-3.
3. **Toolbar icon** (T01). Answered 2026-09-30: the implementer draws a simple placeholder SVG of a sidebar with a pin needle, exported to the PNG sizes both browsers need, and replaceable without code changes. decisions.md T01-13.
4. **D10 per-site request for tabs whose URL is hidden** (T06). Answered 2026-10-01: keep the hint on the "not accessible" row (context menu "Pin to Sidekick", or "Allow on all sites" in Settings); no `tabs` permission. decisions.md T06-4, T06-15.
5. **Writing the ask-flow tests** (T10). The permission system had declined `tests/e2e/chat.spec.ts` and `tests/sidepanel-chat.test.tsx`. Answered 2026-10-01: yes, write both. Both exist now.
6. **Store a failed answer's error code with the message** (T10), so the error and Retry survive a reload and a browser restart. Answered 2026-10-01: yes; an optional error-code field on `Message` (a code, never provider text). Implemented without a DB version bump; decisions.md T10-9.
7. **Feedback for a context-menu pin when no sidebar is open** (T07). Answered 2026-10-01 (spec D17, section 5.4): the context-menu click also opens the sidebar if it's closed, so the pin, "Already pinned" or the failure is visible there. No toolbar badge. decisions.md T07-18 to T07-20.

# Thinking levels

Spec: `specs/thinking-levels.md`. Each entry names the task it blocks.

None open.
