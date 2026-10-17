/**
 * Disable browser/Android autofill, password-manager suggestions and keyboard
 * autocorrect on every input, including ones created later (palette, dialogs,
 * settings, ...).
 */
export function disableInputAssistance(): void {
  const apply = (element: Element): void => {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      return;
    }
    element.setAttribute("autocomplete", "off");
    element.setAttribute("autocorrect", "off");
    element.setAttribute("autocapitalize", "off");
    element.setAttribute("spellcheck", "false");
    element.setAttribute("data-lpignore", "true");
    element.setAttribute("data-1p-ignore", "true");
    element.setAttribute("data-bwignore", "true");
    element.setAttribute("data-form-type", "other");
    element.setAttribute("aria-autocomplete", "none");
  };

  document.querySelectorAll("input, textarea").forEach(apply);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("input, textarea")) apply(node);
        node.querySelectorAll("input, textarea").forEach(apply);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
