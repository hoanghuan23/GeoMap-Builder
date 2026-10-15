/**
 * Native selects normally open on pointer-down. In some Chromium/Linux
 * combinations the following mouse-up is treated as a selection and closes
 * the popup immediately. Open it from the completed click instead so the
 * option list remains visible. Keyboard, touch and unsupported browsers keep
 * their native behaviour.
 */
export function keepSelectOpenAfterMouseClick(select) {
  if (typeof select?.showPicker !== "function") return select;

  let pendingMouseClick = false;
  select.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    pendingMouseClick = true;
    event.preventDefault();
    select.focus({ preventScroll: true });
  });
  select.addEventListener("pointercancel", () => { pendingMouseClick = false; });
  select.addEventListener("click", event => {
    if (!pendingMouseClick) return;
    pendingMouseClick = false;
    event.preventDefault();
    select.showPicker();
  });
  return select;
}
