#pragma once
#include <cstddef>
#include <cstdint>

// Kegerator board pin map for the Keg Cop "Main Board" (lbussy/keg-cop).
// Confirmed two independent ways that agree exactly: parsed the real Eagle
// schematic (pcb/Main Boards/main/Keg Cop - Main.sch, part D32 =
// deviceset=WEMOS-D32 device=D32_NO_BATT, i.e. a Lolin D32, no "Pro") and
// cross-checked against the firmware's own src/config.h on GitHub.

// Flow meter pulse inputs (up to 9 taps). Declared here, not wired to any
// logic yet — pulse-counting/volume-tracking is a separate, not-yet-built
// Phase 2 feature.
constexpr uint8_t FLOW_PINS[9] = {4, 16, 17, 18, 19, 21, 22, 23, 13};
constexpr size_t kFlowPinCount = 9;

// Temperature sensors — Keg Cop wires each role to its OWN separate OneWire
// bus (5 GPIOs), unlike the fermenter board's single shared bus. Net names
// in the schematic: KDAT/LDAT/RDAT/TDAT/UDAT.
constexpr uint8_t KEG_SENSE_PIN = 14;
constexpr uint8_t LOWER_CHAMBER_SENSE_PIN = 26;
constexpr uint8_t ROOM_SENSE_PIN = 32;
constexpr uint8_t TOWER_SENSE_PIN = 33;
constexpr uint8_t UPPER_CHAMBER_SENSE_PIN = 25;

// Outputs.
constexpr uint8_t COOLING_RELAY_PIN = 27;
constexpr uint8_t SOLENOID_PIN = 2; // declared, not wired to any logic yet
                                     // — pour control is part of the same
                                     // deferred flow-meter feature above.

// UNVERIFIED, same caveat as the fermenter board: the schematic's RELAY net
// is just a header, not an on-board driver circuit, so polarity depends on
// the specific relay module plugged in. Confirm before flashing.
constexpr bool RELAY_ACTIVE_LOW = true;
