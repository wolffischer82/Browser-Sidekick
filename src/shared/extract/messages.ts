import { t, type MessageKey } from '../i18n';
import type { ExtractionFailure } from '.';

const KEYS: Record<ExtractionFailure, MessageKey> & Partial<Record<string, MessageKey>> = {
  restricted: 'extractFailedRestricted',
  'no-access': 'extractFailedNoAccess',
  empty: 'extractFailedEmpty',
  unreadable: 'extractFailedUnreadable',
};

/** Localised text for a failure reason stored in `Pin.failureReason`. */
export function extractionFailureMessage(reason: string): string {
  return t(KEYS[reason] ?? 'extractFailedUnreadable');
}
