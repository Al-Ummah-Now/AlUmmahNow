import { HEADER, kebab, snake, type Model, type ThemeColor } from '../model.ts';

// libadwaita named colours overridden by the theme. Everything else derives from these.
const ADW: Record<string, string> = {
  window_bg_color: 'background', window_fg_color: 'textPrimary',
  view_bg_color: 'surface', view_fg_color: 'textPrimary',
  card_bg_color: 'surface', card_fg_color: 'textPrimary',
  dialog_bg_color: 'surfaceRaised', dialog_fg_color: 'textPrimary',
  popover_bg_color: 'surfaceRaised', popover_fg_color: 'textPrimary',
  headerbar_bg_color: 'background', headerbar_fg_color: 'textPrimary',
  accent_bg_color: 'primary', accent_fg_color: 'onPrimary', accent_color: 'accent',
  destructive_bg_color: 'errorFill', destructive_fg_color: 'onErrorFill', destructive_color: 'errorText',
  success_bg_color: 'verifiedFill', success_fg_color: 'onVerifiedFill', success_color: 'successText',
  error_bg_color: 'errorFill', error_fg_color: 'onErrorFill', error_color: 'errorText',
};

function colors(list: ThemeColor[]): string {
  const byName = new Map(list.map((c) => [c.name, c.hex]));
  return [
    ...list.map((c) => `@define-color fanous_${snake(c.name)} ${c.hex};`),
    '',
    ...Object.entries(ADW).map(([adw, token]) => `@define-color ${adw} ${byName.get(token)};`),
  ].join('\n');
}

export function generateGtk(m: Model): Record<string, string> {
  const type = (prefix: string, styles: Model['typography']['latin']) => styles.map((s) =>
    `.fanous-${prefix}-${kebab(s.name)} { font-size: ${s.size}px; font-weight: ${s.weight}; line-height: ${s.lineHeight}; letter-spacing: ${s.letterSpacing}px; }`).join('\n');
  const shared = `${m.radius.map((r) => `.fanous-radius-${kebab(r.name)} { border-radius: ${r.value}px; }`).join('\n')}

${type('latin', m.typography.latin)}
${type('arabic', m.typography.arabic)}

.fanous-focus:focus-visible { outline: ${m.focus.find((f) => f.name === 'ringWidth')!.value}px solid @fanous_focus_ring; outline-offset: ${m.focus.find((f) => f.name === 'ringOffset')!.value}px; }
`;
  // AdwApplication loads style.css always and adds style-dark.css in dark mode.
  return {
    'gtk/style.css': `/* ${HEADER} */\n${colors(m.themes.light)}\n\n${shared}`,
    'gtk/style-dark.css': `/* ${HEADER} */\n${colors(m.themes.dark)}\n`,
  };
}
