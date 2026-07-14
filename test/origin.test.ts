import { describe, it, expect } from "vitest";
import { parseAllowedOrigins, isOriginAllowed } from "../src/server/origin";

describe("parseAllowedOrigins", () => {
  it("returns null when unset", () => {
    expect(parseAllowedOrigins(undefined)).toBeNull();
  });

  it("returns null for an empty/whitespace-only value", () => {
    expect(parseAllowedOrigins("")).toBeNull();
    expect(parseAllowedOrigins("  , , ")).toBeNull();
  });

  it("splits, trims and drops empty entries from a comma list", () => {
    expect(parseAllowedOrigins("https://a.example, https://b.example ,,")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("keeps a single origin as a one-element list", () => {
    expect(parseAllowedOrigins("https://a.example")).toEqual(["https://a.example"]);
  });
});

describe("isOriginAllowed", () => {
  it("denies requests with no Origin header or same-origin browser evidence", () => {
    expect(isOriginAllowed(undefined, ["https://a.example"], "a.example")).toBe(false);
    expect(isOriginAllowed(undefined, null, "a.example")).toBe(false);
    expect(isOriginAllowed(undefined, null, undefined)).toBe(false);
    expect(isOriginAllowed("", ["https://a.example"], "a.example")).toBe(false);
  });

  it("allows an Origin-less same-origin browser polling GET when fetch metadata and Referer agree", () => {
    expect(
      isOriginAllowed(undefined, ["https://other.example"], "app.example", {
        referer: "https://app.example/room?id=1",
        secFetchSite: "same-origin",
      }),
    ).toBe(true);
  });

  it("denies Origin-less requests when same-origin browser evidence is incomplete or inconsistent", () => {
    expect(
      isOriginAllowed(undefined, null, "app.example", {
        referer: "https://evil.example/",
        secFetchSite: "same-origin",
      }),
    ).toBe(false);
    expect(
      isOriginAllowed(undefined, null, "app.example", {
        referer: "https://app.example/",
        secFetchSite: "cross-site",
      }),
    ).toBe(false);
    expect(
      isOriginAllowed(undefined, null, "app.example", {
        secFetchSite: "same-origin",
      }),
    ).toBe(false);
  });

  it("with an explicit allowlist, allows only exact origin matches", () => {
    const allowlist = ["https://a.example", "https://b.example"];
    expect(isOriginAllowed("https://a.example", allowlist, "irrelevant")).toBe(true);
    expect(isOriginAllowed("https://evil.example", allowlist, "irrelevant")).toBe(false);
  });

  it("always allows the app's own same-host origin even when an explicit list is configured", () => {
    expect(isOriginAllowed("https://generated.onrender.com", ["https://other.example"], "generated.onrender.com")).toBe(true);
  });

  it("without an allowlist, falls back to same-Host matching", () => {
    expect(isOriginAllowed("https://app.example", null, "app.example")).toBe(true);
    expect(isOriginAllowed("https://app.example:8443", null, "app.example:8443")).toBe(true);
    expect(isOriginAllowed("https://evil.example", null, "app.example")).toBe(false);
  });

  it("denies same-Host fallback when the request has no Host header", () => {
    expect(isOriginAllowed("https://app.example", null, undefined)).toBe(false);
  });

  it("denies a malformed Origin value safely instead of throwing", () => {
    expect(isOriginAllowed("not a url", null, "app.example")).toBe(false);
    expect(isOriginAllowed("not a url", ["https://a.example"], "app.example")).toBe(false);
  });
});
