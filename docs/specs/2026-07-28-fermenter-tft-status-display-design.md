# Fermenter TFT status display — design

**Date:** 2026-07-28
**Scope:** `firmware/shared/display`, `firmware/shared/hal-display`, `firmware/fermenter`

## Goal

Show fermenter status on a display attached to the controller board, so the
current temperature, setpoint and heat/cool state can be read without opening
the BrewHub UI on a phone.

Read-only. No touch, no control from the display — the backend remains the
single source of truth for configuration.

## Hardware

Generic ILI9341 320×240 SPI module (2.8" or 3.2"), wired to the 2×5 box
header (`TFT`) on the "D32 Pro - TFT AIO" board (thorrak/thorrak_hardware,
ESP32 BrewPi Boards).

Header pinout, read from the board's Eagle schematic (`D32 Pro - TFT AIO.sch`):

| Header pin | Net     | ESP32 |
|------------|---------|-------|
| 1          | VBUS    | +5 V  |
| 2          | MOSI    | IO23  |
| 3          | GND     | —     |
| 4          | SCK     | IO18  |
| 5          | CS      | IO14  |
| 6          | LED     | IO32  |
| 7          | RESET   | IO33  |
| 8          | MISO    | IO19  |
| 9          | DC      | IO27  |
| 10         | T_CS    | IO12  |

Notes:

- **Header pin 1 is 5 V, not 3.3 V.** Most red ILI9341 SPI modules carry an
  onboard 3.3 V regulator and tolerate this; 3.3 V-only variants do not. If
  the module's VCC is not marked 5 V-capable, feed it from 3V3 and leave
  header pin 1 unconnected.
- **T_CS (IO12) is left unconnected** — no touch in this design. IO12 is an
  ESP32 strapping pin (MTDI, selects flash voltage at boot); leaving it out
  removes that concern entirely.
- The same GPIOs are also routed to the LoLin D32 Pro module's own built-in
  TFT connector, so this design works unchanged with LoLin's matched screen
  if the box header is ever bypassed.
- No breakout PCB for this header exists in thorrak/thorrak_hardware despite
  being referenced in that repo's README — the module is wired directly.

## Architecture

Mirrors the existing `control` / `hal-control` split: hardware-free logic in
a plain library that runs under the `native` test environment, ESP32-specific
code in a `hal-*` library.

### `firmware/shared/display/` (hardware-free, natively tested)

- `DisplayModel` — plain struct holding everything that can appear on screen:
  control temperature, setpoint, mode, `ControlOutput`, WiFi/MQTT connected
  flags, device id, firmware version, and the non-control sensor samples.
- `DisplayPresenter` — turns a `DisplayModel` into formatted, ready-to-draw
  strings plus per-field dirty flags. Owns every edge case: `NaN`
  temperatures, zero discovered sensors, mode-to-label mapping, address
  shortening.

Depends on `unibrew-control` for `ControlOutput` / `ControlMode` /
`SensorSample`. No Arduino headers.

### `firmware/shared/hal-display/` (ESP32)

- `TftDisplay` — TFT_eSPI wrapper. Draws static chrome once, then repaints
  only the fields the presenter marked dirty. Contains no formatting or state
  logic.

`library.json` declares the TFT_eSPI dependency, matching how `hal-temp`
declares DallasTemperature/OneWire.

### Rationale

Display defects concentrate in *what* is shown under edge conditions, not in
the drawing itself. Putting that logic behind a hardware-free boundary makes
it unit-testable and keeps the untestable surface down to TFT_eSPI calls.

## Data flow

`main.cpp` populates a module-level `DisplayModel` from state that already
exists in `loop()`. No new state is introduced and the OneWire bus is not
read any more often than today.

| Field                | Source                                   |
|----------------------|------------------------------------------|
| control temperature  | `controlTemperatureC` (already computed) |
| setpoint, mode       | `controlLoop.config()`                   |
| output               | `controlLoop.currentOutput()`            |
| WiFi                 | `WiFi.status()`                          |
| MQTT                 | `mqttClient.connected()`                 |
| sensors              | `samples[]`, `count`                     |
| device id, version   | `DEVICE_ID`, `FIRMWARE_VERSION`          |

Cadence:

- Temperature fields refresh in the existing 2 s telemetry branch.
- Connection flags and output state refresh on a separate 1 s render tick, so
  network status reacts promptly without touching the sensor bus.

Both are interval-gated in `loop()` alongside the existing telemetry and
status timers.

## Layout (320×240 landscape)

```
┌────────────────────────────────────────────┐
│ fermenter-01                  WiFi ▮ MQTT ▮│
├────────────────────────────────────────────┤
│                                            │
│         18.4 °C                            │
│      setpoint 18.0                         │
│                                            │
├────────────────────────────────────────────┤
│   ▚ COOLING ▞            mode: thermostat  │
├────────────────────────────────────────────┤
│  A1B2  19.1 °C      C3D4  21.7 °C          │
└────────────────────────────────────────────┘
```

- Control temperature is the largest element — it is what the screen exists
  for.
- The output row is colour-coded (blue cooling, red heating, dimmed idle) so
  it is legible across a room.
- Non-control sensors are labelled with the **last four hex characters of
  their address**. The firmware receives no sensor names: the config message
  carries only `controlSensorAddress`. Pushing names would require changes to
  the backend, `shared-types` and `onConfigMessage`, which is out of scope
  here; the layout accommodates names later without redesign.

## Redraw strategy

Static chrome (frame, separators, labels) is drawn once at startup. Then only
fields whose formatted string changed are repainted, each over a background
fill of its own rectangle.

This avoids flicker and keeps SPI time per tick in the low milliseconds,
which matters because the task watchdog is 30 s and is disabled entirely
during OTA.

## States

| State            | Behaviour                                                    |
|------------------|--------------------------------------------------------------|
| Boot             | "Starting" plus `FIRMWARE_VERSION`                           |
| WiFi connecting  | WiFi indicator inactive; rest of screen renders normally     |
| MQTT down        | MQTT indicator red, **plus explicit note that control is still running locally** |
| Sensor fault     | `--.- °C` and a red marker when the control reading is `NaN` or no sensors were discovered — `ControlLoop` cannot regulate in this state |
| OTA in progress  | Full-screen "Updating firmware — do not power off"           |

The MQTT-down case is the main justification for a local display: the device
keeps regulating without the backend, and the screen must make that obvious
rather than implying the device is dead.

The OTA screen must be drawn **before** `otaUpdater.begin()` is called —
that call blocks with the watchdog removed and reboots on success, so
nothing after it runs.

## TFT_eSPI configuration

TFT_eSPI resolves its pin mapping at compile time from preprocessor macros,
so they go in `build_flags` under **`[env:fermenter-brewpi]` only**. Placing
them in the shared `[env]` section would pull TFT_eSPI into the `native` test
build.

This unavoidably duplicates pin numbers between `pins.h` and
`platformio.ini`. To prevent silent drift, `hal-display` carries
`static_assert`s comparing TFT_eSPI's macros against the `pins.h` constants —
a mismatch becomes a compile error rather than a screen that never lights up.

`pins.h` is extended accordingly: the TFT pins currently exist only as a
comment, and `LED` (IO32) and `RESET` (IO33) are missing from it entirely.

## Testing

`firmware/fermenter/test/test_display_presenter/`, unity, run under
`pio test -e native` like the existing suites:

- `NaN` control temperature formats as `--.-`
- zero discovered sensors renders the fault state
- each `ControlMode` and `ControlOutput` maps to its expected label
- dirty flags are set only on actual value change, not on every update
- address shortening yields the last four hex characters

`shared/display` is added to the `native` environment's `lib_extra_dirs`.

## Flash budget — measured, not estimated

`board_build.partitions = default.csv` gives 1 310 720 bytes per app slot and
OTA requires two, so the concern was whether TFT_eSPI leaves enough headroom.
Measured with a throwaway spike (TFT_eSPI 2.5.43 linked in and actually
exercised — `init`, `fillScreen`, `drawString`, `drawFloat`, `fillRect`,
`drawLine` — so the linker could not strip the fonts and draw routines):

| Build                       | Flash        | Share |
|-----------------------------|--------------|-------|
| Baseline (no display)       | 701 777 B    | 53.5% |
| With TFT_eSPI + fonts       | 728 617 B    | 55.6% |
| **Delta**                   | **+26 840 B**| +2.1 pp |

RAM grew by 292 bytes. 582 103 bytes remain free in the app slot.

**The partition scheme does not need to change**, and OTA compatibility with
already-flashed devices is unaffected. Fonts enabled for the measurement were
`LOAD_GLCD`, `LOAD_FONT2`, `LOAD_FONT4`, `LOAD_FONT6`, `LOAD_FONT7` and
`LOAD_GFXFF` — a superset of what the layout needs, so the real cost will be
at or below this figure.

`SMOOTH_FONT` must stay **off**. Enabling it makes TFT_eSPI include
`SPIFFS.h` (smooth fonts are loaded from a filesystem at runtime), which
fails to compile here and would otherwise require a filesystem partition for
no benefit — the built-in fonts cover the whole layout.

## Risks

- Module VCC tolerance (see Hardware) — verify before first power-on.
- SPI frequency: start conservative (27 MHz) and raise only if the refresh
  rate warrants it; long unshielded flying leads from the box header to the
  module tolerate less than a short ribbon.

## Out of scope

- Touch input and any control from the display
- Sensor names in the config protocol
- The I2C LCD2004 variant (would require populating Q1/Q2 + R3–R6 on the
  board, which this build deliberately omits)
- Display support on the kegerator, keg-scale and gravity-bridge boards
