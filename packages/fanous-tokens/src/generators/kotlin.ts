import { HEADER, type Model } from '../model.ts';

const num = (n: number) => (Number.isInteger(n) ? `${n}` : String(n));
const color = (hex: string) => `Color(0xFF${hex.slice(1).toUpperCase()})`;
const dpObject = (name: string, items: { name: string; value: number }[]) =>
  `object Fanous${name} {\n${items.map((i) => `    val ${i.name} = ${num(i.value)}.dp`).join('\n')}\n}`;

export function generateKotlin(m: Model): Record<string, string> {
  const colorSet = (name: string, colors: Model['themes']['dark']) =>
    `val ${name} = FanousColors(\n${colors.map((c) => `    ${c.name} = ${color(c.hex)}`).join(',\n')},\n)`;
  const typeObject = (name: string, styles: Model['typography']['latin']) =>
    `object ${name} {\n${styles.map((s) => `    val ${s.name} = TextStyle(fontSize = ${num(s.size)}.sp, fontWeight = FontWeight(${s.weight}), lineHeight = ${num(Math.round(s.size * s.lineHeight * 100) / 100)}.sp, letterSpacing = ${num(s.letterSpacing)}.sp)`).join('\n')}\n}`;
  const source = `// ${HEADER}
package net.alummahnow.fanous

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Immutable
data class FanousColors(
${m.themes.dark.map((c) => `    val ${c.name}: Color`).join(',\n')},
)

${colorSet('FanousDarkColors', m.themes.dark)}

${colorSet('FanousLightColors', m.themes.light)}

object FanousBrand {
${m.brand.map((b) => `    val ${b.name} = ${color(b.value)}`).join('\n')}
}

${typeObject('FanousLatinType', m.typography.latin)}

${typeObject('FanousArabicType', m.typography.arabic)}

data class FanousFontPair(val latin: List<String>, val arabic: List<String>)

object FanousFontPairs {
${m.fontPairs.map((p) => `    val ${p.name} = FanousFontPair(listOf(${p.latin.map((f) => JSON.stringify(f)).join(', ')}), listOf(${p.arabic.map((f) => JSON.stringify(f)).join(', ')}))`).join('\n')}
    val active = ${m.activePair}
}

object FanousNumerals {
${m.numerals.map((n) => `    const val ${n.name} = "${n.value}"`).join('\n')}
}

${dpObject('Spacing', m.spacing)}

${dpObject('Radius', m.radius)}

${dpObject('Focus', m.focus)}

${dpObject('Tv', m.tv)}

${dpObject('Layout', m.layout)}

object FanousDuration {
${m.duration.map((d) => `    const val ${d.name}Ms = ${d.value}`).join('\n')}

    /** The duration to animate for, honouring the reduced-motion setting. */
    fun resolve(valueMs: Int, reduceMotion: Boolean): Int = if (reduceMotion) instantMs else valueMs
}

object FanousEasing {
${m.easing.map((e) => `    val ${e.name} = CubicBezierEasing(${e.value.map((v) => `${num(v)}f`).join(', ')})`).join('\n')}
}

object FanousElevation {
${m.elevation.map((e) => `    val ${e.name} = ${num(e.y + e.blur / 2)}.dp`).join('\n')}
}

val LocalFanousColors = staticCompositionLocalOf { FanousDarkColors }

/** Provides the Fanous colours. Night is the default, so dark applies unless the system is light. */
@Composable
fun FanousTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalFanousColors provides if (darkTheme) FanousDarkColors else FanousLightColors,
        content = content,
    )
}
`;
  return { 'kotlin/net/alummahnow/fanous/FanousTokens.kt': source };
}
