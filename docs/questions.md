# Open questions for the owner

Each entry names the task it blocks.

1. **Firefox `data_collection_permissions`** (blocks: a warning-free `lint:firefox` in T01; the privacy audit in T12). `web-ext lint` warns that `browser_specific_settings.gecko.data_collection_permissions` is required for all new Firefox extensions. Firefox shows this declaration to the user at install. The extension sends page content, URLs and titles to the provider the user configures (spec 6, Privacy). Which declaration should the manifest carry: `required: ["none"]`, or specific categories (for example `websiteContent`)? Also: the key is supported from Firefox 140; on 128–139 it is unknown. Keep `strict_min_version` at 128 (accepting a possible unknown-key warning on 128–139), or raise it to 140 (the current ESR)?
2. **Dev-only packages not named in spec section 6** (blocks: nothing; installed pending confirmation, easy to replace): `typescript-eslint`, `@eslint/js`, `globals`, `eslint-config-prettier`, `happy-dom`. Approve?
3. **Toolbar icon** (blocks: nothing functionally; T12 polish): there is no icon artwork, so both browsers show their default placeholder icon. Provide artwork, or should the implementer draw a simple one?
