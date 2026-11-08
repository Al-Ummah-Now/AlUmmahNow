import { HEADER, kebab, rgb, type Model, type ThemeColor } from '../model.ts';

const vars = (colors: ThemeColor[]) => colors.map((c) => `  --fanous-color-${kebab(c.name)}: ${c.hex};`).join('\n');
const stack = (families: string[]) => families.map((f) => (/\s/.test(f) ? `'${f}'` : f)).join(', ');

export function generateWeb(m: Model): Record<string, string> {
  const px = (prefix: string, items: { name: string; value: number }[]) => items.map((i) => `  --fanous-${prefix}-${kebab(i.name)}: ${i.value}px;`).join('\n');
  const type = (script: string, styles: Model['typography']['latin']) => styles.map((s) => {
    const base = `--fanous-type-${script}-${kebab(s.name)}`;
    return `  ${base}-size: ${s.size}px;\n  ${base}-weight: ${s.weight};\n  ${base}-line-height: ${s.lineHeight};\n  ${base}-letter-spacing: ${s.letterSpacing}px;`;
  }).join('\n');
  const active = m.fontPairs.find((p) => p.name === m.activePair)!;
  const css = `/* ${HEADER} */
:root {
${m.brand.map((b) => `  --fanous-brand-${kebab(b.name)}: ${b.value};`).join('\n')}
  --fanous-font-latin: ${stack(active.latin)};
  --fanous-font-arabic: ${stack(active.arabic)};
${m.fontPairs.flatMap((p) => [`  --fanous-font-${kebab(p.name)}-latin: ${stack(p.latin)};`, `  --fanous-font-${kebab(p.name)}-arabic: ${stack(p.arabic)};`]).join('\n')}
${type('latin', m.typography.latin)}
${type('arabic', m.typography.arabic)}
${px('spacing', m.spacing)}
${px('radius', m.radius)}
${m.elevation.map((e) => `  --fanous-elevation-${e.name}: ${e.x}px ${e.y}px ${e.blur}px ${e.spread}px rgb(${rgb(e.hex).join(' ')} / ${e.alpha});`).join('\n')}
${m.duration.map((d) => `  --fanous-duration-${kebab(d.name)}: ${d.value}ms;`).join('\n')}
${m.easing.map((e) => `  --fanous-easing-${kebab(e.name)}: cubic-bezier(${e.value.join(', ')});`).join('\n')}
${px('focus', m.focus)}
${px('tv', m.tv)}
${px('layout', m.layout)}
}

@media (prefers-reduced-motion: reduce) {
  :root {
${m.duration.filter((d) => d.name !== 'instant').map((d) => `    --fanous-duration-${kebab(d.name)}: 0ms;`).join('\n')}
  }
}

/* Dark (night) is the default theme. */
:root,
[data-fanous-theme='dark'] {
${vars(m.themes.dark)}
}

[data-fanous-theme='light'] {
${vars(m.themes.light)}
}
`;
  const colors = Object.fromEntries(m.themes.dark.map((c) => [c.name, `var(--fanous-color-${kebab(c.name)})`]));
  const scale = (prefix: string, items: { name: string }[]) => Object.fromEntries(items.map((i) => [i.name, `var(--fanous-${prefix}-${kebab(i.name)})`]));
  const preset = {
    theme: {
      extend: {
        colors: { fanous: colors },
        spacing: Object.fromEntries(m.spacing.map((s) => [`fanous-${s.name}`, `var(--fanous-spacing-${kebab(s.name)})`])),
        borderRadius: Object.fromEntries(m.radius.map((r) => [`fanous-${r.name}`, `var(--fanous-radius-${kebab(r.name)})`])),
        boxShadow: Object.fromEntries(m.elevation.map((e) => [`fanous-${e.name}`, `var(--fanous-elevation-${e.name})`])),
        transitionDuration: Object.fromEntries(Object.entries(scale('duration', m.duration)).map(([k, v]) => [`fanous-${k}`, v])),
        transitionTimingFunction: Object.fromEntries(Object.entries(scale('easing', m.easing)).map(([k, v]) => [`fanous-${k}`, v])),
      },
    },
  };
  const brand = Object.fromEntries(m.brand.map((b) => [b.name, b.value]));
  return {
    'web/tokens.css': css,
    'web/tailwind-preset.cjs': `// ${HEADER}\nmodule.exports = ${JSON.stringify(preset, null, 2)};\n`,
    'web/brand.cjs': `// ${HEADER}\nmodule.exports = ${JSON.stringify(brand, null, 2)};\n`,
  };
}
