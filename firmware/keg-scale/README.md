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

`LOADCELL_CALIBRATION_FACTOR` in `include/pins.h` converts the HX711's raw ADC units into grams, and is specific to your exact load cell — the shipped value is a placeholder from the reference design this firmware is based on and is almost certainly wrong for yours. There's no dedicated calibration sketch/mode yet (a possible future improvement); calibrate by iterating on the real firmware:

1. Flash with the placeholder factor, platform empty, `pio device monitor` open.
2. Place a known reference weight on the platform (e.g. a 5.000 kg weight, or anything you can weigh accurately elsewhere first).
3. Read the reported grams from the serial log or the device's live telemetry (BrewHub UI → device card → weight readout).
4. New factor = current `LOADCELL_CALIBRATION_FACTOR` × (reported grams ÷ actual known grams).
5. Update `pins.h` with the new factor, reflash, repeat from step 2 until the reported weight matches the known weight closely.

Once calibrated, use the device card's "Tare" button to zero the scale — **only** with the platform in its true empty reference state (no keg on it). Taring with a keg already on the platform will make every weight-based tap's remaining-volume calculation wrong until re-tared correctly, since tap calibration (`tareWeightG`/`fullWeightG`, set per tap in the Taps UI) assumes the scale reports the keg's actual absolute weight, not a weight relative to some other zero point.
