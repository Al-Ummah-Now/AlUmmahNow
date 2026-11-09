// Prototype only: turns the built theme into CSS for this app's class-based light and dark.
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('../src/theme/', import.meta.url);
const css = readFileSync(new URL('active/web/tokens.css', here), 'utf8')
  .replace(/:root,\s*\[data-fanous-theme='dark'\]/, 'html.dark')
  .replace("[data-fanous-theme='light']", 'html:not(.dark)');
writeFileSync(new URL('active.css', here), css);
