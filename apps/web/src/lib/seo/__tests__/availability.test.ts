import { classifyAvailability } from '../availability';

const signedOut = async () => undefined;
const viewer = (status: number | null) => async () => status;

describe('classifyAvailability', () => {
  it('is public when the anonymous API answers 2xx (and never asks as the viewer)', async () => {
    const ask = jest.fn(signedOut);
    expect(await classifyAvailability(200, ask)).toBe('public');
    expect(ask).not.toHaveBeenCalled();
  });
  it('is unavailable when the API is down, never missing', async () => {
    expect(await classifyAvailability(null, signedOut)).toBe('unavailable');
    expect(await classifyAvailability(502, signedOut)).toBe('unavailable');
    expect(await classifyAvailability(429, signedOut)).toBe('unavailable');
  });
  it('is missing for a 4xx when nobody is signed in', async () => {
    expect(await classifyAvailability(404, signedOut)).toBe('missing');
    expect(await classifyAvailability(403, signedOut)).toBe('missing');
    expect(await classifyAvailability(400, signedOut)).toBe('missing');
  });
  it('is restricted when the signed-in viewer may see it (their private video)', async () => {
    expect(await classifyAvailability(404, viewer(200))).toBe('restricted');
  });
  it('is missing when the signed-in viewer may not see it either', async () => {
    expect(await classifyAvailability(404, viewer(404))).toBe('missing');
    expect(await classifyAvailability(404, viewer(401))).toBe('missing');
  });
  it('is unavailable when the signed-in lookup fails', async () => {
    expect(await classifyAvailability(404, viewer(null))).toBe('unavailable');
    expect(await classifyAvailability(404, viewer(503))).toBe('unavailable');
  });
});
