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
