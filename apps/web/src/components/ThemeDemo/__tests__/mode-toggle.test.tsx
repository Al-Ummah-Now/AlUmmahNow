/**
 * The header's Light / Dark toggle is the reference for every app (docs/design/NAV.md): the shared
 * markup in packages/fanous-tokens/nav/mode-toggle.js (used by the status page and copied by www,
 * the CMS and Auth) must stay equal to what lucide-react renders here. AppShell takes its names from it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { Moon, Sun } from 'lucide-react';
import { MODE_TOGGLE_LABELS, modeIconSvg, modeToggleLabel } from '../../../../../../packages/fanous-tokens/nav/mode-toggle.js';

/** lucide-react's markup without React's self-closing differences, attribute by attribute. */
const norm = (svg: string) => svg.replace(/\s+focusable="false"/, '').replace(/<(\w+)([^>]*?)\s*\/>/g, '<$1$2></$1>');

describe('shared Light / Dark toggle', () => {
  it('equals lucide-react Sun and Moon exactly', () => {
    expect(norm(modeIconSvg('sun'))).toBe(renderToStaticMarkup(<Sun aria-hidden="true" />));
    expect(norm(modeIconSvg('moon'))).toBe(renderToStaticMarkup(<Moon aria-hidden="true" />));
  });

  it('names the mode it switches to, en and ar (the copies in www, the CMS and Auth use these words)', () => {
    expect(MODE_TOGGLE_LABELS).toEqual({
      en: { toLight: 'Switch to light mode', toDark: 'Switch to dark mode' },
      ar: { toLight: 'التبديل إلى الوضع الفاتح', toDark: 'التبديل إلى الوضع الداكن' },
    });
    expect(modeToggleLabel('en', true)).toBe('Switch to light mode');
    expect(modeToggleLabel('ar', false)).toBe('التبديل إلى الوضع الداكن');
  });
});
