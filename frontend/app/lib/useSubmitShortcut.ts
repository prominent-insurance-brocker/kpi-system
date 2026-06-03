import { RefObject, useEffect } from 'react';

interface Options {
  // When false the listener is skipped. Forms that only mount inside a Dialog
  // can leave this as the default true since the hook's lifetime is already
  // bounded by the dialog being open; pages with always-mounted forms (or
  // multiple stacked modals) can flip it off.
  enabled?: boolean;
}

// TED-484: Ctrl+Enter on Windows/Linux, Cmd+Enter on Mac submits the modal's
// form — same as clicking the Create/Save/Update button. requestSubmit() is
// used so the form's onSubmit handler fires AND HTML5 validation runs (unlike
// .submit() which bypasses it).
export function useSubmitShortcut(
  formRef: RefObject<HTMLFormElement | null>,
  options: Options = {},
) {
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    function handler(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      if (!e.ctrlKey && !e.metaKey) return;
      // Shift+Enter is the textarea newline; Alt+Enter has OS-level meaning.
      if (e.shiftKey || e.altKey) return;

      const form = formRef.current;
      if (!form) return;

      e.preventDefault();
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, formRef]);
}
