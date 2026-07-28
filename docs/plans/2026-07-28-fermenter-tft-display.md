# Fermenter TFT Status Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show fermenter status — control temperature, setpoint, mode, heat/cool output and connection state — on an ILI9341 320×240 display wired to the controller board's TFT box header, so a run can be checked without opening the BrewHub UI.

**Architecture:** Two libraries mirroring the existing `control` / `hal-control` boundary. `shared/display` holds `DisplayModel` (plain data) and `DisplayPresenter` (formatting, state labels, dirty tracking) with no Arduino dependency, so it runs under the `native` test environment. `shared/hal-display` holds `TftDisplay`, a TFT_eSPI wrapper that draws whatever the presenter marked dirty and contains no logic of its own.

**Tech Stack:** C++17, PlatformIO, Arduino-ESP32, TFT_eSPI 2.5.43, Unity (native tests).

## Global Constraints

- Read-only display. No touch, no configuration changes from the board. `T_CS`/IO12 stays unconnected.
- `SMOOTH_FONT` must **never** be enabled — it makes TFT_eSPI include `SPIFFS.h` and fails to compile. Built-in fonts only.
- TFT_eSPI build flags go under `[env:fermenter-brewpi]` **only**, never the shared `[env]` section, or they pull TFT_eSPI into the `native` build.
- `board_build.partitions = default.csv` stays unchanged. Measured headroom after the display is 582 KB; do not alter partitions.
- `shared/display` must not include any Arduino header, directly or transitively. That specifically rules out `SensorManager.h`, which pulls in `OneWire.h`/`DallasTemperature.h`.
- Existing behaviour is not to regress: `pio test -e native` must stay green throughout, since it covers the safety-critical control loop.
- Pin values, from the board's Eagle schematic: MISO=19, MOSI=23, SCLK=18, CS=14, DC=27, RST=33, LED(backlight)=32, T_CS=12.
- Namespace for all new types is `unibrew`, matching every existing shared library.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `firmware/shared/display/library.json` | PlatformIO manifest, hardware-free (`"platforms": ["*"]`) |
| `firmware/shared/display/src/DisplayModel.h` | `DisplaySensor`, `DisplayScreen`, `DisplayModel` — plain data, no logic |
| `firmware/shared/display/src/DisplayPresenter.h` | `DisplayField`, `DisplayText`, `DisplayPresenter` declarations |
| `firmware/shared/display/src/DisplayPresenter.cpp` | Formatting, label mapping, sensor-row assembly, dirty tracking |
| `firmware/shared/hal-display/library.json` | PlatformIO manifest declaring the TFT_eSPI dependency |
| `firmware/shared/hal-display/src/TftDisplay.h` | `TftDisplay` declaration |
| `firmware/shared/hal-display/src/TftDisplay.cpp` | TFT_eSPI drawing, chrome + per-field repaint |
| `firmware/fermenter/test/test_display_presenter/test_main.cpp` | Unity tests for the presenter |

**Modified:**

| File | Change |
|---|---|
| `firmware/fermenter/include/pins.h` | Add TFT pin constants and `static_assert`s against TFT_eSPI's macros |
| `firmware/fermenter/platformio.ini` | TFT_eSPI dep, build flags, `lib_extra_dirs` for both envs |
| `firmware/fermenter/src/main.cpp` | Populate the model, tick the display, draw the OTA screen |
| `README.md` | Note the optional display under the fermenter's setup |

**Why `shared/display` defines its own sensor type:** `SensorSample` and `kMaxSensors` live in `firmware/shared/hal-temp/src/SensorManager.h`, which includes `<OneWire.h>` and `<DallasTemperature.h>`. A hardware-free library cannot include it. Rather than refactor a working, safety-adjacent header and disturb the kegerator build that also depends on it, `shared/display` declares a minimal `DisplaySensor` carrying the already-formatted address hex — which is what the display needs anyway — and `main.cpp` converts at the boundary using the existing `formatSensorAddress`.

---

### Task 1: `shared/display` library with temperature formatting

**Files:**
- Create: `firmware/shared/display/library.json`
- Create: `firmware/shared/display/src/DisplayModel.h`
- Create: `firmware/shared/display/src/DisplayPresenter.h`
- Create: `firmware/shared/display/src/DisplayPresenter.cpp`
- Modify: `firmware/fermenter/platformio.ini` (native env `lib_extra_dirs` only)
- Test: `firmware/fermenter/test/test_display_presenter/test_main.cpp`

**Interfaces:**
- Consumes: `unibrew::ControlMode`, `unibrew::ControlOutput` from `ControlLoop.h`; `unibrew::kSensorAddressHexLength` from `SensorAddress.h` (both in the existing `unibrew-control` library).
- Produces: `unibrew::DisplaySensor`, `unibrew::DisplayScreen`, `unibrew::DisplayModel`, `unibrew::DisplayField`, `unibrew::kDisplayFieldCount`, `unibrew::DisplayText`, `unibrew::DisplayPresenter` with `void update(const DisplayModel&)`, `const DisplayText& text() const`, `bool isDirty(DisplayField) const`, `void clearDirty()`, `void markAllDirty()`.

- [ ] **Step 1: Create the library manifest**

Create `firmware/shared/display/library.json`:

```json
{
  "name": "unibrew-display",
  "version": "0.1.0",
  "description": "Hardware-free display model and presenter for UniBrew devices — formatting, state labels and dirty tracking, with no Arduino dependency so it runs under the native test environment. The TFT_eSPI drawing code lives in unibrew-hal-display.",
  "frameworks": [],
  "platforms": ["*"]
}
```

- [ ] **Step 2: Create the model header**

Create `firmware/shared/display/src/DisplayModel.h`:

```cpp
#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>

#include "ControlLoop.h"
#include "SensorAddress.h"

namespace unibrew {

// Matches kMaxSensors in hal-temp's SensorManager.h. Deliberately redeclared
// rather than included: that header pulls in OneWire.h/DallasTemperature.h,
// which would make this library unbuildable under the native test
// environment. main.cpp converts SensorSample -> DisplaySensor at the
// boundary.
constexpr size_t kDisplayMaxSensors = 8;

struct DisplaySensor {
    char addressHex[kSensorAddressHexLength + 1];
    float temperatureC;
};

// There is deliberately no separate boot screen. setup() brings the status
// layout up immediately, before the blocking WiFi attempt, so the 15 seconds
// that would otherwise show a splash instead show the real screen with its
// connection indicators red and the temperature reading "--.-" — strictly
// more information than a splash, and one less state to maintain.
enum class DisplayScreen : uint8_t { STATUS, OTA };

struct DisplayModel {
    DisplayScreen screen = DisplayScreen::STATUS;

    const char* deviceId = "";

    float controlTemperatureC = NAN;
    float setpointC = 0.0f;
    ControlMode mode = ControlMode::THERMOSTAT;
    ControlOutput output = ControlOutput::IDLE;

    bool wifiConnected = false;
    bool mqttConnected = false;

    // Empty means "no sensor designated" — the control loop falls back to
    // the first discovered sensor, and the presenter mirrors that fallback
    // when deciding which sensor to omit from the secondary row.
    char controlSensorAddressHex[kSensorAddressHexLength + 1] = "";

    DisplaySensor sensors[kDisplayMaxSensors];
    size_t sensorCount = 0;
};

} // namespace unibrew
```

- [ ] **Step 3: Create the presenter header**

Create `firmware/shared/display/src/DisplayPresenter.h`:

```cpp
#pragma once
#include <cstddef>
#include <cstdint>

#include "DisplayModel.h"

namespace unibrew {

// Independently repaintable regions of the screen. OUTPUT_BAND covers both
// the output label and the mode label because they share one filled
// rectangle — repainting the band erases the mode text, so they must be
// redrawn together.
enum class DisplayField : uint8_t {
    DEVICE_ID,
    CONNECTION,
    CONTROL_TEMP,
    SETPOINT,
    OFFLINE_NOTICE,
    OUTPUT_BAND,
    SENSORS,
};

constexpr size_t kDisplayFieldCount = 7;

struct DisplayText {
    char deviceId[24];
    char controlTemp[8];   // "18.4" or "--.-"
    char setpoint[24];     // "setpoint 18.0"
    char output[12];       // "COOLING" / "HEATING" / "IDLE"
    char mode[20];         // "mode: thermostat"
    char sensors[64];      // "A1B2 19.1  C3D4 21.7"

    bool wifiConnected;
    bool mqttConnected;

    // True when the control reading is unusable — no sensors discovered, or
    // a NaN reading. ControlLoop cannot regulate in this state, so the
    // renderer colours the temperature to make it obvious.
    bool controlTempFault;

    ControlOutput outputState; // drives the band colour
    DisplayScreen screen;
};

class DisplayPresenter {
public:
    // Recomputes every formatted string from the model and sets the dirty
    // flag on each field whose text (or, for CONNECTION and OUTPUT_BAND,
    // whose associated state) actually changed. The first call after
    // construction marks everything dirty.
    void update(const DisplayModel& model);

    const DisplayText& text() const;
    bool isDirty(DisplayField field) const;

    // Called by the renderer once it has drawn every dirty field.
    void clearDirty();

    // Forces a full repaint on the next render — used when the screen is
    // switched and the chrome has to be redrawn from scratch.
    void markAllDirty();

private:
    DisplayText text_{};
    bool dirty_[kDisplayFieldCount] = {};
    bool initialized_ = false;

    void setDirty(DisplayField field);
};

} // namespace unibrew
```

- [ ] **Step 4: Write the failing tests**

Create `firmware/fermenter/test/test_display_presenter/test_main.cpp`:

```cpp
#include <unity.h>
#include <cmath>
#include <cstring>

#include "DisplayPresenter.h"

using namespace unibrew;

void setUp(void) {}
void tearDown(void) {}

static DisplayModel makeModel() {
    DisplayModel m;
    m.screen = DisplayScreen::STATUS;
    m.deviceId = "fermenter-01";
    m.controlTemperatureC = 18.44f;
    m.setpointC = 18.0f;
    m.mode = ControlMode::THERMOSTAT;
    m.output = ControlOutput::IDLE;
    m.wifiConnected = true;
    m.mqttConnected = true;
    m.sensorCount = 0;
    return m;
}

void test_formats_control_temperature_to_one_decimal(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("18.4", p.text().controlTemp);
}

void test_formats_negative_control_temperature(void) {
    DisplayModel m = makeModel();
    m.controlTemperatureC = -1.25f;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("-1.3", p.text().controlTemp);
}

void test_nan_control_temperature_renders_placeholder_and_fault(void) {
    DisplayModel m = makeModel();
    m.controlTemperatureC = NAN;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("--.-", p.text().controlTemp);
    TEST_ASSERT_TRUE(p.text().controlTempFault);
}

void test_no_sensors_renders_fault_even_with_a_number(void) {
    DisplayModel m = makeModel();
    m.sensorCount = 0;
    m.controlTemperatureC = 18.4f;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_TRUE(p.text().controlTempFault);
}

void test_valid_reading_with_sensors_is_not_a_fault(void) {
    DisplayModel m = makeModel();
    m.sensorCount = 1;
    std::strcpy(m.sensors[0].addressHex, "28FF641F0417033A");
    m.sensors[0].temperatureC = 18.4f;
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_FALSE(p.text().controlTempFault);
}

void test_formats_setpoint(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("setpoint 18.0", p.text().setpoint);
}

void test_copies_device_id(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("fermenter-01", p.text().deviceId);
}

void test_truncates_overlong_device_id(void) {
    DisplayModel m = makeModel();
    m.deviceId = "a-really-very-long-device-identifier";
    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_UINT(23, std::strlen(p.text().deviceId));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_formats_control_temperature_to_one_decimal);
    RUN_TEST(test_formats_negative_control_temperature);
    RUN_TEST(test_nan_control_temperature_renders_placeholder_and_fault);
    RUN_TEST(test_no_sensors_renders_fault_even_with_a_number);
    RUN_TEST(test_valid_reading_with_sensors_is_not_a_fault);
    RUN_TEST(test_formats_setpoint);
    RUN_TEST(test_copies_device_id);
    RUN_TEST(test_truncates_overlong_device_id);
    return UNITY_END();
}
```

- [ ] **Step 5: Add the library to the native test environment**

In `firmware/fermenter/platformio.ini`, in `[env:native]`, change:

```ini
lib_extra_dirs = ../shared/control
```

to:

```ini
lib_extra_dirs = ../shared/control, ../shared/display
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd firmware/fermenter && pio test -e native -f test_display_presenter`
Expected: FAIL — link error, `DisplayPresenter::update` and friends are declared but not defined.

- [ ] **Step 7: Implement the presenter**

Create `firmware/shared/display/src/DisplayPresenter.cpp`:

```cpp
#include "DisplayPresenter.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace unibrew {
namespace {

// Copies src into a fixed buffer, always null-terminating and truncating
// rather than overflowing. Returns true if the contents changed.
bool assign(char* dst, size_t capacity, const char* src) {
    if (src == nullptr) {
        src = "";
    }
    // Compares only the characters that fit, so re-assigning a string that
    // was already truncated to the same prefix correctly reports no change.
    if (std::strncmp(dst, src, capacity - 1) == 0) {
        return false;
    }
    std::strncpy(dst, src, capacity - 1);
    dst[capacity - 1] = '\0';
    return true;
}

void formatTemperature(float valueC, char* out, size_t capacity) {
    if (std::isnan(valueC)) {
        std::snprintf(out, capacity, "--.-");
        return;
    }
    std::snprintf(out, capacity, "%.1f", static_cast<double>(valueC));
}

const char* modeLabel(ControlMode mode) {
    switch (mode) {
        case ControlMode::OFF: return "mode: off";
        case ControlMode::PID: return "mode: pid";
        default: return "mode: thermostat";
    }
}

const char* outputLabel(ControlOutput output) {
    switch (output) {
        case ControlOutput::HEATING: return "HEATING";
        case ControlOutput::COOLING: return "COOLING";
        default: return "IDLE";
    }
}

} // namespace

void DisplayPresenter::setDirty(DisplayField field) {
    dirty_[static_cast<size_t>(field)] = true;
}

void DisplayPresenter::update(const DisplayModel& model) {
    if (assign(text_.deviceId, sizeof(text_.deviceId), model.deviceId)) {
        setDirty(DisplayField::DEVICE_ID);
    }

    char buffer[64];

    formatTemperature(model.controlTemperatureC, buffer, sizeof(buffer));
    if (assign(text_.controlTemp, sizeof(text_.controlTemp), buffer)) {
        setDirty(DisplayField::CONTROL_TEMP);
    }

    // A number with no sensors behind it is stale, not current: the control
    // loop has nothing to regulate on, so it is flagged as a fault even
    // though it formats cleanly.
    bool fault = std::isnan(model.controlTemperatureC) || model.sensorCount == 0;
    if (fault != text_.controlTempFault) {
        text_.controlTempFault = fault;
        setDirty(DisplayField::CONTROL_TEMP);
    }

    char setpointValue[16];
    formatTemperature(model.setpointC, setpointValue, sizeof(setpointValue));
    std::snprintf(buffer, sizeof(buffer), "setpoint %s", setpointValue);
    if (assign(text_.setpoint, sizeof(text_.setpoint), buffer)) {
        setDirty(DisplayField::SETPOINT);
    }

    if (assign(text_.output, sizeof(text_.output), outputLabel(model.output))) {
        setDirty(DisplayField::OUTPUT_BAND);
    }
    if (assign(text_.mode, sizeof(text_.mode), modeLabel(model.mode))) {
        setDirty(DisplayField::OUTPUT_BAND);
    }
    if (model.output != text_.outputState) {
        text_.outputState = model.output;
        setDirty(DisplayField::OUTPUT_BAND);
    }

    if (model.wifiConnected != text_.wifiConnected ||
        model.mqttConnected != text_.mqttConnected) {
        bool mqttChanged = model.mqttConnected != text_.mqttConnected;
        text_.wifiConnected = model.wifiConnected;
        text_.mqttConnected = model.mqttConnected;
        setDirty(DisplayField::CONNECTION);
        // Losing the broker does not stop the control loop. The screen has
        // to say so outright, otherwise a red indicator reads as "the
        // fermenter is dead" when it is still regulating perfectly well.
        if (mqttChanged) {
            setDirty(DisplayField::OFFLINE_NOTICE);
        }
    }

    text_.screen = model.screen;

    if (!initialized_) {
        initialized_ = true;
        markAllDirty();
    }
}

const DisplayText& DisplayPresenter::text() const {
    return text_;
}

bool DisplayPresenter::isDirty(DisplayField field) const {
    return dirty_[static_cast<size_t>(field)];
}

void DisplayPresenter::clearDirty() {
    for (size_t i = 0; i < kDisplayFieldCount; i++) {
        dirty_[i] = false;
    }
}

void DisplayPresenter::markAllDirty() {
    for (size_t i = 0; i < kDisplayFieldCount; i++) {
        dirty_[i] = true;
    }
}

} // namespace unibrew
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd firmware/fermenter && pio test -e native -f test_display_presenter`
Expected: PASS, 8 tests.

- [ ] **Step 9: Run the full native suite to confirm nothing regressed**

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS — the control loop, PID and sensor address suites all still green.

- [ ] **Step 10: Commit**

```bash
git add firmware/shared/display firmware/fermenter/test/test_display_presenter firmware/fermenter/platformio.ini
git commit -m "Add a hardware-free display model and presenter

Formatting and fault detection for the fermenter's screen, with no Arduino
dependency so it runs under the native test suite. A reading with no sensors
behind it counts as a fault: the control loop has nothing to regulate on,
even though the number formats cleanly."
```

---

### Task 2: Dirty tracking and label mapping

**Files:**
- Modify: `firmware/fermenter/test/test_display_presenter/test_main.cpp`
- Modify: `firmware/shared/display/src/DisplayPresenter.cpp` (only if a test exposes a defect)

**Interfaces:**
- Consumes: everything produced by Task 1.
- Produces: no new API. This task proves the dirty-tracking contract the renderer depends on — that a field is dirty only when its content actually changed.

- [ ] **Step 1: Write the failing tests**

Append these test functions to `firmware/fermenter/test/test_display_presenter/test_main.cpp`, immediately before `int main(...)`:

```cpp
void test_first_update_marks_everything_dirty(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::DEVICE_ID));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SETPOINT));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OFFLINE_NOTICE));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SENSORS));
}

void test_identical_update_marks_nothing_dirty(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();
    p.update(m);
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::DEVICE_ID));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::SETPOINT));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OFFLINE_NOTICE));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::SENSORS));
}

void test_mqtt_drop_dirties_the_offline_notice(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.mqttConnected = false;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OFFLINE_NOTICE));
}

void test_wifi_drop_alone_does_not_dirty_the_offline_notice(void) {
    // The notice is about the broker specifically — it claims the control
    // loop is still running, which is a statement about MQTT, not WiFi.
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.wifiConnected = false;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OFFLINE_NOTICE));
}

void test_sub_decimal_change_does_not_dirty_the_temperature(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    m.controlTemperatureC = 18.44f;
    p.update(m);
    p.clearDirty();

    m.controlTemperatureC = 18.43f; // still formats as "18.4"
    p.update(m);
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
}

void test_visible_temperature_change_dirties_only_that_field(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.controlTemperatureC = 19.1f;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::SETPOINT));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::OUTPUT_BAND));
}

void test_mqtt_drop_leaves_the_temperature_alone(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.mqttConnected = false;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::CONNECTION));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
    TEST_ASSERT_FALSE(p.text().mqttConnected);
}

void test_output_change_dirties_the_band(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.output = ControlOutput::COOLING;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_EQUAL_STRING("COOLING", p.text().output);
}

void test_mode_change_dirties_the_band(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();
    p.update(m);
    p.clearDirty();

    m.mode = ControlMode::PID;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::OUTPUT_BAND));
    TEST_ASSERT_EQUAL_STRING("mode: pid", p.text().mode);
}

void test_every_output_maps_to_its_label(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();

    m.output = ControlOutput::IDLE;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("IDLE", p.text().output);

    m.output = ControlOutput::HEATING;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("HEATING", p.text().output);

    m.output = ControlOutput::COOLING;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("COOLING", p.text().output);
    TEST_ASSERT_EQUAL(ControlOutput::COOLING, p.text().outputState);
}

void test_every_mode_maps_to_its_label(void) {
    DisplayPresenter p;
    DisplayModel m = makeModel();

    m.mode = ControlMode::OFF;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("mode: off", p.text().mode);

    m.mode = ControlMode::THERMOSTAT;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("mode: thermostat", p.text().mode);

    m.mode = ControlMode::PID;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("mode: pid", p.text().mode);
}

void test_mark_all_dirty_forces_a_full_repaint(void) {
    DisplayPresenter p;
    p.update(makeModel());
    p.clearDirty();
    p.markAllDirty();
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::DEVICE_ID));
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SENSORS));
}
```

Register them by adding these lines inside `main()`, after the existing `RUN_TEST` calls:

```cpp
    RUN_TEST(test_first_update_marks_everything_dirty);
    RUN_TEST(test_identical_update_marks_nothing_dirty);
    RUN_TEST(test_sub_decimal_change_does_not_dirty_the_temperature);
    RUN_TEST(test_visible_temperature_change_dirties_only_that_field);
    RUN_TEST(test_mqtt_drop_leaves_the_temperature_alone);
    RUN_TEST(test_mqtt_drop_dirties_the_offline_notice);
    RUN_TEST(test_wifi_drop_alone_does_not_dirty_the_offline_notice);
    RUN_TEST(test_output_change_dirties_the_band);
    RUN_TEST(test_mode_change_dirties_the_band);
    RUN_TEST(test_every_output_maps_to_its_label);
    RUN_TEST(test_every_mode_maps_to_its_label);
    RUN_TEST(test_mark_all_dirty_forces_a_full_repaint);
```

- [ ] **Step 2: Run the tests**

Run: `cd firmware/fermenter && pio test -e native -f test_display_presenter`
Expected: PASS. Task 1's implementation should already satisfy every one of these.

If `test_identical_update_marks_nothing_dirty` fails, the bug is in `assign()` — it must compare before copying, and must not report a change when the stored string is already equal.

- [ ] **Step 3: Commit**

```bash
git add firmware/fermenter/test/test_display_presenter/test_main.cpp
git commit -m "Cover the presenter's dirty-tracking contract

The renderer only repaints fields the presenter flags, so a field marked
dirty on an unchanged value costs a redraw and a missed flag leaves stale
pixels on screen. Pins both directions, including that a sub-decimal
temperature change does not count as visible."
```

---

### Task 3: Secondary sensor row

**Files:**
- Modify: `firmware/shared/display/src/DisplayPresenter.cpp`
- Modify: `firmware/fermenter/test/test_display_presenter/test_main.cpp`

**Interfaces:**
- Consumes: `DisplayModel::sensors`, `DisplayModel::sensorCount`, `DisplayModel::controlSensorAddressHex`.
- Produces: `DisplayText::sensors`, populated with up to three non-control sensors as `"XXXX 19.1"` entries separated by two spaces.

- [ ] **Step 1: Write the failing tests**

Append to `firmware/fermenter/test/test_display_presenter/test_main.cpp`, before `int main(...)`:

```cpp
static void addSensor(DisplayModel& m, const char* hex, float tempC) {
    std::strcpy(m.sensors[m.sensorCount].addressHex, hex);
    m.sensors[m.sensorCount].temperatureC = tempC;
    m.sensorCount++;
}

void test_sensor_row_is_empty_with_no_sensors(void) {
    DisplayPresenter p;
    p.update(makeModel());
    TEST_ASSERT_EQUAL_STRING("", p.text().sensors);
}

void test_sensor_row_omits_the_designated_control_sensor(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7", p.text().sensors);
}

void test_sensor_row_uses_the_last_four_hex_characters(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA1122334455AB", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("55AB 21.7", p.text().sensors);
}

void test_sensor_row_falls_back_to_omitting_the_first_sensor(void) {
    // No control sensor designated — ControlLoop controls on samples[0], so
    // the row must omit that one to match.
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7", p.text().sensors);
}

void test_sensor_row_joins_multiple_sensors(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    addSensor(m, "28BB112233447788", 19.0f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 21.7  7788 19.0", p.text().sensors);
}

void test_sensor_row_renders_a_faulted_sensor_as_placeholder(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", NAN);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("5566 --.-", p.text().sensors);
}

void test_sensor_row_caps_at_three_entries(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA000000001111", 1.0f);
    addSensor(m, "28AA000000002222", 2.0f);
    addSensor(m, "28AA000000003333", 3.0f);
    addSensor(m, "28AA000000004444", 4.0f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    TEST_ASSERT_EQUAL_STRING("1111 1.0  2222 2.0  3333 3.0", p.text().sensors);
}

void test_sensor_row_change_dirties_only_the_sensor_field(void) {
    DisplayModel m = makeModel();
    addSensor(m, "28FF641F0417033A", 18.4f);
    addSensor(m, "28AA112233445566", 21.7f);
    std::strcpy(m.controlSensorAddressHex, "28FF641F0417033A");

    DisplayPresenter p;
    p.update(m);
    p.clearDirty();

    m.sensors[1].temperatureC = 22.3f;
    p.update(m);
    TEST_ASSERT_TRUE(p.isDirty(DisplayField::SENSORS));
    TEST_ASSERT_FALSE(p.isDirty(DisplayField::CONTROL_TEMP));
}
```

Register them in `main()`:

```cpp
    RUN_TEST(test_sensor_row_is_empty_with_no_sensors);
    RUN_TEST(test_sensor_row_omits_the_designated_control_sensor);
    RUN_TEST(test_sensor_row_uses_the_last_four_hex_characters);
    RUN_TEST(test_sensor_row_falls_back_to_omitting_the_first_sensor);
    RUN_TEST(test_sensor_row_joins_multiple_sensors);
    RUN_TEST(test_sensor_row_renders_a_faulted_sensor_as_placeholder);
    RUN_TEST(test_sensor_row_caps_at_three_entries);
    RUN_TEST(test_sensor_row_change_dirties_only_the_sensor_field);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd firmware/fermenter && pio test -e native -f test_display_presenter`
Expected: FAIL — `text().sensors` is never populated, so every assertion but the empty-row one fails.

- [ ] **Step 3: Implement the sensor row**

In `firmware/shared/display/src/DisplayPresenter.cpp`, add to the anonymous namespace, after `outputLabel`:

```cpp
// How many non-control sensors fit on the bottom row at font 2 without
// running past 320 px.
constexpr size_t kMaxSecondarySensors = 3;
constexpr size_t kShortAddressChars = 4;

bool caseInsensitiveEquals(const char* a, const char* b) {
    for (size_t i = 0;; i++) {
        unsigned char ca = static_cast<unsigned char>(a[i]);
        unsigned char cb = static_cast<unsigned char>(b[i]);
        if (ca >= 'a' && ca <= 'z') ca = static_cast<unsigned char>(ca - 'a' + 'A');
        if (cb >= 'a' && cb <= 'z') cb = static_cast<unsigned char>(cb - 'a' + 'A');
        if (ca != cb) return false;
        if (ca == '\0') return true;
    }
}

// Writes the trailing kShortAddressChars of hex into out, or the whole
// string if it is shorter.
void shortAddress(const char* hex, char* out, size_t capacity) {
    size_t len = std::strlen(hex);
    const char* start = len > kShortAddressChars ? hex + (len - kShortAddressChars) : hex;
    std::snprintf(out, capacity, "%s", start);
}

void buildSensorRow(const DisplayModel& model, char* out, size_t capacity) {
    out[0] = '\0';

    size_t written = 0;
    for (size_t i = 0; i < model.sensorCount && written < kMaxSecondarySensors; i++) {
        // Skip whichever sensor the control loop is regulating on. With no
        // designated address it falls back to the first discovered sensor,
        // so this mirrors that fallback exactly.
        if (model.controlSensorAddressHex[0] != '\0') {
            if (caseInsensitiveEquals(model.sensors[i].addressHex, model.controlSensorAddressHex)) {
                continue;
            }
        } else if (i == 0) {
            continue;
        }

        char shortHex[kShortAddressChars + 1];
        shortAddress(model.sensors[i].addressHex, shortHex, sizeof(shortHex));

        char temp[8];
        formatTemperature(model.sensors[i].temperatureC, temp, sizeof(temp));

        char entry[24];
        std::snprintf(entry, sizeof(entry), "%s%s %s", written > 0 ? "  " : "", shortHex, temp);

        size_t remaining = capacity - std::strlen(out) - 1;
        std::strncat(out, entry, remaining);
        written++;
    }
}
```

Then, in `DisplayPresenter::update`, immediately before the `text_.screen = model.screen;` line, add:

```cpp
    char sensorRow[sizeof(text_.sensors)];
    buildSensorRow(model, sensorRow, sizeof(sensorRow));
    if (assign(text_.sensors, sizeof(text_.sensors), sensorRow)) {
        setDirty(DisplayField::SENSORS);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd firmware/fermenter && pio test -e native -f test_display_presenter`
Expected: PASS, 28 tests total (8 from Task 1, 12 from Task 2, 8 from this one).

- [ ] **Step 5: Run the full native suite**

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add firmware/shared/display/src/DisplayPresenter.cpp firmware/fermenter/test/test_display_presenter/test_main.cpp
git commit -m "Render non-control sensors on the bottom row

Labelled by the last four hex characters of their address — the firmware
receives no sensor names. Omits whichever sensor the control loop is
regulating on, mirroring its fallback to the first discovered sensor when no
address has been designated, so the big readout is never repeated below."
```

---

### Task 4: Board pins and TFT_eSPI build configuration

**Files:**
- Modify: `firmware/fermenter/include/pins.h`
- Modify: `firmware/fermenter/platformio.ini`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TFT_CS_PIN`, `TFT_DC_PIN`, `TFT_RST_PIN`, `TFT_LED_PIN`, `TFT_MOSI_PIN`, `TFT_MISO_PIN`, `TFT_SCLK_PIN`, `TFT_TOUCH_CS_PIN` as `constexpr uint8_t` at file scope in `pins.h`, plus the TFT_eSPI macros for Task 5.

- [ ] **Step 1: Replace the TFT comment block in `pins.h` with real constants**

In `firmware/fermenter/include/pins.h`, replace this comment:

```cpp
// NOT wired/used yet (TFT/touch display, IIC LCD variant — out of Phase 2
// scope): CS=IO14, DC=IO27, MISO=IO19, MOSI=IO23, SCK=IO18, T_CS=IO12,
// SCL=IO22, SDA=IO21.
```

with:

```cpp
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
```

- [ ] **Step 2: Add the TFT_eSPI dependency and build flags**

In `firmware/fermenter/platformio.ini`, under `[env:fermenter-brewpi]`, add `bodmer/TFT_eSPI @ ^2.5.43` to the end of `lib_deps`, append `../shared/display, ../shared/hal-display` to `lib_extra_dirs`, and add a `build_flags` block:

```ini
lib_extra_dirs = ../shared/control, ../shared/hal-control, ../shared/hal-mqtt, ../shared/hal-temp, ../shared/hal-ota, ../shared/display, ../shared/hal-display
lib_deps =
    knolleary/PubSubClient @ ^2.8
    milesburton/DallasTemperature @ ^3.11.0
    paulstoffregen/OneWire @ ^2.3.7
    bblanchon/ArduinoJson @ ^7.0.4
    bodmer/TFT_eSPI @ ^2.5.43
; TFT_eSPI is configured entirely through build flags rather than its own
; User_Setup.h. These belong to this environment alone — putting them in the
; shared [env] section pulls TFT_eSPI into the native test build, which has
; no Arduino framework to compile it against.
;
; SMOOTH_FONT is deliberately absent: it makes TFT_eSPI include SPIFFS.h,
; because smooth fonts are loaded from a filesystem at runtime. It does not
; compile here and would need a filesystem partition to buy nothing the
; built-in fonts do not already cover. See ADR-025.
;
; Pin numbers are asserted against include/pins.h at compile time.
build_flags =
    -std=gnu++17
    -DUSER_SETUP_LOADED=1
    -DILI9341_DRIVER=1
    -DTFT_MISO=19
    -DTFT_MOSI=23
    -DTFT_SCLK=18
    -DTFT_CS=14
    -DTFT_DC=27
    -DTFT_RST=33
    -DTFT_BL=32
    -DTFT_BACKLIGHT_ON=HIGH
    -DLOAD_GLCD=1
    -DLOAD_FONT2=1
    -DLOAD_FONT4=1
    -DLOAD_FONT6=1
    -DLOAD_FONT7=1
    -DLOAD_GFXFF=1
    -DSPI_FREQUENCY=27000000
```

Note: `[env]` already sets `build_flags = -std=gnu++17`. Defining `build_flags` in this environment overrides it entirely, which is why `-std=gnu++17` is repeated above. Omitting it silently drops C++17 for this build.

- [ ] **Step 3: Verify the assertions fire when they should**

Temporarily change `-DTFT_CS=14` to `-DTFT_CS=15` in `platformio.ini`.

Run: `cd firmware/fermenter && pio run -e fermenter-brewpi`
Expected: FAIL with `static assertion failed: TFT_CS build flag disagrees with pins.h`.

Change it back to `-DTFT_CS=14`.

- [ ] **Step 4: Verify the build succeeds**

Run: `cd firmware/fermenter && pio run -e fermenter-brewpi`
Expected: SUCCESS. Flash usage should be near the 53.5% baseline — TFT_eSPI is a declared dependency but nothing calls it yet, so the linker strips it.

- [ ] **Step 5: Commit**

```bash
git add firmware/fermenter/include/pins.h firmware/fermenter/platformio.ini
git commit -m "Wire up the TFT pins and TFT_eSPI's build configuration

The pin numbers have to exist both in pins.h and as TFT_eSPI build flags,
since the library resolves its mapping from macros. static_asserts make a
mismatch a compile error instead of a screen that never lights up."
```

---

### Task 5: `hal-display` renderer

**Files:**
- Create: `firmware/shared/hal-display/library.json`
- Create: `firmware/shared/hal-display/src/TftDisplay.h`
- Create: `firmware/shared/hal-display/src/TftDisplay.cpp`

**Interfaces:**
- Consumes: `unibrew::DisplayPresenter`, `unibrew::DisplayText`, `unibrew::DisplayField`, `unibrew::DisplayScreen`, `unibrew::ControlOutput`.
- Produces: `unibrew::TftDisplay` with `void begin()`, `void render(DisplayPresenter& presenter)`, `void showOta()`.

- [ ] **Step 1: Create the library manifest**

Create `firmware/shared/hal-display/library.json`:

```json
{
  "name": "unibrew-hal-display",
  "version": "0.1.0",
  "description": "TFT_eSPI renderer for the UniBrew fermenter's ILI9341 status display. Contains no formatting or state logic — that lives in unibrew-display, which is hardware-free and natively tested.",
  "frameworks": ["arduino"],
  "platforms": ["espressif32"],
  "dependencies": {
    "bodmer/TFT_eSPI": "^2.5.43"
  }
}
```

- [ ] **Step 2: Create the renderer header**

Create `firmware/shared/hal-display/src/TftDisplay.h`:

```cpp
#pragma once
#include <TFT_eSPI.h>

#include "DisplayPresenter.h"

namespace unibrew {

// Draws the fermenter status screen. Holds no state beyond what is needed to
// know whether the static chrome has been drawn — every value on screen
// comes from the presenter, which owns all formatting and change detection.
class TftDisplay {
public:
    void begin();

    // Repaints only the fields the presenter has flagged dirty, then clears
    // those flags. Cheap enough to call every second: a steady-state tick
    // with nothing changed issues no SPI traffic at all.
    void render(DisplayPresenter& presenter);

    // Full-screen takeover for a firmware update. Must be called before
    // OtaUpdater::begin(), which blocks with the watchdog disabled and
    // reboots on success — nothing after it runs.
    void showOta();

private:
    TFT_eSPI tft_;
    bool chromeDrawn_ = false;

    void drawChrome();
};

} // namespace unibrew
```

- [ ] **Step 3: Implement the renderer**

Create `firmware/shared/hal-display/src/TftDisplay.cpp`:

```cpp
#include "TftDisplay.h"

namespace unibrew {
namespace {

// Layout for a 320x240 panel in landscape (rotation 1). Each constant group
// is one repaintable region, matching a DisplayField.
constexpr int16_t kScreenW = 320;
constexpr int16_t kScreenH = 240;

constexpr int16_t kDeviceIdX = 4;
constexpr int16_t kDeviceIdY = 4;
constexpr int16_t kDeviceIdW = 200;
constexpr int16_t kDeviceIdH = 18;

constexpr int16_t kConnX = 208;
constexpr int16_t kConnY = 4;
constexpr int16_t kConnW = 108;
constexpr int16_t kConnH = 18;

constexpr int16_t kHeaderRuleY = 26;

constexpr int16_t kTempX = 16;
constexpr int16_t kTempY = 40;
constexpr int16_t kTempW = 216;
constexpr int16_t kTempH = 52;
constexpr int16_t kUnitX = 240;
constexpr int16_t kUnitY = 60;

constexpr int16_t kSetpointX = 20;
constexpr int16_t kSetpointY = 100;
constexpr int16_t kSetpointW = 260;
constexpr int16_t kSetpointH = 28;

constexpr int16_t kOfflineX = 20;
constexpr int16_t kOfflineY = 114;
constexpr int16_t kOfflineW = 296;
constexpr int16_t kOfflineH = 18;

constexpr int16_t kBandY = 136;
constexpr int16_t kBandH = 44;
constexpr int16_t kBandTextX = 12;
constexpr int16_t kBandTextY = 148;
constexpr int16_t kModeX = 150;
constexpr int16_t kModeY = 152;

constexpr int16_t kFooterRuleY = 190;

constexpr int16_t kSensorsX = 4;
constexpr int16_t kSensorsY = 202;
constexpr int16_t kSensorsW = 312;
constexpr int16_t kSensorsH = 20;

uint16_t bandColour(ControlOutput output) {
    switch (output) {
        case ControlOutput::HEATING: return TFT_RED;
        case ControlOutput::COOLING: return TFT_BLUE;
        default: return TFT_DARKGREY;
    }
}

} // namespace

void TftDisplay::begin() {
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);

    tft_.init();
    tft_.setRotation(1);
    tft_.fillScreen(TFT_BLACK);
    chromeDrawn_ = false;
}

void TftDisplay::drawChrome() {
    tft_.fillScreen(TFT_BLACK);
    tft_.drawFastHLine(0, kHeaderRuleY, kScreenW, TFT_DARKGREY);
    tft_.drawFastHLine(0, kFooterRuleY, kScreenW, TFT_DARKGREY);

    // The big readout uses font 7, a seven-segment face carrying only
    // digits, '.', '-' and ':' — so the unit is drawn separately in a text
    // font and never repainted.
    tft_.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    tft_.drawString("C", kUnitX, kUnitY, 4);

    chromeDrawn_ = true;
}

void TftDisplay::render(DisplayPresenter& presenter) {
    const DisplayText& text = presenter.text();

    if (!chromeDrawn_) {
        drawChrome();
        presenter.markAllDirty();
    }

    if (presenter.isDirty(DisplayField::DEVICE_ID)) {
        tft_.fillRect(kDeviceIdX, kDeviceIdY, kDeviceIdW, kDeviceIdH, TFT_BLACK);
        tft_.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft_.drawString(text.deviceId, kDeviceIdX, kDeviceIdY, 2);
    }

    if (presenter.isDirty(DisplayField::CONNECTION)) {
        tft_.fillRect(kConnX, kConnY, kConnW, kConnH, TFT_BLACK);
        tft_.setTextColor(text.wifiConnected ? TFT_GREEN : TFT_RED, TFT_BLACK);
        tft_.drawString("WiFi", kConnX, kConnY, 2);
        tft_.setTextColor(text.mqttConnected ? TFT_GREEN : TFT_RED, TFT_BLACK);
        tft_.drawString("MQTT", kConnX + 56, kConnY, 2);
    }

    if (presenter.isDirty(DisplayField::CONTROL_TEMP)) {
        tft_.fillRect(kTempX, kTempY, kTempW, kTempH, TFT_BLACK);
        tft_.setTextColor(text.controlTempFault ? TFT_RED : TFT_WHITE, TFT_BLACK);
        tft_.drawString(text.controlTemp, kTempX, kTempY, 7);
    }

    if (presenter.isDirty(DisplayField::SETPOINT)) {
        tft_.fillRect(kSetpointX, kSetpointY, kSetpointW, kSetpointH, TFT_BLACK);
        tft_.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft_.drawString(text.setpoint, kSetpointX, kSetpointY, 4);
    }

    if (presenter.isDirty(DisplayField::OFFLINE_NOTICE)) {
        tft_.fillRect(kOfflineX, kOfflineY, kOfflineW, kOfflineH, TFT_BLACK);
        if (!text.mqttConnected) {
            tft_.setTextColor(TFT_ORANGE, TFT_BLACK);
            tft_.drawString("offline - still controlling", kOfflineX, kOfflineY, 2);
        }
    }

    if (presenter.isDirty(DisplayField::OUTPUT_BAND)) {
        uint16_t colour = bandColour(text.outputState);
        tft_.fillRect(0, kBandY, kScreenW, kBandH, colour);
        tft_.setTextColor(TFT_WHITE, colour);
        tft_.drawString(text.output, kBandTextX, kBandTextY, 4);
        tft_.drawString(text.mode, kModeX, kModeY, 2);
    }

    if (presenter.isDirty(DisplayField::SENSORS)) {
        tft_.fillRect(kSensorsX, kSensorsY, kSensorsW, kSensorsH, TFT_BLACK);
        tft_.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft_.drawString(text.sensors, kSensorsX, kSensorsY, 2);
    }

    presenter.clearDirty();
}

void TftDisplay::showOta() {
    tft_.fillScreen(TFT_BLACK);
    tft_.setTextColor(TFT_YELLOW, TFT_BLACK);
    tft_.drawString("Updating firmware", 20, 90, 4);
    tft_.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    tft_.drawString("Do not power off", 20, 130, 4);

    // The status screen's chrome is gone; force a full redraw if this device
    // somehow returns here instead of rebooting.
    chromeDrawn_ = false;
}

} // namespace unibrew
```

- [ ] **Step 4: Verify it compiles**

Run: `cd firmware/fermenter && pio run -e fermenter-brewpi`
Expected: SUCCESS. Flash still near baseline — `main.cpp` does not reference `TftDisplay` yet, so the linker continues to strip it.

- [ ] **Step 5: Verify the native suite is untouched**

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS. `hal-display` is not in the native environment's `lib_extra_dirs`, so it must not be compiled there at all.

- [ ] **Step 6: Commit**

```bash
git add firmware/shared/hal-display
git commit -m "Add the TFT_eSPI renderer

Draws static chrome once, then repaints only the regions the presenter
flagged, so a steady-state tick issues no SPI traffic. Holds no state beyond
whether the chrome exists — every value comes from the presenter."
```

---

### Task 6: Wire the display into the fermenter firmware

**Files:**
- Modify: `firmware/fermenter/src/main.cpp`

**Interfaces:**
- Consumes: `unibrew::DisplayModel`, `unibrew::DisplayPresenter`, `unibrew::TftDisplay`, and the existing `controlLoop`, `mqttClient`, `sensorManager`, `configStore` globals.
- Produces: no new public API.

- [ ] **Step 1: Add the includes**

In `firmware/fermenter/src/main.cpp`, after `#include "OtaUpdater.h"`, add:

```cpp
#include "DisplayModel.h"
#include "DisplayPresenter.h"
#include "TftDisplay.h"
```

and add to the `using` declarations near the top:

```cpp
using unibrew::DisplayModel;
using unibrew::DisplayPresenter;
using unibrew::DisplayScreen;
using unibrew::TftDisplay;
```

- [ ] **Step 2: Add the globals and interval**

In the anonymous namespace, after `constexpr uint32_t kStatusIntervalMs = 30000;`, add:

```cpp
// The screen ticks faster than telemetry so WiFi/MQTT indicators react
// promptly, but temperatures only change on the telemetry pass — the
// OneWire bus is not read any more often than before.
constexpr uint32_t kDisplayIntervalMs = 1000;
```

After `OtaUpdater otaUpdater;`, add:

```cpp
DisplayModel displayModel;
DisplayPresenter displayPresenter;
TftDisplay display;
```

After `uint32_t lastStatusMs = 0;`, add:

```cpp
uint32_t lastDisplayMs = 0;
```

- [ ] **Step 3: Add the model refresh helpers**

Immediately before `void publishTelemetry(...)`, add:

```cpp
// Copies the freshly read samples into the display model, converting each
// raw address to hex at this boundary. The display library deliberately
// does not include SensorManager.h — that header pulls in OneWire and
// DallasTemperature, which would make it unbuildable natively.
void refreshDisplaySensors(const SensorSample* samples, size_t count, float controlTemperatureC) {
    size_t limit = count < unibrew::kDisplayMaxSensors ? count : unibrew::kDisplayMaxSensors;
    for (size_t i = 0; i < limit; i++) {
        unibrew::formatSensorAddress(samples[i].address,
                                     displayModel.sensors[i].addressHex,
                                     sizeof(displayModel.sensors[i].addressHex));
        displayModel.sensors[i].temperatureC = samples[i].temperatureC;
    }
    displayModel.sensorCount = limit;
    displayModel.controlTemperatureC = controlTemperatureC;
}

// Fields that can change without a sensor read: connection state and
// anything the backend may have pushed since the last tick.
void refreshDisplayState() {
    const ControlConfig& config = controlLoop.config();
    displayModel.setpointC = config.setpointC;
    displayModel.mode = config.mode;
    displayModel.output = controlLoop.currentOutput();
    displayModel.wifiConnected = (WiFi.status() == WL_CONNECTED);
    displayModel.mqttConnected = mqttClient.connected();
    strncpy(displayModel.controlSensorAddressHex,
            controlSensorAddressHex,
            sizeof(displayModel.controlSensorAddressHex) - 1);
    displayModel.controlSensorAddressHex[sizeof(displayModel.controlSensorAddressHex) - 1] = '\0';
}
```

- [ ] **Step 4: Draw the OTA screen before the blocking update**

In `onOtaMessage`, replace:

```cpp
    esp_task_wdt_delete(nullptr);
    otaUpdater.begin(url, md5);
```

with:

```cpp
    // Drawn before begin(), which blocks with the watchdog disabled and
    // reboots on success — nothing after it runs.
    displayModel.screen = DisplayScreen::OTA;
    display.showOta();

    esp_task_wdt_delete(nullptr);
    otaUpdater.begin(url, md5);
```

- [ ] **Step 5: Initialise the display in `setup()`**

In `setup()`, immediately after `Serial.println("\n[boot] UniBrew fermenter firmware starting");`, add:

```cpp
    display.begin();
    displayModel.screen = DisplayScreen::STATUS;
    displayModel.deviceId = DEVICE_ID;
    refreshDisplayState();
    displayPresenter.update(displayModel);
    display.render(displayPresenter);
```

The display comes up before WiFi so the screen is alive during the 15-second connection attempt rather than staying black.

- [ ] **Step 6: Feed the model from the telemetry pass**

In `loop()`, inside the telemetry branch, after `applyRelayOutput(output);` and before `publishTelemetry(samples, count);`, add:

```cpp
        refreshDisplaySensors(samples, count, controlTemperatureC);
```

- [ ] **Step 7: Add the display tick**

In `loop()`, after the status branch, add:

```cpp
    if (now - lastDisplayMs >= kDisplayIntervalMs) {
        lastDisplayMs = now;
        if (displayModel.screen == DisplayScreen::STATUS) {
            refreshDisplayState();
            displayPresenter.update(displayModel);
            display.render(displayPresenter);
        }
    }
```

The screen check keeps a queued tick from painting the status layout over the OTA notice while an update is in flight.

- [ ] **Step 8: Verify it builds and check the flash cost**

Run: `cd firmware/fermenter && pio run -e fermenter-brewpi`
Expected: SUCCESS, flash around 55–56% (baseline was 53.5%). Anything above 70% means something unexpected got linked in — investigate before continuing.

- [ ] **Step 9: Verify the native suite still passes**

Run: `cd firmware/fermenter && pio test -e native`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add firmware/fermenter/src/main.cpp
git commit -m "Drive the status display from the fermenter loop

Reuses state the loop already computes, so the OneWire bus is read no more
often than before. The screen ticks every second for connection state while
temperatures follow the 2s telemetry pass.

The OTA notice is drawn before OtaUpdater::begin(), which blocks with the
watchdog disabled and reboots on success."
```

---

### Task 7: Document the display

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Document it in the README**

In `README.md`, in the "Adding a device" section under the `Fermenter/kegerator:` bullet in step 4, add a new bullet immediately after it:

```markdown
   - **Fermenter display (optional):** an ILI9341 320×240 SPI screen can be wired to the controller board's 2×5 TFT box header to show temperature, setpoint, mode and heat/cool state without opening this UI. It is read-only — nothing is configured from the board. Header pin 1 supplies **5 V**, so check the module's VCC marking before connecting it; a 3.3 V-only panel must be fed from 3V3 with that pin left unconnected. No firmware flag to enable it: the display code is always built, and a board with no screen attached simply has nothing listening on the SPI bus. Pin map and rationale are in `docs/specs/2026-07-28-fermenter-tft-status-display-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document the fermenter's optional status display

Flags the 5V header pin, since a 3.3V-only panel connected to it is the one
mistake in this build that damages hardware."
```

---

## Verification

After all tasks, from `firmware/fermenter`:

```bash
pio test -e native          # all four suites green, including the control loop
pio run -e fermenter-brewpi # builds, flash well under the 1.2 MB slot
```

On hardware, with the panel connected and `secrets.h` filled in:

```bash
pio run -e fermenter-brewpi -t upload
pio device monitor
```

Expect the screen to light up during boot, show `--.-` in red until sensors are discovered, then the measured temperature, and the band to change colour and label when the control loop switches output.

**Not covered by tests, verify by eye:** that text fits its rectangles at the chosen font sizes, and that repainting leaves no residue from longer previous strings. Layout constants in `TftDisplay.cpp` are the place to adjust.

If the panel stays black: confirm the backlight pin, then that the module tolerates 5 V on header pin 1. If it shows noise or garbled pixels, drop `SPI_FREQUENCY` from 27 MHz — long flying leads from the box header tolerate less than a short ribbon.
