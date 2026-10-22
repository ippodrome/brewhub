import { describe, expect, it } from "vitest";
import { compareVersions, interfaceNeedsReload } from "./update-outcome";

describe("compareVersions", () => {
  it("orders numerically", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.10.0")).toBe(-1);
    expect(compareVersions("v1.1.0", "1.1")).toBe(0);
  });
});

describe("interfaceNeedsReload", () => {
  it("is false once the interface matches the installed version", () => {
    expect(interfaceNeedsReload("1.1.0", "1.1.0")).toBe(false);
  });
  it("is true when the interface is older than the backend", () => {
    expect(interfaceNeedsReload("1.0.0", "1.1.0")).toBe(true);
  });
  it("is false when the interface is newer, dev, or the backend is unknown", () => {
    expect(interfaceNeedsReload("1.2.0", "1.1.0")).toBe(false);
    expect(interfaceNeedsReload("dev", "1.1.0")).toBe(false);
    expect(interfaceNeedsReload("1.0.0", undefined)).toBe(false);
  });
});
