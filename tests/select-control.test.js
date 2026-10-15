import test from "node:test";
import assert from "node:assert/strict";
import { keepSelectOpenAfterMouseClick } from "../src/select-control.js";

function fakeSelect({ supportsPicker = true } = {}) {
  const listeners = new Map();
  const select = {
    focused: false,
    pickerCalls: 0,
    addEventListener(type, listener) { listeners.set(type, listener); },
    focus() { this.focused = true; }
  };
  if (supportsPicker) select.showPicker = function () { this.pickerCalls += 1; };
  return { select, dispatch(type, event = {}) { listeners.get(type)?.(event); } };
}

function pointerEvent(overrides = {}) {
  return { pointerType: "mouse", button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
}

test("mouse click opens a native select only after release", () => {
  const control = fakeSelect();
  keepSelectOpenAfterMouseClick(control.select);
  const down = pointerEvent();
  control.dispatch("pointerdown", down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(control.select.focused, true);
  assert.equal(control.select.pickerCalls, 0);

  const click = pointerEvent();
  control.dispatch("click", click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(control.select.pickerCalls, 1);
});

test("touch, keyboard and browsers without showPicker retain native behaviour", () => {
  const control = fakeSelect();
  keepSelectOpenAfterMouseClick(control.select);
  const touch = pointerEvent({ pointerType: "touch" });
  control.dispatch("pointerdown", touch);
  control.dispatch("click", pointerEvent());
  assert.equal(touch.defaultPrevented, false);
  assert.equal(control.select.pickerCalls, 0);

  const unsupported = fakeSelect({ supportsPicker: false });
  assert.equal(keepSelectOpenAfterMouseClick(unsupported.select), unsupported.select);
  assert.equal(unsupported.select.focused, false);
});
