import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const appsDir = join(__dirname, '../../..');
const PRODUCERS = ['api-videos/src', 'admin-api/src', 'scheduler/src'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return /^(__tests__|tests|test)$/.test(name) ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) ? [path] : [];
  });
}

/** A type sent on the queue with no case falls to "Unknown message type", is retried, then dead-lettered. */
describe('every MessageType sent on the queue is consumed', () => {
  const processor = readFileSync(join(__dirname, '../messageProcessor.ts'), 'utf8');
  const produced = new Set(
    PRODUCERS.flatMap((dir) => sourceFiles(join(appsDir, dir))).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\.send\(\s*MessageType\.(\w+)/g)].map((match) => match[1])
    )
  );

  it('finds the producers', () => {
    expect(produced.size).toBeGreaterThan(10);
  });

  it.each([...produced].sort())('%s has a case', (type) => {
    expect(processor).toMatch(new RegExp(`case MessageType\\.${type}\\b`));
  });
});
