#include "ConfigStore.h"

namespace unibrew {

void ConfigStore::begin() {
    prefs_.begin(kNamespace, false);
}

ControlConfig ConfigStore::load() {
    ControlConfig defaults; // safe defaults on first boot, per §7

    ControlConfig config;
    config.setpointC = prefs_.getFloat("setpointC", defaults.setpointC);
    config.hysteresisC = prefs_.getFloat("hysteresisC", defaults.hysteresisC);
    config.minOnTimeMs = prefs_.getULong("minOnTimeMs", defaults.minOnTimeMs);
    config.minOffTimeMs = prefs_.getULong("minOffTimeMs", defaults.minOffTimeMs);
    config.mode = static_cast<ControlMode>(
        prefs_.getUChar("mode", static_cast<uint8_t>(defaults.mode)));
    config.coolingEnabled = prefs_.getBool("coolingEnabled", defaults.coolingEnabled);
    config.heatingEnabled = prefs_.getBool("heatingEnabled", defaults.heatingEnabled);
    return config;
}

void ConfigStore::save(const ControlConfig& config) {
    prefs_.putFloat("setpointC", config.setpointC);
    prefs_.putFloat("hysteresisC", config.hysteresisC);
    prefs_.putULong("minOnTimeMs", config.minOnTimeMs);
    prefs_.putULong("minOffTimeMs", config.minOffTimeMs);
    prefs_.putUChar("mode", static_cast<uint8_t>(config.mode));
    prefs_.putBool("coolingEnabled", config.coolingEnabled);
    prefs_.putBool("heatingEnabled", config.heatingEnabled);
}

} // namespace unibrew
