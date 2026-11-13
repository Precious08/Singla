import { useEffect } from 'react';

/** How long a toast stays on screen before it dismisses itself. */
export const TOAST_DURATION_MS = 3500;

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

/**
 * A small floating notification card that hovers over the page at the
 * top-right corner, in the site's own surface colours. It is plain
 * fixed-positioned, so callers render it at the app root, outside every
 * page container: nothing can trap it or shift the layout around it.
 * Tapping the notification or its small close button dismisses it, and
 * it dismisses itself after a few seconds either way.
 */
export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="toast" role="status" onClick={onDismiss}>
      <span className="toast__message">{message}</span>
      <button
        type="button"
        className="toast__close"
        aria-label="Dismiss"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
