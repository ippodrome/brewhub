import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the bundled broker's ACL (docker/mosquitto/acl): devices may only
// publish their own state and only the backend may send config/OTA.
const dockerDir = fileURLToPath(new URL("../../../../docker/mosquitto/", import.meta.url));
const acl = readFileSync(`${dockerDir}acl`, "utf8");
const conf = readFileSync(`${dockerDir}mosquitto.conf`, "utf8");

function rules(): string[] {
  return acl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

describe("bundled Mosquitto ACL", () => {
  it("is enabled in mosquitto.conf", () => {
    expect(conf).toMatch(/^acl_file \/mosquitto\/config\/acl$/m);
    expect(conf).toMatch(/^allow_anonymous false$/m);
  });

  it("lets devices write only their own state topics", () => {
    for (const kind of ["status", "telemetry", "discovery", "gravity"]) {
      expect(rules()).toContain(`pattern write unibrew/%u/${kind}`);
    }
  });

  it("lets devices only read (never write) their own config/ota", () => {
    expect(rules()).toContain("pattern read unibrew/%u/config");
    expect(rules()).toContain("pattern read unibrew/%u/ota");
    const devicePatterns = rules().filter((r) => r.startsWith("pattern"));
    for (const r of devicePatterns) {
      expect(r).not.toMatch(/^pattern (write|readwrite) .*\/(config|ota)$/);
      expect(r).toContain("%u");
    }
  });

  it("gives write access to every device's topics only to brewhub-backend", () => {
    const lines = rules();
    const wildcardWrites = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^topic (write|readwrite) unibrew\/#$/.test(l));
    expect(wildcardWrites.length).toBe(1);
    const owner = lines
      .slice(0, wildcardWrites[0]!.i)
      .reverse()
      .find((l) => l.startsWith("user "));
    expect(owner).toBe("user brewhub-backend");
  });
});
