#pragma once
#include <cstdint>

// keg-scale board pin map.
//
// Unlike the kegerator (Keg Cop "Main Board") and fermenter (D32 Pro - TFT
// AIO) boards, this device's PCB (Beerkeg-load-cell-pcb, from the
// Beerkeg-load-cell-master reference repo) ships as Gerber files only, with
// no schematic — it's a plain HX711 amplifier + load-cell mount, with no
// onboard MCU of its own. There is no fixed silkscreen-to-GPIO wiring to
// reverse-engineer the way there was for the other two boards (see their
// pins.h comments); the reference firmware bundled with that repo is
// ESP8266-based (GPIO 2/0), which doesn't carry over anyway — this project
// doesn't support ESP8266 (claude.md non-goals) and DOUT/SCK are a plain
// firmware-level GPIO choice on whatever ESP32 board you wire the HX711
// module to, not a hardware constraint.
//
// These are therefore a starting default for an ESP32 lolin_d32 (matching
// the other two boards for BOM consistency), NOT a verified pin map — wire
// the HX711 module's DT/SCK lines to whichever GPIOs you actually used and
// update these to match before flashing.
constexpr uint8_t LOADCELL_DOUT_PIN = 4;
constexpr uint8_t LOADCELL_SCK_PIN = 16;

// Determined per physical load cell by comparing readings against a known
// reference weight — see README.md "Calibration". This placeholder value
// is almost certainly wrong for your load cell; the device will publish
// garbage weight readings until it's replaced with a real calibration.
constexpr float LOADCELL_CALIBRATION_FACTOR = -22500.0f;
