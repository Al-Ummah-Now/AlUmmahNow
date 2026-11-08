import type { Model } from './model.ts';
import { generateSwift } from './generators/swift.ts';
import { generateKotlin } from './generators/kotlin.ts';
import { generateWinui } from './generators/winui.ts';
import { generateGtk } from './generators/gtk.ts';
import { generateTizen } from './generators/tizen.ts';
import { generateWeb } from './generators/web.ts';

/** Every generated file, keyed by its path under generated/. */
export function generateAll(model: Model): Record<string, string> {
  const files = {
    ...generateSwift(model),
    ...generateKotlin(model),
    ...generateWinui(model),
    ...generateGtk(model),
    ...generateTizen(model),
    ...generateWeb(model),
  };
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}
