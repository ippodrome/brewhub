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
