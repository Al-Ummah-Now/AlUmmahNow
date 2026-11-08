import { HEADER, pascal, type Model } from '../model.ts';

const ROOT = 'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';
const WEIGHTS: Record<number, string> = { 400: 'Normal', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function generateWinui(m: Model): Record<string, string> {
  const block = (colors: Model['themes']['dark']) => colors.map((c) => `            <Color x:Key="Fanous${pascal(c.name)}Color">${c.hex.toUpperCase().replace('#', '#FF')}</Color>\n            <SolidColorBrush x:Key="Fanous${pascal(c.name)}Brush" Color="{StaticResource Fanous${pascal(c.name)}Color}" />`).join('\n');
  const colors = `<!-- ${HEADER} -->
<ResourceDictionary
    ${ROOT}>
    <ResourceDictionary.ThemeDictionaries>
        <ResourceDictionary x:Key="Default">
${block(m.themes.dark)}
        </ResourceDictionary>
        <ResourceDictionary x:Key="Light">
${block(m.themes.light)}
        </ResourceDictionary>
    </ResourceDictionary.ThemeDictionaries>
${m.brand.map((b) => `    <Color x:Key="FanousBrand${pascal(b.name)}">${b.value.toUpperCase().replace('#', '#FF')}</Color>`).join('\n')}
</ResourceDictionary>
`;
  const doubles = (prefix: string, items: { name: string; value: number }[]) => items.map((i) => `    <x:Double x:Key="Fanous${prefix}${pascal(i.name)}">${i.value}</x:Double>`).join('\n');
  const typeStyles = (prefix: string, styles: Model['typography']['latin']) => styles.map((s) => `    <Style x:Key="Fanous${prefix}${pascal(s.name)}" TargetType="TextBlock">
        <Setter Property="FontSize" Value="${s.size}" />
        <Setter Property="FontWeight" Value="${WEIGHTS[s.weight]}" />
        <Setter Property="LineHeight" Value="${Math.round(s.size * s.lineHeight * 100) / 100}" />
        <Setter Property="CharacterSpacing" Value="${Math.round((s.letterSpacing / s.size) * 1000)}" />
    </Style>`).join('\n');
  const tokens = `<!-- ${HEADER} -->
<ResourceDictionary
    ${ROOT}>
${doubles('Spacing', m.spacing)}
${m.radius.map((r) => `    <CornerRadius x:Key="FanousRadius${pascal(r.name)}">${r.value}</CornerRadius>`).join('\n')}
${doubles('Focus', m.focus)}
${doubles('Tv', m.tv)}
${doubles('Layout', m.layout)}
${m.duration.map((d) => `    <x:Int32 x:Key="FanousDuration${pascal(d.name)}Ms">${d.value}</x:Int32>`).join('\n')}
${m.easing.map((e) => `    <x:String x:Key="FanousEasing${pascal(e.name)}">${e.value.join(',')}</x:String>`).join('\n')}
${m.numerals.map((n) => `    <x:String x:Key="FanousNumerals${pascal(n.name)}">${n.value}</x:String>`).join('\n')}
${m.fontPairs.flatMap((p) => [`    <FontFamily x:Key="FanousFont${pascal(p.name)}Latin">${esc(p.latin[0] === 'system-ui' ? 'Segoe UI Variable' : p.latin[0])}</FontFamily>`, `    <FontFamily x:Key="FanousFont${pascal(p.name)}Arabic">${esc(p.arabic[0] === 'system-ui' ? 'Segoe UI Variable' : p.arabic[0])}</FontFamily>`]).join('\n')}
${typeStyles('Latin', m.typography.latin)}
${typeStyles('Arabic', m.typography.arabic)}
</ResourceDictionary>
`;
  return { 'winui/Fanous.Colors.xaml': colors, 'winui/Fanous.Tokens.xaml': tokens };
}
