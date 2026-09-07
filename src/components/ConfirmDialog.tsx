import { useEffect, useRef } from 'react';

/** One thing the reader can do about it. Order is the order they appear. */
export interface ConfirmChoice {
  label: string;
  onChoose: () => void;
  /** The one the dialog opens focused on, and the one it treats as the answer. */
  primary?: boolean;
}

/**
 * A question the app has to ask before it destroys something.
 *
 * The browser's own `confirm` is fine for deleting a named record that an
 * export can bring back — which is what the three delete prompts guard. It is
 * not enough here: discarding work that was never saved is the more expensive
 * of the two, and `confirm` can offer only OK and Cancel, where the useful
 * answer is "save it first".
 *
 * `alertdialog` rather than `dialog`: it interrupts to ask something, and the
 * distinction is what tells a screen reader to announce the question rather
 * than wait to be explored.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  choices,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  open: boolean;
  title: string;
  body: string;
  choices: ConfirmChoice[];
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      // Escape is the answer that changes nothing, always.
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    // Focus lands on the safe choice, not on the destructive one — a stray
    // Return should not be what clears an adviser's afternoon.
    if (open) (first.current ?? panel.current)?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-confirm"
        onClick={onCancel}
        // Named for what it is rather than for the button beside it: two
        // controls answering to "Cancel" is one for a reader to choose
        // between, and this one is the whole screen behind the question.
        aria-label="Dismiss without changing anything"
      />
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        ref={panel}
        tabIndex={-1}
      >
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-body">{body}</p>
        <div className="confirm-actions">
          {choices.map((choice, i) => (
            <button
              key={choice.label}
              type="button"
              ref={i === 0 ? first : undefined}
              className={choice.primary === true ? 'confirm-primary' : undefined}
              onClick={choice.onChoose}
            >
              {choice.label}
            </button>
          ))}
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </>
  );
}
