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
// NOT wired/used yet (TFT/touch display, IIC LCD variant — out of Phase 2
// scope): CS=IO14, DC=IO27, MISO=IO19, MOSI=IO23, SCK=IO18, T_CS=IO12,
// SCL=IO22, SDA=IO21.
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
