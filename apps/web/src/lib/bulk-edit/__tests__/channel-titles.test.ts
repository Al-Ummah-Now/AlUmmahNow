import { loadChannelTitles } from '../channel-titles';

jest.mock('@/lib/studio/content-client', () => ({ fetchContentPage: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

const video = (id: string, title: string, ar?: string) => ({ id, title, ...(ar ? { titleLocalized: { en: title, ar } } : {}) });

describe('loadChannelTitles', () => {
  it('reads every status at once and keeps what arrived in time', async () => {
    const started: string[] = [];
    const load = jest.fn((_c: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      started.push(String(params.status));
      if (params.status === 'drafts') {
        // Never answers: cut off by the time limit
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      if (params.status === 'published') return Promise.resolve({ items: [video('a', 'Lesson 36', 'الدرس ٣٦'), video('sel', 'Lesson 99')], cursor: null });
      return Promise.resolve({ items: [video(`x-${params.status}`, `Lesson ${String(params.status).length}`)], cursor: null });
    });
    const titles = await loadChannelTitles('ch', new Set(['sel']), { load: load as never, timeoutMs: 20 });
    expect(started.sort()).toEqual(['drafts', 'failed', 'processing', 'published', 'scheduled']);
    expect(titles).toContain('Lesson 36');
    expect(titles).toContain('الدرس ٣٦');
    expect(titles).not.toContain('Lesson 99');
    expect(titles).toHaveLength(6);
  });

  it('follows the cursor a few pages per status', async () => {
    const load = jest.fn((_c: string, params: Record<string, unknown>) => Promise.resolve(
      params.status === 'published' ? { items: [video(`p${params.cursor ?? 0}`, `T ${params.cursor ?? 0}`)], cursor: String(Number(params.cursor ?? 0) + 1) } : { items: [], cursor: null },
    ));
    const titles = await loadChannelTitles('ch', new Set(), { load: load as never });
    expect(titles).toEqual(['T 0', 'T 1', 'T 2']);
  });
});
