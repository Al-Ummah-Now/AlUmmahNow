/**
 * Test helper: the player themes as the app ships them. Token names come from the generated
 * CSS the build imports (packages/fanous-tokens/generated-player); values from each theme's
 * player.json. Read from disk because the tokens package is outside this TypeScript project.
 */
import fs from 'fs';
import path from 'path';

const TOKENS_DIR = path.resolve(__dirname, '../../../../packages/fanous-tokens');

/** Every --fanous-player-* name the default theme defines, without the prefix */
export function playerTokenNames(): string[] {
  const css = fs.readFileSync(path.join(TOKENS_DIR, 'generated-player/lantern.css'), 'utf8');
  return Array.from(css.matchAll(/--fanous-player-([a-z-]+):/g), (m) => m[1]);
}

/** Each theme's player tokens, by theme id */
export function loadPlayerThemes(): Record<string, Record<string, string>> {
  const dir = path.join(TOKENS_DIR, 'themes');
  return Object.fromEntries(
    fs.readdirSync(dir)
      .filter((id) => fs.existsSync(path.join(dir, id, 'player.json')))
      .sort()
      .map((id) => [id, JSON.parse(fs.readFileSync(path.join(dir, id, 'player.json'), 'utf8')).player]),
  );
}
