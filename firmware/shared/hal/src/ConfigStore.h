#pragma once
#include <Preferences.h>
#include "ControlLoop.h"

namespace unibrew {

// Persists ControlConfig to NVS so the device can resume its last-known
// configuration after a reboot or extended MQTT outage — the concrete
// implementation of ADR-004's "local fallback" requirement.
class ConfigStore {
public:
    void begin();

    // Returns the last-saved config, or ControlConfig{}'s safe defaults if
    // nothing has ever been saved (first boot).
    ControlConfig load();

    void save(const ControlConfig& config);

private:
    Preferences prefs_;
    static constexpr const char* kNamespace = "unibrew-cfg";
};

} // namespace unibrew
