#pragma once

// Fermenter board pin map for the physical "D32 Pro - TFT AIO" board
// (thorrak/thorrak_hardware, ESP32 BrewPi Boards), confirmed by parsing the
// real Eagle schematic (D32 Pro - TFT OneSize.sch) net-to-pin mapping —
// part U$3 is deviceset=WEMOS-D32 device=D32_PRO_NO-BATT, i.e. the actual
// Lolin D32 Pro module, not a placeholder guess.
//
// Confirmed nets -> ESP32 IO pins:
//   1WIRE -> IO13   (single shared OneWire bus — DS18B20s addressed
//                     individually, matching SensorManager's multi-sensor
//                     discovery design; there is only one 1WIRE net on this
//                     board, not separate beer/fridge/room pins)
//   HEAT  -> IO25   (heating relay header)
//   COOL  -> IO26   (cooling relay header)
//   DOOR  -> IO34   (door switch input, input-only pin on ESP32 — fine,
//                     it's only ever read)
//
// TFT display on the board's 2x5 box header, confirmed from the same Eagle
// schematic. Header pin 1 supplies 5V, not 3v3 — an ILI9341 module whose
// VCC is not marked 5V-capable must be fed from 3v3 with that pin left
// unconnected.
//
// T_CS is declared for completeness but deliberately left unconnected:
// there is no touch input in this build, and IO12 is an ESP32 strapping pin
// (MTDI, selects flash voltage at boot).
//
// The IIC LCD variant (SCL=IO22, SDA=IO21) needs Q1/Q2 + R3-R6 populated on
// the board and is not supported.
constexpr uint8_t TFT_CS_PIN = 14;
constexpr uint8_t TFT_DC_PIN = 27;
constexpr uint8_t TFT_RST_PIN = 33;
constexpr uint8_t TFT_LED_PIN = 32;
constexpr uint8_t TFT_MOSI_PIN = 23;
constexpr uint8_t TFT_MISO_PIN = 19;
constexpr uint8_t TFT_SCLK_PIN = 18;
constexpr uint8_t TFT_TOUCH_CS_PIN = 12;

// TFT_eSPI resolves its pin mapping from compile-time macros supplied as
// build flags, so the same numbers necessarily live in platformio.ini too.
// These assertions turn drift between the two into a compile error rather
// than a display that silently never lights up.
#ifdef TFT_CS
static_assert(TFT_CS == TFT_CS_PIN, "TFT_CS build flag disagrees with pins.h");
static_assert(TFT_DC == TFT_DC_PIN, "TFT_DC build flag disagrees with pins.h");
static_assert(TFT_RST == TFT_RST_PIN, "TFT_RST build flag disagrees with pins.h");
static_assert(TFT_BL == TFT_LED_PIN, "TFT_BL build flag disagrees with pins.h");
static_assert(TFT_MOSI == TFT_MOSI_PIN, "TFT_MOSI build flag disagrees with pins.h");
static_assert(TFT_MISO == TFT_MISO_PIN, "TFT_MISO build flag disagrees with pins.h");
static_assert(TFT_SCLK == TFT_SCLK_PIN, "TFT_SCLK build flag disagrees with pins.h");
#endif
constexpr uint8_t ONE_WIRE_PIN = 13;
constexpr uint8_t HEATING_RELAY_PIN = 25;
constexpr uint8_t COOLING_RELAY_PIN = 26;
constexpr uint8_t DOOR_PIN = 34;

// UNVERIFIED: the "RELAY" net on this board is just a 4-pin header, not an
// on-board relay driver circuit — the actual relay module is a separate
// off-the-shelf board plugged in, so polarity depends on which one you
// have. Most common cheap 2-channel relay modules are active-low (a LOW
// signal energizes the relay). Confirm against your actual relay module
// before flashing — flip this if heating/cooling come out inverted.
constexpr bool RELAY_ACTIVE_LOW = true;
