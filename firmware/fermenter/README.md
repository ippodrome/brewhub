# firmware/fermenter

ESP32 firmware for the fermentation chamber controller (BrewPi ESP D32-style board).

## Running the control-loop tests

The control logic in `../shared/control` has zero hardware dependencies and runs natively on the host — no ESP32 or sensors required:

```
cd firmware/fermenter
pio test -e native
```

All tests must pass before any change to `ControlLoop` is considered done — see `claude.md` §8.

## Building for hardware

```
pio run -e fermenter-brewpi
```
