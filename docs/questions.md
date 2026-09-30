# Open questions for the owner

Each entry names the task it blocks.

4. **D10 per-site request for tabs whose URL is hidden** (T06; **not blocking**, default applied). Without the `tabs` permission, the sidebar can't see the URL of a tab it has no access to, so the needle can't request access to that one site. Should we keep the current default (the "not accessible" row points to the context menu "Pin to Sidekick" and to "Allow on all sites" in Settings), or add the `tabs` permission (install warning "Read your browsing history") so that the needle can request that one site? decisions.md T06-4, T06-15.

5. **Feedback for a context-menu pin when no sidebar is open** (T07; **not blocking**, default applied). With the sidebar closed, a context-menu pin of a page that's already pinned, or of a page that can't be read (a web store, or a Firefox tab-strip click on an `about:` page), does nothing visible; an open sidebar showing the session shows "Already pinned". Keep this default, or show feedback outside the sidebar (e.g. a toolbar badge, which needs no new permission)? decisions.md T07-2, T07-10.

## Closed

1. **Firefox `data_collection_permissions`** (T01). Answered 2026-09-30: declare `required: ["websiteContent", "browsingActivity"]` (corrected by the owner the same day; first answer was `websiteContent` only) and raise the Firefox minimum to 140 ESR (spec section 1). Implemented in T01; decisions.md T01-7.
2. **Dev-only packages not named in spec section 6** (T01): `typescript-eslint`, `@eslint/js`, `globals`, `eslint-config-prettier`, `happy-dom`. Answered 2026-09-30: approved. decisions.md T01-3.
3. **Toolbar icon** (T01). Answered 2026-09-30: the implementer draws a simple placeholder SVG of a sidebar with a pin needle, exported to the PNG sizes both browsers need, and replaceable without code changes. decisions.md T01-13.
