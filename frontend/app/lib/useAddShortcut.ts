import { useEffect } from 'react';

interface Options {
  // When false the listener is skipped — use this to mirror the same
  // preconditions that disable the page's Add button (e.g. noCurrentTarget,
  // isHodUser, an already-open modal).
  enabled?: boolean;
}

// TED-483: pressing "C" anywhere on a module page opens the same modal the
// page's Add button opens. The listener bails out when modifier keys are held
// (so Ctrl+C still copies) and when focus is inside a form field so the user
// can still type the letter "c" in inputs, textareas, selects, and
// contenteditable surfaces (search boxes, the AI chat input, the entry form).
export function useAddShortcut(callback: () => void, options: Options = {}) {
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    function handler(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'c' && e.key !== 'C') return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }

      e.preventDefault();
      callback();
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [callback, enabled]);
}
