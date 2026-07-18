# firmware/keg-scale

ESP32 firmware for a `keg_scale` device — an HX711 load cell reporting weight, used as a weight-based alternative to a kegerator's flow meters for tracking remaining keg volume (see `compute-weight-volume.ts` on the backend for the volume math).

## Building for hardware

```
cd firmware/keg-scale
cp include/secrets.h.example include/secrets.h   # fill in WiFi/MQTT/DEVICE_ID
pio run -e keg-scale -t upload
```

There's no `env:native` here — unlike `fermenter`/`kegerator`, this device has no control loop (`ControlLoop`/`PidController`), just a sensor read + MQTT publish, so there's no pure logic to unit-test in isolation.

## Calibration

`LOADCELL_CALIBRATION_FACTOR` in `include/pins.h` converts the HX711's raw ADC units into grams, and is specific to your exact load cell — the shipped value is a placeholder from the reference design this firmware is based on and is almost certainly wrong for yours. It's only the **first-boot fallback** now, though: once a real factor has been set from the UI (see below), the device persists it to NVS and uses that instead on every subsequent boot, ignoring this constant — no reflash needed to calibrate or recalibrate.

Calibrate from the BrewHub UI — no reflashing required:

1. Flash once with the placeholder factor, platform empty.
2. Place a known reference weight on the platform (e.g. a 5.000 kg weight, or anything you can weigh accurately elsewhere first).
3. Read the reported grams from the device's live telemetry (BrewHub UI → device card → weight readout).
4. New factor = current factor (the compiled-in placeholder, the first time) × (reported grams ÷ actual known grams).
5. Enter the new factor in the device card's "Calibrate" field and apply — it's pushed over MQTT as declarative config (the same pattern as setpoint/hysteresis, see DECISIONS.md ADR-004/ADR-019), applied immediately, and persisted on-device. Repeat from step 2 until the reported weight matches the known weight closely — each iteration is just a UI edit, not a rebuild/reflash.

Once calibrated, use the device card's "Tare" button to zero the scale — **only** with the platform in its true empty reference state (no keg on it). Taring with a keg already on the platform will make every weight-based tap's remaining-volume calculation wrong until re-tared correctly, since tap calibration (`tareWeightG`/`fullWeightG`, set per tap in the Taps UI) assumes the scale reports the keg's actual absolute weight, not a weight relative to some other zero point.
