import { HEADER, pascal, rgb, unit, type Model } from '../model.ts';

const f = (v: string | number) => `${v}f`;
const color = (hex: string) => { const [r, g, b] = rgb(hex); return `new Color(${f(unit(r))}, ${f(unit(g))}, ${f(unit(b))}, 1f)`; };
const ints = (name: string, items: { name: string; value: number }[], type = 'int') =>
  `    public static class ${name}\n    {\n${items.map((i) => `        public const ${type} ${pascal(i.name)} = ${i.value};`).join('\n')}\n    }`;

export function generateTizen(m: Model): Record<string, string> {
  // Tizen.NUI.Color is mutable and disposable, so each read returns a new instance.
  const theme = (name: string, colors: Model['themes']['dark']) =>
    `    public static class ${name}\n    {\n${colors.map((c) => `        public static Color ${pascal(c.name)} => ${color(c.hex)};`).join('\n')}\n    }`;
  const type = (name: string, styles: Model['typography']['latin']) =>
    `    public static class ${name}\n    {\n${styles.map((s) => `        public static readonly FanousTextStyle ${pascal(s.name)} = new FanousTextStyle(${f(s.size)}, ${s.weight}, ${f(s.lineHeight)}, ${f(s.letterSpacing)});`).join('\n')}\n    }`;
  const source = `// ${HEADER}
using Tizen.NUI;

namespace AlUmmahNow.Fanous
{
    public readonly struct FanousTextStyle
    {
        public readonly float Size;
        public readonly int Weight;
        public readonly float LineHeight;
        public readonly float LetterSpacing;

        public FanousTextStyle(float size, int weight, float lineHeight, float letterSpacing)
        {
            Size = size;
            Weight = weight;
            LineHeight = lineHeight;
            LetterSpacing = letterSpacing;
        }
    }

${theme('DarkColors', m.themes.dark)}

${theme('LightColors', m.themes.light)}

${theme('BrandColors', m.brand.map((b) => ({ name: b.name, hex: b.value, role: 'surface' as const })))}

${type('LatinType', m.typography.latin)}

${type('ArabicType', m.typography.arabic)}

    public static class FontPairs
    {
${m.fontPairs.flatMap((p) => [`        public static readonly string[] ${pascal(p.name)}Latin = { ${p.latin.map((v) => JSON.stringify(v)).join(', ')} };`, `        public static readonly string[] ${pascal(p.name)}Arabic = { ${p.arabic.map((v) => JSON.stringify(v)).join(', ')} };`]).join('\n')}
        public const string Active = "${m.activePair}";
    }

    public static class Numerals
    {
${m.numerals.map((n) => `        public const string ${pascal(n.name)} = "${n.value}";`).join('\n')}
    }

${ints('Spacing', m.spacing)}

${ints('Radius', m.radius)}

${ints('Focus', m.focus)}

${ints('Tv', m.tv)}

${ints('Layout', m.layout)}

${ints('DurationMs', m.duration)}

    public static class Easing
    {
${m.easing.map((e) => `        public static readonly float[] ${pascal(e.name)} = { ${e.value.map(f).join(', ')} };`).join('\n')}
    }
}
`;
  return { 'tizen/FanousTokens.cs': source };
}
