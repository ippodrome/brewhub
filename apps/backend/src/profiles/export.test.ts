import { describe, expect, it } from "vitest";
import { ProfileExportSchema, type Profile } from "@brewhub/shared-types";
import { buildProfileExport, exportFilename, resolveUniqueName, toExportEntry } from "./export.js";

const timeProfile: Profile = {
  id: 7,
  deviceId: "fermenter-01",
  name: "Ale",
  createdAt: 1700000000000,
  triggerType: "time",
  steps: [
    { atMinutes: 0, targetC: 18 },
    { atMinutes: 4320, targetC: 21 },
  ],
};

const gravityProfile: Profile = {
  id: 8,
  deviceId: "fermenter-01",
  name: "Hefeweizen",
  createdAt: 1700000000000,
  triggerType: "gravity",
  steps: [
    { atGravitySg: 1.05, targetC: 18 },
    { atGravitySg: 1.02, targetC: 20 },
  ],
};

describe("toExportEntry", () => {
  it("drops the fields that only mean something in one installation", () => {
    const entry = toExportEntry(timeProfile);

    expect(entry).toEqual({
      name: "Ale",
      triggerType: "time",
      steps: timeProfile.steps,
    });
    expect(entry).not.toHaveProperty("id");
    expect(entry).not.toHaveProperty("deviceId");
    expect(entry).not.toHaveProperty("createdAt");
  });

  it("keeps gravity steps intact", () => {
    expect(toExportEntry(gravityProfile).steps).toEqual(gravityProfile.steps);
  });
});

describe("buildProfileExport", () => {
  it("produces an envelope that its own import schema accepts", () => {
    const envelope = buildProfileExport([timeProfile, gravityProfile], 1700000000000);

    // The round trip is the point: anything we write must be readable back.
    const parsed = ProfileExportSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.profiles).toHaveLength(2);
  });

  it("stamps the current format version", () => {
    expect(buildProfileExport([timeProfile], 0).formatVersion).toBe(1);
  });

  it("survives a JSON round trip, which is how it actually travels", () => {
    const envelope = buildProfileExport([timeProfile, gravityProfile], 1700000000000);
    const reparsed = ProfileExportSchema.safeParse(JSON.parse(JSON.stringify(envelope)));

    expect(reparsed.success).toBe(true);
    expect(reparsed.success && reparsed.data.profiles[1]).toEqual(toExportEntry(gravityProfile));
  });
});

describe("resolveUniqueName", () => {
  it("keeps the name when nothing clashes", () => {
    expect(resolveUniqueName("Ale", new Set())).toBe("Ale");
  });

  it("suffixes on a clash rather than overwriting", () => {
    expect(resolveUniqueName("Ale", new Set(["Ale"]))).toBe("Ale (2)");
  });

  it("keeps counting past an existing suffix", () => {
    expect(resolveUniqueName("Ale", new Set(["Ale", "Ale (2)", "Ale (3)"]))).toBe("Ale (4)");
  });

  it("does not hand the same name to two profiles in one import", () => {
    const taken = new Set<string>();
    expect(resolveUniqueName("Ale", taken)).toBe("Ale");
    expect(resolveUniqueName("Ale", taken)).toBe("Ale (2)");
    expect(resolveUniqueName("Ale", taken)).toBe("Ale (3)");
  });
});

describe("exportFilename", () => {
  it("includes the device and the date", () => {
    expect(exportFilename("fermenter-01", Date.UTC(2026, 6, 28))).toBe(
      "brewhub-profiles-fermenter-01-2026-07-28.json",
    );
  });

  it("neutralises characters that don't belong in a filename", () => {
    expect(exportFilename("../../etc/passwd", 0)).not.toContain("/");
  });
});
