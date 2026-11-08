import { singleSignOutNext, startSingleSignOut } from "../single-sign-out"

const ISSUER = "https://auth.alummahnow.net"
const APP = "https://videos.alummahnow.net"

describe("single sign-out", () => {
  it("starts at the auth server and comes back to the app", () => {
    const url = new URL(startSingleSignOut(ISSUER, `${APP}/ar`))
    expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
    expect(url.searchParams.get("return")).toBe(`${APP}/ar`)
  })

  it("follows next back to the auth server's /logout", () => {
    const next = `${ISSUER}/logout?step=2&return=${encodeURIComponent(APP + "/")}`
    expect(singleSignOutNext(ISSUER, next, APP)).toBe(next)
  })

  it("never follows next anywhere else (no open redirect)", () => {
    for (const next of ["https://evil.example/logout", `${ISSUER}/authorize`, "//evil.example", "not a url"]) {
      const url = new URL(singleSignOutNext(ISSUER, next, APP))
      expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
      expect(url.searchParams.get("return")).toBe(`${APP}/`)
    }
  })

  it("starts the chain when opened directly", () => {
    expect(singleSignOutNext(ISSUER, null, APP)).toBe(startSingleSignOut(ISSUER, `${APP}/`))
  })
})
