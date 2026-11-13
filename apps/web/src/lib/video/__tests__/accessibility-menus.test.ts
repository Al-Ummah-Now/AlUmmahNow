/**
 * Story 1.1/1.4 - accessible names for the Video.js quality menu
 * (axe label-content-name-mismatch and aria-required-children findings)
 */
import { labelQualityButton, fixMenuTitle, getAriaLabels } from '../accessibility';

describe('labelQualityButton', () => {
  it('includes the visible quality in the accessible name (Label in Name)', () => {
    document.body.innerHTML = `
      <button id="q" class="vjs-menu-button"><span class="vjs-icon-placeholder" aria-hidden="true">Auto</span></button>`;
    const button = document.getElementById('q')!;
    labelQualityButton(button, 'Video quality');
    expect(button).toHaveAttribute('aria-label', 'Video quality: Auto');
    expect(button).toHaveAttribute('title', 'Video quality');

    button.querySelector('.vjs-icon-placeholder')!.textContent = '720p';
    labelQualityButton(button, 'Video quality');
    expect(button).toHaveAttribute('aria-label', 'Video quality: 720p');
  });

  it('falls back to the base label when no quality is shown yet', () => {
    document.body.innerHTML = '<button id="q"></button>';
    const button = document.getElementById('q')!;
    labelQualityButton(button, 'جودة المرئي');
    expect(button).toHaveAttribute('aria-label', 'جودة المرئي');
  });
});

describe('fixMenuTitle', () => {
  it('names the menu after its title row and hides the non-menuitem title', () => {
    document.body.innerHTML = `
      <ul id="m" class="vjs-menu-content" role="menu">
        <li class="vjs-menu-title" tabindex="-1">Quality</li>
        <li class="vjs-menu-item" role="menuitemradio" tabindex="-1">720p</li>
      </ul>`;
    const menu = document.getElementById('m')!;
    fixMenuTitle(menu);
    const title = menu.querySelector('.vjs-menu-title')!;
    expect(menu).toHaveAttribute('aria-label', 'Quality');
    expect(title).toHaveAttribute('aria-hidden', 'true');
    expect(title).not.toHaveAttribute('tabindex');
  });
});

describe('getAriaLabels', () => {
  it('returns localized labels from the video player i18n system', () => {
    expect(getAriaLabels('en').playButton).toBe('Play video');
    expect(getAriaLabels('ar').playButton).toBe('تشغيل المرئي');
    expect(getAriaLabels('ar').currentTime).toBe('الوقت الحالي');
  });
});
