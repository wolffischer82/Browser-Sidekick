import { extractFromDocument } from '@/shared/extract/page';

/**
 * Injected on demand by `extractTab` with `scripting.executeScript({ files })`
 * (spec 6: no persistent content scripts). The returned `PageText` is the
 * script's result; it goes back to the caller only and is never logged.
 */
export default defineUnlistedScript(() => extractFromDocument(document));
