# UniBrew Control (BrewHub)

**Project Specification for Senior Full-Stack + Embedded Engineer**

You are an extremely experienced senior engineer with deep expertise in:
- Modern TypeScript/Node.js (or Go) backend architecture
- High-quality React/Vue/Svelte frontends with excellent UX
- Embedded systems and ESP32 firmware (PlatformIO / ESP-IDF)
- MQTT systems, real-time applications, and reliable IoT architectures
- Docker, Unraid, and self-hosted infrastructure
- Professional code quality, clean architecture, and long-term maintainability
- Rigorous testing of control systems (especially temperature control loops)

Your task is to build a production-grade system from this specification. Prioritize correctness, reliability, clean code, and elegant solutions over speed of delivery. Every component should feel solid and intentional.

**Critical priority**: Temperature control must be correct and stable. Bad temperature control ruins beer.

---

## 0. Architecture Decisions (Resolved)

The decisions below were open questions in earlier drafts of this spec and are now resolved. Full rationale and alternatives considered live in `DECISIONS.md`; this section states the outcome so implementation can proceed directly.

1. **Backend language & framework — TypeScript (Node.js 22+) + Fastify.**
   The ESP32 owns the safety-critical control loop and keeps running on last-known config if the backend is down (see §3, §7, and decision 4 below) — so the backend's job is orchestration, UI, and persistence, not hard real-time control. That makes shared types with the mandated React/TS frontend (via a `packages/shared-types` workspace) more valuable than Go's raw concurrency/runtime characteristics. Every MQTT and API boundary MUST validate with Zod against the shared schema — this, not the language choice, is what actually prevents "malformed device data → bad backend decision" bugs.

2. **Monorepo, pnpm workspaces.** Layout:
   ```
   brewhub/
   ├── apps/
   │   ├── backend/          # Fastify API + MQTT + WS + OTA orchestration
   │   └── frontend/         # React + Vite SPA
   ├── firmware/
   │   ├── kegerator/        # PlatformIO env: kegerator-kegcop
   │   ├── fermenter/        # PlatformIO env: fermenter-brewpi
   │   └── shared/           # shared control-loop core, hardware abstraction, MQTT client
   ├── packages/
   │   └── shared-types/     # Zod schemas — single source of truth for MQTT + API payloads
   ├── docker/
   │   └── docker-compose.yml   # unibrew backend, mosquitto, caddy
   └── DECISIONS.md
   ```

3. **Database — SQLite via `better-sqlite3`, WAL mode.** Single device set, single writer, modest telemetry volume (low millions of rows over years even at a 5s cadence) — a second Postgres container would be pure operational overhead (backup, version sync, no HA benefit at this scale) with zero upside. Add a scheduled rollup job that downsamples telemetry older than 30 days to hourly averages so DB size stays bounded indefinitely. File-based backup (copy the `.db`) directly satisfies the backup/restore feature in §5.4.

4. **Control loop authority — ESP32 only, always.** The backend NEVER sends direct actuator commands. It only ever pushes declarative config (setpoint, mode, PID gains, profile) as a retained MQTT message; the ESP32's local loop is the only thing that decides relay state, using whatever config it last received (from NVS if offline). Manual overrides (e.g. "force cooling for cleaning") are modeled as a config change with a TTL, auto-expiring back to normal control — never a raw "turn relay on" RPC, so a dropped message can never leave an actuator stuck. **This is the single decision most responsible for meeting the "bad temperature control ruins beer" requirement — do not compromise it for convenience later.**

5. **Hardware abstraction — one firmware codebase, per-board PlatformIO environments.** A shared core (`SensorManager`, `ActuatorManager` with interlocks + min on/off enforcement, `MQTTClient`, `ConfigStore`, generic `ControlLoop`) is 100% shared between device types. Each board (Keg Cop PCB, BrewPi ESP D32 PCB) gets its own PlatformIO environment defining only a compile-time pin map. Adding new hardware later = a new environment + pin map, zero logic duplication.

6. **Testing strategy — native, hardware-free, on every commit.** Control algorithms (PID, hysteresis/deadband state machine, min on/off timing, profile interpolation) are pure functions/classes with no Arduino/ESP-IDF dependency, tested via `pio test -e native` (Unity). Backend profile-resolution logic (time/gravity-based step → setpoint) gets plain `vitest` unit tests. See §8 for required cases.

7. **HTTPS is required, even for LAN-only use.** WebSerial (§5.1) only works in a secure context (HTTPS or `localhost`) — plain HTTP over the LAN silently breaks in-browser flashing. Run Caddy as a reverse proxy in front of the backend/frontend from day one, with a self-signed or `mkcert`-issued local cert trusted on your own devices.

8. **MQTT stays plaintext on the trusted LAN, but requires auth.** TLS costs handshake time and RAM on a memory-constrained ESP32 for no real benefit when broker, backend, and devices all sit on the same trusted home network (and the project's own non-goals rule out cloud exposure). Mosquitto MUST still require username/password auth so no arbitrary LAN device can publish commands. Revisit TLS only if the broker is ever exposed beyond the LAN.

9. **OTA and flash endpoints reuse the existing JWT/local-user auth** (§4) — no separate mechanism, just make sure these specific routes are never accidentally left open during implementation.

---

## 1. Project Vision

Build a unified, modern control platform that fully replaces both **Keg Cop** and **BrewPiLess**.

### Initial Scope
Start with exactly:
- **1 × Kegerator**
- **1 × Fermentation chamber**

The architecture must support adding more devices later, but the first working system should target only these two.

### Goals
- Significantly more stable, reliable and responsive than the original solutions
- All heavy logic and state management runs in a Docker container on Unraid
- ESP32 devices act as thin, robust edge nodes with local fallback capability
- Single beautiful web application that controls both kegerators and fermentation chambers
- Full device lifecycle management from the UI (discover, configure, flash, remove)
- Design language identical in quality and feel to `patchsheet.se` and `reklamovertid.se`

### Non-Goals
- Supporting ESP8266
- Cloud dependency (system must work fully offline/local)
- Overly complex multi-tenancy in v1
- Perfect feature parity with every edge-case of the original projects on day one (focus on core reliability first)

---

## 2. Hardware Reference

### Kegerator hardware
Base the kegerator node on the existing Keg Cop PCB designs and pinouts:

- Repository: https://github.com/lbussy/keg-cop/tree/main/pcb
- Support the main board + daisy-chain flow meter boards + sensor board approach
- Up to 9 flow meters, multiple DS18B20 sensors, cooling relay, optional solenoid

### Fermentation chamber hardware
Base the fermentation node on the common BrewPiLess / BrewPi ESP style boards:

- Reference PCB: https://www.pcbway.com/project/shareproject/BrewPi_ESP_D32_TFT_IIC_LCD_Base_PCB_d8a123ce.html
- Typical configuration: ESP32 + DS18B20 (beer + fridge + room) + heating relay + cooling relay
- Optional TFT / I2C LCD support is nice-to-have but not required for v1

Firmware must be flexible enough to support both hardware families with clean configuration rather than hard-coded pinouts.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Unraid Host                          │
│  ┌──────────────────┐    ┌──────────────────────────────┐  │
│  │  Docker: UniBrew │    │  Mosquitto (MQTT Broker)     │  │
│  │  - Backend API   │◄──►│                              │  │
│  │  - Web Frontend  │    └──────────────────────────────┘  │
│  │  - Database      │                                       │
│  │  - Firmware      │                                       │
│  │    build/OTA     │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ MQTT (TLS optional)
                              ▼
               ┌──────────────────────────────┐
               │     ESP32 Edge Nodes         │
               │  - Sensors (DS18B20, flow)   │
               │  - Actuators (relays/SSR)    │
               │  - Local PID / fallback      │
               │  - OTA capable               │
               └──────────────────────────────┘
```

**Core principles:**
- Backend is the source of truth for setpoints, profiles and configuration
- ESP32s execute control loops locally and report state continuously
- If MQTT connection is lost, ESP32 continues running the last known good configuration (local fallback)
- All configuration changes and firmware updates are driven from the web UI
- Backend never issues direct actuator commands — only declarative config, with TTL'd overrides for manual intervention (see §0.4 for the exact contract)

---

## 4. Recommended Tech Stack

### Backend
- **Language**: TypeScript (Node.js 22+) — see §0.1
- **Framework**: Fastify
- **Validation**: Zod schemas from `packages/shared-types` at every MQTT/API/WS boundary — mandatory, not optional
- **Database**: SQLite via `better-sqlite3`, WAL mode, scheduled retention rollups — see §0.3
- **MQTT**: mqtt.js, connecting to Mosquitto with username/password auth (no TLS on LAN — see §0.8)
- **Real-time**: WebSocket (for live UI updates)
- **Auth**: JWT + local user (single or few users is fine for v1); also gates OTA/flash endpoints — see §0.9
- **Firmware handling**: Ability to store firmware binaries + trigger OTA, plus WebSerial support on the frontend
- **Reverse proxy**: Caddy, terminating HTTPS with a local/self-signed cert — required for WebSerial, see §0.7

### Frontend
- Modern SPA (React + TypeScript + Vite recommended)
- Tailwind CSS + excellent component architecture
- Real-time updates via WebSocket
- Dark / light mode
- Extremely clean, professional UI matching the quality of the reference sites
- Mobile-first responsive design + PWA capabilities

### ESP32 Firmware
- PlatformIO + Arduino framework (preferred for speed) or pure ESP-IDF
- Clean modular structure
- MQTT client with robust reconnection
- Local control loops (PID + simple thermostat)
- Support for:
  - Multiple DS18B20 (OneWire)
  - Flow meters (pulse counting with debouncing)
  - Relays / SSR (heating + cooling)
  - Optional: pressure sensor, humidity
  - Bluetooth for Tilt / Rapt Pill (ESP32 only)
- OTA updates
- Configuration stored in NVS / LittleFS
- Graceful degradation when offline

---

## 5. Core Features

### 5.1 Device Management (Critical)
From the web UI the user must be able to:
- Add a new device (manual or discovery)
- Configure device type (`kegerator`, `fermenter`, `sensor`)
- Assign sensors and actuators to logical roles
- Set calibration values
- Name the device and assign it to a logical "chamber" or "kegerator"
- **Flash firmware** directly from the browser (WebSerial for initial flash + OTA for subsequent)
- Remove a device cleanly
- See live status (online/offline, last seen, current readings, control state)

### 5.2 Kegerator Module
Must support (or improve upon) Keg Cop capabilities:
- Up to 9 flow meters with accurate pulse counting and calibration (volume or weight)
- Real-time remaining volume calculation and history
- Tap list management (name, style, ABV, IBU, notes, image)
- Multiple temperature sensors (chamber, keg, tower, room…)
- Cooling control (simple but robust thermostat with hysteresis + min on/off times)
- Optional solenoid control
- Pour event logging

### 5.3 Fermentation Module
Must support (or improve upon) BrewPiLess capabilities:
- Full PID control for beer and fridge temperature
- Control modes: Beer Constant, Fridge Constant, Profile
- Time-based and gravity-based temperature profiles (at least 10 steps)
- Support for wireless hydrometers (iSpindel, Tilt, Rapt Pill)
- Gravity logging + temperature correction
- Heating + cooling actuators with proper deadband and timing constraints
- Glycol mode considerations
- Optional pressure / spunding support

### 5.4 Shared Platform Features
- Unified dashboard showing all devices and their current state
- Beautiful real-time charts (temperature, gravity, flow, pressure)
- Historical data with export (CSV / JSON)
- Notifications (at minimum web push + optional Telegram / Discord)
- Full configuration backup & restore
- Clean logging and diagnostics

---

## 6. MQTT Topic Structure (Proposal)

Use a clear hierarchical structure:

```
unibrew/{device_id}/status          # online, firmware version, uptime
unibrew/{device_id}/telemetry       # temperatures, flow rates, gravity, etc. (JSON)
unibrew/{device_id}/state           # current control state, setpoints, mode
unibrew/{device_id}/command         # setpoints, mode changes, calibration
unibrew/{device_id}/config          # full configuration push
unibrew/{device_id}/ota             # OTA related
unibrew/discovery                    # device announcements
```

All payloads should be well-structured JSON. Use retained messages where appropriate for last-known state.

---

## 7. ESP32 Firmware Requirements

The firmware must be production quality:
- Extremely robust MQTT reconnection logic
- Watchdog timers
- Local control loops that continue working offline
- Clean separation between hardware abstraction, control logic and communication
- Configuration can be updated over MQTT or via serial
- Detailed but controllable logging
- Safe defaults on first boot
- Support for both heating and cooling outputs with proper interlocks

Implement a solid local PID controller that can run independently. The backend can push more advanced profile logic when online.

---

## 8. Testing & Verification of Control Logic (Highest Priority)

Because the closing requirement of this project is that **bad temperature control ruins beer**, the PID and thermostat logic must be rigorously verified.

### Required
- Unit tests for the control algorithms with **simulated sensor input**
- Explicit test cases for:
  - Hysteresis / deadband behaviour
  - Minimum on-time and minimum off-time
  - Transition between heating and cooling
  - Behaviour when sensors report NaN / out-of-range values
  - Recovery after temporary sensor failure
  - Offline fallback behaviour (last known setpoint continues to be respected)
- Ability to run the control loop in pure software (no hardware required) for regression testing
- Clear separation so that the same control logic can be unit-tested on the host and later compiled for the ESP32

### Strongly Recommended
- Property-based or fuzz testing around edge temperatures
- Logging of every control decision (why did it turn the compressor on/off?) for later analysis
- A simple simulation mode in the backend or firmware that can replay temperature traces

Do not consider the temperature control feature complete until these tests exist and pass.

---

## 9. UI / UX Requirements

- Visual quality must match or exceed `patchsheet.se` and `reklamovertid.se`
- Clean typography, excellent spacing, refined cards and controls
- Dark mode by default (with light mode option)
- Fast, responsive, no unnecessary loading states
- Clear visual feedback for device online/offline and control actions
- Device management should feel polished and safe (especially flashing)
- Charts should be high quality (consider uPlot, Lightweight Charts, or similar)

---

## 10. Implementation Strategy & Priorities

### Phase 1 – Foundation (MVP)
1. Scaffold the monorepo per §0.2
2. Database models for devices, readings, profiles, users
3. MQTT integration + device status tracking
4. Basic device management UI (list, add, remove, basic config)
5. Minimal ESP32 firmware that reports temperature and accepts a setpoint
6. Local fallback PID/thermostat on the ESP32 **with unit tests**
7. Simple dashboard with live temperature for 1 kegerator + 1 fermentation chamber

### Phase 2 – Core Control
1. Full fermentation control (PID + modes + basic profiles) with comprehensive tests
2. Kegerator flow meter support + volume tracking
3. Beautiful real-time charts
4. OTA + WebSerial flashing from the UI

### Phase 3 – Polish & Advanced Features
1. Gravity / hydrometer support
2. Advanced profiles (gravity-based)
3. Notifications
4. Backup/restore
5. Support for additional devices beyond the initial two

---

## 11. Coding Standards & Expectations

- Prefer simple, readable, well-structured code over clever abstractions
- Strong typing everywhere
- Explicit error handling
- Good logging (structured where possible)
- Clear separation of concerns
- Comprehensive but not excessive comments on non-obvious decisions
- Write code that another senior engineer would enjoy maintaining
- Favor composition over inheritance
- Make the happy path elegant and the error paths robust
- Document architectural decisions in short ADRs or comments when non-obvious

**Firmware specific:**
- Avoid dynamic memory allocation in hot paths
- Be careful with stack usage
- Use RAII-style patterns where the language allows
- Make the control loop deterministic and easy to reason about
- The control algorithm must be unit-testable in isolation

---

## 12. Deliverables

You should produce:
1. Clean, well-organized codebase
2. Clear README with architecture overview and local development instructions
3. Docker Compose setup that runs the full stack
4. Basic documentation for adding a new device and flashing firmware
5. Working MVP that can reliably control **one fermentation chamber and one kegerator**
6. Unit tests covering the temperature control logic

---

## Final Instruction

Build this as if it will be used daily for years. Prioritize reliability of temperature control above all else — **bad temperature control ruins beer**. Everything else is secondary to correct and stable control loops.

When in doubt, choose the simpler, more robust solution.

The architecture decisions in §0 are resolved — start directly with Phase 1 scaffolding using the folder layout in §0.2.
