import { singleSignOutNext, singleSignOutToHome, startSingleSignOut } from "../single-sign-out"

const ISSUER = "https://auth.alummahnow.net"
const APP = "https://videos.alummahnow.net"

describe("single sign-out", () => {
  it("starts at the auth server and comes back to the app", () => {
    const url = new URL(startSingleSignOut(ISSUER, `${APP}/ar`))
    expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
    expect(url.searchParams.get("return")).toBe(`${APP}/ar`)
  })

  it("returns to the app's home page in the given locale", () => {
    const ar = new URL(singleSignOutToHome(ISSUER, "videos.alummahnow.net", "ar"))
    expect(ar.origin + ar.pathname).toBe(`${ISSUER}/logout`)
    expect(ar.searchParams.get("return")).toBe(`${APP}/ar`)
    expect(new URL(singleSignOutToHome(ISSUER, "videos.alummahnow.net", "en")).searchParams.get("return")).toBe(`${APP}/en`)
  })

  it("accepts only en and ar, and uses http only on localhost", () => {
    for (const locale of ["fr", "", "../evil", "ar/../x"]) {
      expect(new URL(singleSignOutToHome(ISSUER, "videos.alummahnow.net", locale)).searchParams.get("return")).toBe(`${APP}/en`)
    }
    expect(new URL(singleSignOutToHome(ISSUER, "localhost:3001", "en")).searchParams.get("return")).toBe("http://localhost:3001/en")
    expect(new URL(singleSignOutToHome(ISSUER, "localhost.evil.example", "en")).searchParams.get("return")).toBe("https://localhost.evil.example/en")
  })

  it("follows next back to the auth server's /logout", () => {
    const next = `${ISSUER}/logout?step=2&return=${encodeURIComponent(APP + "/")}`
    expect(singleSignOutNext(ISSUER, new URLSearchParams({ next }), APP)).toBe(next)
  })

  it("never follows next anywhere else (no open redirect)", () => {
    for (const next of ["https://evil.example/logout", `${ISSUER}/authorize`, "//evil.example", "not a url"]) {
      const url = new URL(singleSignOutNext(ISSUER, new URLSearchParams({ next }), APP))
      expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
      expect(url.searchParams.get("return")).toBe(`${APP}/`)
    }
  })

  it("starts the chain when opened directly", () => {
    expect(singleSignOutNext(ISSUER, new URLSearchParams(), APP)).toBe(startSingleSignOut(ISSUER, `${APP}/`))
  })

  it("restores a next whose query was split by a decoded %26 (OpenNext)", () => {
    // ?next=<auth>/logout?step=2%26return=<app> reaches the route decoded once
    const query = new URLSearchParams()
    query.set("next", `${ISSUER}/logout?step=2`)
    query.set("return", `${APP}/`)
    const url = new URL(singleSignOutNext(ISSUER, query, APP))
    expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
    expect(url.searchParams.get("step")).toBe("2")
    expect(url.searchParams.get("return")).toBe(`${APP}/`)
  })

  it("does not let a split parameter override one already in next", () => {
    const query = new URLSearchParams({ next: `${ISSUER}/logout?step=2`, step: "99" })
    expect(new URL(singleSignOutNext(ISSUER, query, APP)).searchParams.get("step")).toBe("2")
  })
})
