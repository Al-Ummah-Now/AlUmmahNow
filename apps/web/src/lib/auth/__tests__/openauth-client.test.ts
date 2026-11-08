/**
 * Session checks must reuse one OpenAuth client per isolate: the client holds
 * the issuer's discovery/JWKS cache, so a client per call meant two auth
 * worker fetches per page view.
 */
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ verify: jest.fn() }));
// jest.mock is hoisted above the const, so the factory must defer the lookup.
jest.mock("@al-ummah-now/openauth/client", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { CLIENT_TTL_MS, __resetOpenAuthClientForTests, getOpenAuthClient } from "../openauth-client";

describe("getOpenAuthClient", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, ClientId: "client-1", Issuer: "https://auth.test.example" };
    mockCreateClient.mockClear();
    __resetOpenAuthClientForTests();
  });
  afterAll(() => {
    process.env = env;
  });

  it("creates the client once for many calls", () => {
    const first = getOpenAuthClient();
    for (let i = 0; i < 50; i++) expect(getOpenAuthClient()).toBe(first);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith({ clientID: "client-1", issuer: "https://auth.test.example" });
  });

  it("rebuilds after the TTL", () => {
    let t = 1_000_000;
    const a = getOpenAuthClient(() => t);
    t += CLIENT_TTL_MS;
    expect(getOpenAuthClient(() => t)).not.toBe(a);
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
  });

  it("throws when the wrangler vars are missing", () => {
    delete process.env.ClientId;
    expect(() => getOpenAuthClient()).toThrow(/Auth is not configured/);
  });
});
