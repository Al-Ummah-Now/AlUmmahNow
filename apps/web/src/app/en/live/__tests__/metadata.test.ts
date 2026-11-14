/** /en/live and /ar/live: self-canonical with the en/ar pair, og:url on this site (wiki AUN-SEO #13, D-SEO-1) */
jest.mock('../LivePageClient', () => ({ LivePageClient: () => null }));
jest.mock('../../../ar/live/LivePageClientRTL', () => ({ LivePageClientRTL: () => null }));

import { metadata as en } from '../page';
import { metadata as ar } from '../../../ar/live/page';

describe('live page metadata', () => {
  it('each language is its own canonical with x-default English, and og:url stays on this site', () => {
    expect(en.alternates).toEqual({ canonical: '/en/live', languages: { en: '/en/live', ar: '/ar/live', 'x-default': '/en/live' } });
    expect(ar.alternates?.canonical).toBe('/ar/live');
    expect(en.openGraph?.url).toBe('/en/live');
    expect(JSON.stringify([en, ar])).not.toContain('alummahnow.com');
    expect(en.title).toEqual({ absolute: 'Live Streams | Al Ummah Now' });
    expect(ar.title).toEqual({ absolute: 'البث المباشر | الأمة الآن' });
  });
});
