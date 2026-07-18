#pragma once
#include <string>
#include "TiltParser.h" // GravityReading

namespace unibrew {

// Rapt Pill: a manufacturer-specific BLE advertisement (not an iBeacon).
// KegLand reuses the 2-byte "company ID" field for the ASCII bytes 'R','A'
// (start of "RAPT") rather than a real Bluetooth SIG-assigned ID.
//
// Byte layout below is sourced from sairon/rapt-ble (the parser behind
// Home Assistant's official `rapt_ble` integration —
// https://github.com/sairon/rapt-ble/blob/main/src/rapt_ble/parser.py),
// not guessed. That is a real, credible, actively-used reference — but it
// is still a *reference*, not a physical Rapt Pill: no device was actually
// available to advertise real bytes at this parser during implementation,
// so this remains unverified against real hardware. Only the "V1" payload
// shape (with an embedded MAC, no gravity-velocity field) is implemented —
// sairon/rapt-ble's own shipped code only correctly handles V1's exact
// byte length too; a second, less rigorously maintained community decoder
// that attempts "V2" support has a slice-offset bug in its own math,
// which is exactly the kind of subtle mistake that argues for sticking to
// the one well-tested source rather than also guessing at V2. tryParse()
// returns false for any version other than 1, rather than guess.
class RaptParser {
public:
    static bool tryParse(const std::string& manufacturerData, GravityReading& out);
};

} // namespace unibrew
