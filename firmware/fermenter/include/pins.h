#pragma once

// Fermenter board (BrewPi ESP D32-style) pin map, Phase 1/2 scope.
//
// PLACEHOLDER — NOT VERIFIED AGAINST THE REAL BOARD.
// The board target is confirmed as `lolin_d32` (see platformio.ini), but the
// exact GPIO routing for the OneWire and relay headers on the physical
// "D32 Pro - TFT OneSize" PCB (thorrak/thorrak_hardware) lives only in that
// board's Eagle .sch schematic, which wasn't extractable via automated
// fetching. Confirm ONE_WIRE_PIN against the real board (multimeter/silkscreen)
// or by opening the schematic directly before flashing real hardware.
//
// No relay pins yet — no actuators are wired until Phase 2/3 firmware work.
constexpr uint8_t ONE_WIRE_PIN = 4;
