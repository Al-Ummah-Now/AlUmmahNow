import { HEADER, rgb, unit, type Model } from '../model.ts';

const WEIGHTS: Record<number, string> = { 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' };
const num = (n: number) => (Number.isInteger(n) ? `${n}` : String(n));
const color = (hex: string) => { const [r, g, b] = rgb(hex); return `Color(.sRGB, red: ${unit(r)}, green: ${unit(g)}, blue: ${unit(b)}, opacity: 1)`; };
const constants = (name: string, items: { name: string; value: number }[]) =>
  `    public enum ${name} {\n${items.map((i) => `        public static let ${i.name}: CGFloat = ${num(i.value)}`).join('\n')}\n    }`;

export function generateSwift(m: Model): Record<string, string> {
  const fields = m.themes.dark.map((c) => `    public let ${c.name}: Color`).join('\n');
  const theme = (colors: Model['themes']['dark']) => colors.map((c) => `        ${c.name}: ${color(c.hex)}`).join(',\n');
  const typeGroup = (name: string, styles: Model['typography']['latin']) =>
    `    public enum ${name} {\n${styles.map((s) => `        public static let ${s.name} = FanousTextStyle(size: ${num(s.size)}, weight: .${WEIGHTS[s.weight]}, lineHeightMultiple: ${num(s.lineHeight)}, letterSpacing: ${num(s.letterSpacing)})`).join('\n')}\n    }`;
  const source = `// ${HEADER}
import SwiftUI

public struct FanousColors: Sendable {
${fields}
}

public struct FanousTextStyle: Sendable {
    public let size: CGFloat
    public let weight: Font.Weight
    public let lineHeightMultiple: CGFloat
    public let letterSpacing: CGFloat

    /// The style in the system font, used until decision D6 selects a font pair.
    public var font: Font { .system(size: size, weight: weight) }
    public func font(family: String) -> Font { .custom(family, size: size).weight(weight) }
    /// Extra line spacing to apply with \`lineSpacing(_:)\` to reach the token line height.
    public var lineSpacing: CGFloat { size * (lineHeightMultiple - 1) }
}

public struct FanousFontPair: Sendable {
    public let latin: [String]
    public let arabic: [String]
}

public struct FanousShadow: Sendable {
    public let color: Color
    public let x: CGFloat
    public let y: CGFloat
    public let radius: CGFloat
}

public enum Fanous {
    public static let dark = FanousColors(
${theme(m.themes.dark)}
    )

    public static let light = FanousColors(
${theme(m.themes.light)}
    )

    public enum Brand {
${m.brand.map((b) => `        public static let ${b.name} = ${color(b.value)}`).join('\n')}
    }

${typeGroup('LatinType', m.typography.latin)}

${typeGroup('ArabicType', m.typography.arabic)}

    public enum FontPairs {
${m.fontPairs.map((p) => `        public static let ${p.name} = FanousFontPair(latin: ${JSON.stringify(p.latin)}, arabic: ${JSON.stringify(p.arabic)})`).join('\n')}
        public static let active = ${m.activePair}
    }

    public enum Numerals {
${m.numerals.map((n) => `        public static let ${n.name} = "${n.value}"`).join('\n')}
    }

${constants('Spacing', m.spacing)}

${constants('Radius', m.radius)}

    public enum Elevation {
${m.elevation.map((e) => `        public static let ${e.name} = FanousShadow(color: ${color(e.hex)}.opacity(${e.alpha}), x: ${e.x}, y: ${e.y}, radius: ${num(e.blur / 2)})`).join('\n')}
    }

    public enum Duration {
${m.duration.map((d) => `        public static let ${d.name}: Double = ${d.value / 1000}`).join('\n')}
    }

    public enum Easing {
${m.easing.map((e) => `        public static func ${e.name}(duration: Double) -> Animation { .timingCurve(${e.value.join(', ')}, duration: duration) }`).join('\n')}
    }

    /// Duration to use for an animation, honouring the reduced-motion setting.
    public static func duration(_ value: Double, reduceMotion: Bool) -> Double { reduceMotion ? Duration.instant : value }

${constants('Focus', m.focus)}

${constants('TV', m.tv)}

${constants('Layout', m.layout)}
}
`;
  const manifest = `// swift-tools-version:5.9
// ${HEADER}
import PackageDescription

let package = Package(
    name: "FanousTokens",
    platforms: [.iOS(.v16), .macOS(.v13), .tvOS(.v16)],
    products: [.library(name: "FanousTokens", targets: ["FanousTokens"])],
    targets: [.target(name: "FanousTokens")]
)
`;
  return { 'swift/Package.swift': manifest, 'swift/Sources/FanousTokens/FanousTokens.swift': source };
}
