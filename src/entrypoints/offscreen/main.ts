import { browser } from 'wxt/browser';
import { onPdfRequest } from '@/shared/extract/pdf-local';

// Chrome's offscreen document (decisions.md T09): answers the background's
// `pdf-extract` requests with the PDF's text. Nothing is logged.
browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) =>
  onPdfRequest(message, sendResponse),
);
