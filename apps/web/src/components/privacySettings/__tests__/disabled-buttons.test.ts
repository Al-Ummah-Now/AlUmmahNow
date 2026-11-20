/**
 * Disabled buttons on the privacy page stay readable (owner 2026-11-20): "Delete my data" was faded
 * with opacity to 2.98:1. Each button takes the theme's disabled pair, which check:tokens keeps at
 * 4.5:1 or more, and never fades its text with opacity.
 */
import { privacyButtonClasses } from '../PrivacySettingsView';

describe('privacy page disabled buttons', () => {
  it.each(Object.entries(privacyButtonClasses))('%s: the disabled pair, no opacity', (name, classes) => {
    expect(classes).not.toMatch(/opacity/);
    const token = name === 'destructive' ? 'destructive' : name;
    expect(classes).toContain(`disabled:bg-[var(--fanous-c-button-${token}-disabled-bg)]`);
    expect(classes).toContain(`disabled:text-[var(--fanous-c-button-${token}-disabled-text)]`);
    expect(classes).toContain('disabled:cursor-not-allowed');
  });

  it('destructive uses the theme pair, not bg-red-* (the bridge restyles those with !important)', () => {
    expect(privacyButtonClasses.destructive).not.toMatch(/\bbg-red-/);
    expect(privacyButtonClasses.destructive).toContain('bg-[var(--fanous-c-button-destructive-bg)]');
  });
});
