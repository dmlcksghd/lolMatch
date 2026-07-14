import { describe, it, expect } from "vitest";
import { mintToken, verifyToken, resolveIdentity, generateSessionSecret } from "../src/server/session";

const NOW = 1_700_000_000_000;
const config = { secret: "test-secret-value", ttlMs: 60_000 };

describe("generateSessionSecret", () => {
  it("returns a long random hex string, different each call", () => {
    const a = generateSessionSecret();
    const b = generateSessionSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("mintToken / verifyToken", () => {
  it("round-trips: a freshly minted token verifies back to the same identity", () => {
    const token = mintToken(config, "11111111-1111-4111-8111-111111111111", NOW);
    expect(verifyToken(config, token, NOW)).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects a token signed with a different secret (forged/tampered)", () => {
    const token = mintToken(config, "11111111-1111-4111-8111-111111111111", NOW);
    expect(verifyToken({ secret: "wrong-secret" }, token, NOW)).toBeNull();
  });

  it("rejects a token whose payload was edited but signature reused", () => {
    const token = mintToken(config, "11111111-1111-4111-8111-111111111111", NOW);
    const [, expiresAt, signature] = token.split(".");
    const forged = `22222222-2222-4222-8222-222222222222.${expiresAt}.${signature}`;
    expect(verifyToken(config, forged, NOW)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mintToken(config, "11111111-1111-4111-8111-111111111111", NOW);
    expect(verifyToken(config, token, NOW + config.ttlMs + 1)).toBeNull();
  });

  it("accepts a token right up to (but not including) its expiry instant", () => {
    const token = mintToken(config, "11111111-1111-4111-8111-111111111111", NOW);
    expect(verifyToken(config, token, NOW + config.ttlMs - 1)).not.toBeNull();
    expect(verifyToken(config, token, NOW + config.ttlMs)).toBeNull();
  });

  it.each([
    ["not a string", 12345],
    ["empty string", ""],
    ["too long", "a".repeat(500)],
    ["wrong shape (missing parts)", "only-one-part"],
    ["non-uuid identity segment", `not-a-uuid.${NOW + 1000}.deadbeef`],
    ["non-digit expiry segment", "11111111-1111-4111-8111-111111111111.notanumber.deadbeef"],
    ["null", null],
    ["undefined", undefined],
  ])("rejects malformed input: %s", (_label, input) => {
    expect(verifyToken(config, input, NOW)).toBeNull();
  });
});

describe("resolveIdentity", () => {
  it("mints a brand-new identity when no token is provided", () => {
    const a = resolveIdentity(config, undefined, NOW);
    const b = resolveIdentity(config, undefined, NOW);
    expect(a.identityId).not.toBe(b.identityId);
  });

  it("resolves back to the same identity when a valid token is replayed (reconnect)", () => {
    const first = resolveIdentity(config, undefined, NOW);
    const second = resolveIdentity(config, first.token, NOW + 1000);
    expect(second.identityId).toBe(first.identityId);
  });

  it("issues a freshly signed token on every resolution (sliding expiry)", () => {
    const first = resolveIdentity(config, undefined, NOW);
    const second = resolveIdentity(config, first.token, NOW + 1000);
    expect(second.token).not.toBe(first.token);
  });

  it("falls back to a new identity when the presented token is invalid, without throwing", () => {
    const resolved = resolveIdentity(config, "garbage-token", NOW);
    expect(typeof resolved.identityId).toBe("string");
    expect(resolved.identityId.length).toBeGreaterThan(0);
  });
});
