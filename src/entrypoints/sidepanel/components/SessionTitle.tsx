import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';

interface Props {
  /** The title as displayed (already resolved to the fallback when empty). */
  title: string;
  /** Called with the trimmed new title; only when it's non-empty and changed. */
  onRename: (title: string) => void;
}

/**
 * The session title with inline rename (D11). Activating the title turns it
 * into a text field: Enter or leaving the field saves, Escape cancels. An
 * empty or unchanged title keeps the current one.
 */
export function SessionTitle({ title, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const start = () => {
    setDraft(title);
    setEditing(true);
  };

  const finish = (save: boolean, returnFocus: boolean) => {
    if (!editing) return;
    refocus.current = returnFocus;
    setEditing(false);
    const next = draft.trim();
    if (save && next !== '' && next !== title) onRename(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        class="session-title-input"
        type="text"
        aria-label={t('sessionTitleLabel')}
        value={draft}
        onInput={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true, true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false, true);
          }
        }}
        onBlur={() => {
          finish(true, false);
        }}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      class="session-title"
      title={t('renameSession')}
      aria-label={`${t('sessionTitleLabel')}: ${title}`}
      onClick={start}
    >
      {title}
    </button>
  );
}
