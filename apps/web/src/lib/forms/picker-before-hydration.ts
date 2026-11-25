/**
 * A file picker's button works before the page has hydrated.
 *
 * A server-rendered form shows its Change photo button before React has attached onClick; a click
 * in that moment did nothing, and the person waited for a dialog that never came. Buttons that open
 * a file input name it: data-file-picker="<input id>". Inline in <head>, this opens the picker for
 * buttons React has not hydrated yet and stops the event there (React, replaying it while it
 * hydrates, would open a second one). Hydrated buttons are left to their own onClick.
 */
export const PICKER_BEFORE_HYDRATION_SCRIPT = `document.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('[data-file-picker]');if(!b||b.disabled)return;for(var k in b){if(k.indexOf('__reactProps$')===0)return}var i=document.getElementById(b.getAttribute('data-file-picker'));if(!i)return;e.preventDefault();e.stopImmediatePropagation();i.click()},true);`;

/** Opens the file input a picker button names. */
export function openFilePicker(inputId: string): void {
  document.getElementById(inputId)?.click();
}
