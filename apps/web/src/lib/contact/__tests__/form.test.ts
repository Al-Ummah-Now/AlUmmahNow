import { CONTACT_LIMITS, capturePageUrl, fill, topicFromParam, validateContactForm } from '../form';

const ok = { name: 'Amina', email: 'amina@example.org', topic: 'general' as const, message: 'A question about playlists.' };

describe('validateContactForm', () => {
  it('accepts a complete form', () => {
    expect(validateContactForm(ok)).toEqual({});
  });

  it('reports each missing or bad field', () => {
    expect(validateContactForm({ name: ' ', email: 'nope', topic: '', message: 'short' })).toEqual({
      name: 'required',
      email: 'invalid',
      topic: 'required',
      message: 'tooShort',
    });
  });

  it('applies the same limits as admin-api', () => {
    expect(validateContactForm({ ...ok, name: 'n'.repeat(CONTACT_LIMITS.nameMax + 1) }).name).toBe('tooLong');
    expect(validateContactForm({ ...ok, message: 'm'.repeat(CONTACT_LIMITS.messageMax + 1) }).message).toBe('tooLong');
    expect(validateContactForm({ ...ok, message: 'm'.repeat(CONTACT_LIMITS.messageMax) })).toEqual({});
  });
});

describe('page and topic capture', () => {
  const origin = 'https://videos.alummahnow.net';
  it('prefers ?from=, falls back to a same-site referrer, never another site or the contact page', () => {
    expect(capturePageUrl('/en/video/abc?t=10', 'https://videos.alummahnow.net/en', origin)).toBe(`${origin}/en/video/abc?t=10`);
    expect(capturePageUrl(null, `${origin}/ar/settings`, origin)).toBe(`${origin}/ar/settings`);
    expect(capturePageUrl('https://evil.example/x', 'https://google.com/', origin)).toBe('');
    expect(capturePageUrl(null, `${origin}/en/contact`, origin)).toBe('');
  });

  it('reads only known topics', () => {
    expect(topicFromParam('problem')).toBe('problem');
    expect(topicFromParam('sales')).toBe('');
    expect(topicFromParam(null)).toBe('');
  });

  it('fills placeholders', () => {
    expect(fill('At least {min}, at most {max} ({x})', { min: 10, max: 5000 })).toBe('At least 10, at most 5000 ({x})');
  });
});
