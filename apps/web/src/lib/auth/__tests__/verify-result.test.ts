/**
 * A forged or tampered token must never yield an identity on the web app (security audit):
 *  - verificationFailed: openauth's errors have no enumerable keys, so the old
 *    `Object.keys(err).length > 0` test let every failed verify through;
 *  - authenticated(): the legacy-cookie path then read the unverified payload (any id, any roles);
 *  - verifiedUserId: the error-ingest proxy vouches only for a verified token's subject.
 */
import { InvalidAccessTokenError } from "@al-ummah-now/openauth/error";

const mockVerify = jest.fn();
const mockCookies = new Map<string, string>();

jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mockCookies.has(name) ? { name, value: mockCookies.get(name)! } : undefined),
    set: jest.fn(),
    delete: jest.fn(),
  }),
  headers: async () => new Headers(),
}));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("../openauth-client", () => ({ getOpenAuthClient: () => ({ verify: mockVerify }) }));
jest.mock("../session-manager", () => ({ SessionManager: { getActiveSession: async () => null } }));
jest.mock("../../auth", () => ({ subjects: {}, setTokens: jest.fn() }));

import { verificationFailed, verifiedUserId } from "../verify-result";
import { authenticated } from "../../actions";
import { SessionInfrastructureError } from "../../errors/server-report";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A token anyone can write: a Super Admin payload with no valid signature. */
const forged = `${b64({ alg: "ES256", typ: "JWT" })}.${b64({ mode: "access", type: "user", properties: { id: "usr_owner", email: "owner@example.com", roles: ["Super Admin"] } })}.c2lnbmF0dXJl`;

describe("verificationFailed", () => {
  it("treats openauth's error classes as failures (they have no enumerable keys)", () => {
    const err = new InvalidAccessTokenError();
    expect(Object.keys(err)).toHaveLength(0);
    expect(verificationFailed({ err })).toBe(true);
  });

  it("treats a result without a subject as a failure", () => {
    expect(verificationFailed({})).toBe(true);
    expect(verificationFailed(null)).toBe(true);
  });

  it("passes a verified subject", () => {
    expect(verificationFailed({ subject: { type: "user", properties: { id: "usr_a" } } })).toBe(false);
  });
});

describe("authenticated() with a legacy access_token cookie", () => {
  beforeEach(() => {
    mockCookies.clear();
    mockVerify.mockReset();
  });

  it("refuses a forged token: no identity from its unverified payload", async () => {
    mockCookies.set("access_token", forged);
    mockVerify.mockResolvedValue({ err: new InvalidAccessTokenError() });
    await expect(authenticated()).resolves.toBe(false);
  });

  it("propagates a verification outage without using the unverified payload", async () => {
    mockCookies.set("access_token", forged);
    mockVerify.mockRejectedValue(new TypeError("JWKS fetch failed"));
    await expect(authenticated()).rejects.toBeInstanceOf(SessionInfrastructureError);
  });

  it("returns the verified subject, not the token payload", async () => {
    mockCookies.set("access_token", forged);
    const subject = { type: "user", properties: { id: "usr_real", email: "real@example.com" } };
    mockVerify.mockResolvedValue({ subject });
    await expect(authenticated()).resolves.toEqual(subject);
  });
});

describe("verifiedUserId", () => {
  it("vouches for nobody when the token does not verify", async () => {
    await expect(verifiedUserId(forged, async () => ({ err: new InvalidAccessTokenError() }))).resolves.toBeNull();
    await expect(verifiedUserId(forged, async () => { throw new Error("signature"); })).resolves.toBeNull();
    await expect(verifiedUserId(undefined, async () => ({ subject: { properties: { id: "usr_a" } } }))).resolves.toBeNull();
  });

  it("returns the verified token's id", async () => {
    await expect(verifiedUserId("t", async () => ({ subject: { properties: { id: "usr_a" } } }))).resolves.toBe("usr_a");
  });
});
