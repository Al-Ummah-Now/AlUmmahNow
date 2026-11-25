/** Channel moves' switch, read before anything else on their pages, signed in or out. */
const mockAuth = jest.fn();
const mockFeatures = jest.fn();
jest.mock('@/lib/api/server-auth', () => ({ getServerAuthContext: () => mockAuth() }));
jest.mock('@/lib/features/server', () => ({ getFeatures: () => mockFeatures() }));
jest.mock('@/lib/api/api-client', () => ({ buildApiUrl: (path: string) => `https://api.test${path}` }));

import { channelMovesOff } from '../moves-server';

const answers = (status: number) => jest.fn(async () => ({ status })) as unknown as jest.MockedFunction<typeof fetch>;

describe('channelMovesOff', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockFeatures.mockReset();
  });

  it('signed in: the account’s features, and the gate is not asked', async () => {
    mockAuth.mockResolvedValue({ userId: 'u1' });
    const gate = answers(401);
    for (const channelMove of [true, false]) {
      mockFeatures.mockResolvedValue({ channelMove });
      expect(await channelMovesOff(gate)).toBe(!channelMove);
    }
    expect(gate).not.toHaveBeenCalled();
  });

  it('signed out: on only when the API asks to sign in; off, refused or unreachable is off', async () => {
    mockAuth.mockResolvedValue(null);
    const on = answers(401);
    expect(await channelMovesOff(on)).toBe(false);
    expect((on.mock.calls[0] as unknown[])[0]).toBe('https://api.test/api/move-offers');
    for (const status of [404, 429, 500, 200]) expect(await channelMovesOff(answers(status))).toBe(true);
    expect(await channelMovesOff(jest.fn().mockRejectedValue(new Error('down')) as never)).toBe(true);
    expect(mockFeatures).not.toHaveBeenCalled();
  });
});
