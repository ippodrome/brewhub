import {
  PROFILE_EXPORT_FORMAT_VERSION,
  type CreateProfileRequest,
  type Profile,
  type ProfileExport,
} from "@brewhub/shared-types";

/**
 * Strips a stored profile down to its portable form — everything that
 * identifies one row in one installation (id, deviceId, createdAt) is dropped.
 */
export function toExportEntry(profile: Profile): CreateProfileRequest {
  return profile.triggerType === "time"
    ? { name: profile.name, triggerType: "time", steps: profile.steps }
    : { name: profile.name, triggerType: "gravity", steps: profile.steps };
}

export function buildProfileExport(profiles: Profile[], nowMs: number): ProfileExport {
  return {
    formatVersion: PROFILE_EXPORT_FORMAT_VERSION,
    exportedAt: nowMs,
    profiles: profiles.map(toExportEntry),
  };
}

/**
 * Picks a name that isn't already in use, suffixing with " (2)", " (3)" … as
 * needed.
 *
 * Import is additive on purpose: overwriting a same-named profile would
 * silently discard whatever the user had, and refusing the whole import over
 * one clash makes sharing profiles annoying. Suffixing keeps both, and the
 * caller reports the rename so it isn't a surprise.
 *
 * `taken` is mutated as names are handed out, so a single import containing
 * two profiles with the same name doesn't hand out the same suffix twice.
 */
export function resolveUniqueName(requested: string, taken: Set<string>): string {
  if (!taken.has(requested)) {
    taken.add(requested);
    return requested;
  }
  for (let n = 2; ; n++) {
    const candidate = `${requested} (${n})`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** A safe, descriptive filename for the download. */
export function exportFilename(deviceId: string, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().slice(0, 10);
  const safeDeviceId = deviceId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `brewhub-profiles-${safeDeviceId}-${stamp}.json`;
}
