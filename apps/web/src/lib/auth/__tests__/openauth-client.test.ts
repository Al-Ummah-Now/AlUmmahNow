/**
 * Session checks must reuse one OpenAuth client per isolate: the client holds
 * the issuer's discovery/JWKS cache, so a client per call meant two auth
 * worker fetches per page view.
 */
const mockVerify = jest.fn();
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ verify: mockVerify }));
const mockWarn = jest.fn();
jest.mock("@/lib/logger-server", () => ({ logger: { warn: (...args: unknown[]) => mockWarn(...args), debug: jest.fn(), info: jest.fn(), error: jest.fn() } }));
// jest.mock is hoisted above the const, so the factory must defer the lookup.
jest.mock("@al-ummah-now/openauth/client", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { FIRST_PARTY_CLIENT_IDS } from "@al-ummah/shared-types";
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

// Security audit 2026-11-14: the session's access token must have been issued to the web client
describe("getOpenAuthClient audience check", () => {
  const env = process.env;
  const PROD = FIRST_PARTY_CLIENT_IDS.production;
  const subject = { type: "user", properties: { id: "usr_a" } };
  beforeEach(() => {
    process.env = { ...env, ClientId: PROD.web, Issuer: "https://auth.alummahnow.net" };
    mockVerify.mockReset();
    mockWarn.mockClear();
    __resetOpenAuthClientForTests();
  });
  afterAll(() => {
    process.env = env;
  });

  it("passes the web client's own token through, without a log", async () => {
    mockVerify.mockResolvedValue({ aud: PROD.web, subject });
    await expect(getOpenAuthClient().verify({} as never, "tok")).resolves.toEqual({ aud: PROD.web, subject });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("log mode: another client's token still verifies and the log has its id, never the token", async () => {
    mockVerify.mockResolvedValue({ aud: PROD.adminWeb, subject });
    await expect(getOpenAuthClient().verify({} as never, "secret-token")).resolves.toEqual({ aud: PROD.adminWeb, subject });
    expect(mockWarn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: "aud_mismatch", service: "web", mode: "log", clientId: PROD.adminWeb, client: "adminWeb@production" }));
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain("secret-token");
  });

  it("enforce mode: another client's token is a verify error", async () => {
    process.env.AUD_MODE = "enforce";
    mockVerify.mockResolvedValue({ aud: PROD.www, subject });
    const result = await getOpenAuthClient().verify({} as never, "tok");
    expect(result).toEqual({ err: expect.objectContaining({ name: "AudienceMismatchError" }) });
  });

  it("a failed verify passes through untouched", async () => {
    process.env.AUD_MODE = "enforce";
    const err = new Error("expired");
    mockVerify.mockResolvedValue({ err });
    await expect(getOpenAuthClient().verify({} as never, "tok")).resolves.toEqual({ err });
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
