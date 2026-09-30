/** Whether a `scripting.executeScript` error means the extension lacks access to the tab. */
// Chrome: "Cannot access contents of …"; Firefox: "Missing host permission for the tab".
export function isAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot access|permission|cannot be scripted/i.test(message);
}
