import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

const REQUIRED = { JWT_SECRET: "a-secret-that-is-long-enough" };

describe("loadConfig", () => {
  it("accepts a valid PUBLIC_URL", () => {
    const config = loadConfig({ ...REQUIRED, PUBLIC_URL: "https://192.168.1.50:8443" });
    expect(config.PUBLIC_URL).toBe("https://192.168.1.50:8443");
  });

  it("treats an unset PUBLIC_URL as undefined", () => {
    const config = loadConfig({ ...REQUIRED });
    expect(config.PUBLIC_URL).toBeUndefined();
  });

  it("treats an empty-string PUBLIC_URL the same as unset (docker-compose ${VAR:-} substitution)", () => {
    const config = loadConfig({ ...REQUIRED, PUBLIC_URL: "" });
    expect(config.PUBLIC_URL).toBeUndefined();
  });

  it("rejects a genuinely malformed PUBLIC_URL", () => {
    expect(() => loadConfig({ ...REQUIRED, PUBLIC_URL: "not-a-url" })).toThrow();
  });

  it("throws without a JWT_SECRET", () => {
    expect(() => loadConfig({})).toThrow();
  });
});
