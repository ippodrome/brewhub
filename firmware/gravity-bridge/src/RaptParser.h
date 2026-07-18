#pragma once
#include <string>
#include "TiltParser.h" // GravityReading

namespace unibrew {

// Rapt Pill: a manufacturer-specific BLE advertisement (not an iBeacon),
// carrying gravity/temperature/battery in its own byte layout.
//
// UNVERIFIED: no physical Rapt Pill was available during implementation, so
// the company ID and byte offsets below are a best-effort placeholder based
// on public community reverse-engineering references, not a datasheet or a
// device actually seen advertising. tryParse() is written defensively (a
// non-matching company ID or length safely returns false, never garbage
// data) but WILL need correcting against a real device or its actual
// captured advertisement bytes before Rapt Pill support can be trusted —
// see DECISIONS.md. Tilt support (TiltParser) has no such caveat.
class RaptParser {
public:
    static bool tryParse(const std::string& manufacturerData, GravityReading& out);
};

} // namespace unibrew
