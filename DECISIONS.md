# BrewHub Architecture Decisions

Short ADRs for the choices made in `claude.md` §0. Each follows: Decision, Context, Alternatives considered, Consequences.

---

## ADR-001: Backend language — TypeScript (Node.js 22+)

**Decision**: Backend is TypeScript on Node.js 22+, using Fastify.

**Context**: The candidates were TypeScript and Go. The deciding factor is that the ESP32 already owns the safety-critical control loop (ADR-004) — the backend's job is orchestration, persistence, and UI, not hard real-time control. A backend crash or restart doesn't stop temperature control; the ESP32 keeps running on its last config. That removes the strongest argument for Go (predictable low-latency concurrency for a hot path) and elevates the strongest argument for TypeScript: sharing one type system with the mandated React/TypeScript frontend, via a `packages/shared-types` workspace that is the single source of truth for every MQTT and API payload shape.

**Alternatives considered**:
- **Go**: single static binary, lower memory footprint, goroutines are a natural fit for N concurrent device connections. Rejected because the concurrency/runtime advantages matter most for a hot control path, and that path doesn't live in the backend. Also loses the shared-types benefit with the frontend.

**Consequences**:
- Every MQTT message and API/WS payload MUST be validated with a Zod schema from `shared-types` before use — this is the actual correctness backstop, not the language choice. Treat "add a new payload shape without a matching Zod schema" as a code review blocker.
- Standard Node operational hygiene applies (avoid blocking the event loop with sync work outside `better-sqlite3`'s inherently-sync calls, watch WS backpressure under many connected clients).

---

## ADR-002: Monorepo, pnpm workspaces

**Decision**: Single monorepo, pnpm workspaces, layout as in `claude.md` §0.2.

**Context**: Backend and frontend are both TypeScript (ADR-001), so a shared-types package only pays off if both live in one workspace with normal cross-package imports — publishing a separate npm package for a single-project, single-maintainer setup is pure overhead.

**Alternatives considered**:
- **Separate repos per component**: rejected — adds versioning/publishing overhead with no isolation benefit for a solo-maintained project, and makes it harder to land a coordinated change (e.g., new MQTT field touching firmware, backend, and frontend at once) as one reviewable unit.
- **npm/yarn workspaces**: pnpm chosen for disk efficiency and stricter dependency resolution (fewer phantom-dependency bugs) at negligible extra setup cost.

**Consequences**: `firmware/` is PlatformIO-managed and outside the pnpm workspace, but lives in the same repo so the MQTT contract (documented in `shared-types`) and the firmware code that must manually mirror it stay in the same commit history.

---

## ADR-003: Database — SQLite (`better-sqlite3`, WAL mode)

**Decision**: SQLite via `better-sqlite3`, WAL mode enabled, with a scheduled retention-rollup job.

**Context**: Single-writer workload (one backend process), one household's worth of devices, telemetry at a several-second cadence. Even at 1 reading/5s across all sensors on both devices for years, row counts stay in the low millions — well within SQLite's comfort zone with basic indexing.

**Alternatives considered**:
- **PostgreSQL**: rejected for v1. It would add a second container to run, monitor, and back up, plus schema-migration coordination between two services, with no corresponding benefit — no concurrent-writer contention, no need for replication/HA at this scale.

**Consequences**:
- Add a scheduled job (e.g. nightly) that downsamples telemetry older than 30 days to hourly averages, so DB size stays bounded indefinitely instead of growing unbounded for years.
- Backup/restore (§5.4) is implemented as copying the `.db` file (or using SQLite's online backup API) — no separate backup tooling needed.
- If a second device set or household is ever added and write concurrency becomes real, this decision should be revisited — not before.

---

## ADR-004: Control loop authority — ESP32 only, always

**Decision**: The ESP32 is the sole authority over actuator state. The backend only ever publishes declarative configuration (setpoint, mode, PID gains, profile) as retained MQTT messages. It never sends a direct "turn relay on/off" command.

**Context**: This is the decision most directly responsible for satisfying the project's own top priority: "bad temperature control ruins beer." A command-based design (backend tells device "turn on now") has a failure mode where a dropped or reordered MQTT message leaves a relay stuck in the wrong state indefinitely. A config-based design (backend tells device "here is the setpoint/mode to run"; device's own loop decides relay state every tick) is self-correcting — the device's own control loop re-evaluates from current config on every cycle regardless of whether the last MQTT message even arrived.

**Alternatives considered**:
- **Backend-mediated control loop** (device reports readings, backend computes and sends actuator commands): rejected outright — reintroduces exactly the offline/dropped-message failure mode the project's own "local fallback" principle (§3) exists to prevent.
- **Hybrid** (backend can send direct override commands in addition to config): rejected in favor of modeling overrides as **TTL'd config** — e.g. "force cooling for the next 30 minutes" is a config value with an expiry, not an imperative command, so it still degrades safely (reverts to normal control) if the connection drops mid-override.

**Consequences**: Manual override UI in the frontend must be built around "set a temporary config with expiry," not "send a command." Any future feature request for direct device commands should be routed through this same declarative-config mechanism instead of adding a parallel command channel.

---

## ADR-005: Hardware abstraction — shared firmware core, per-board PlatformIO environments

**Decision**: One firmware codebase. Hardware-specific differences are isolated to a compile-time pin map per PlatformIO environment (`kegerator-kegcop`, `fermenter-brewpi`); all control/communication logic is shared.

**Context**: The two known boards (Keg Cop PCB, BrewPi ESP D32 PCB) differ only in pin assignment and which optional peripherals are populated (flow meters vs. none, TFT/LCD vs. none) — the actual sensor reading, actuator control, MQTT, and config logic is identical in shape.

**Alternatives considered**:
- **Separate firmware trees per device type**: rejected — guarantees drift between the two over time (a bug fix in one control loop doesn't automatically apply to the other), directly against the coding standard already in the spec ("favor composition over inheritance").

**Consequences**: Shared core exposes `SensorManager`, `ActuatorManager` (with interlocks + min on/off enforcement built in, not per-board), `MQTTClient`, `ConfigStore`, and a generic `ControlLoop`. Adding a third hardware family later is "new environment + new pin map," not new logic.

---

## ADR-006: Control logic testing — native, hardware-free

**Decision**: PID, hysteresis/deadband, min on/off timing, and profile interpolation are implemented as pure functions/classes with zero Arduino/ESP-IDF dependency, tested via `pio test -e native` (Unity) on every commit. Backend profile-resolution logic gets `vitest` unit tests.

**Context**: Directly required by §8. The only way to guarantee this is achievable is to design the control logic's dependencies (time, sensor readings) as injected inputs from the start, rather than reaching into global/hardware state — otherwise "extract it for testing later" becomes a rewrite.

**Consequences**: Required test cases (hysteresis/deadband, min on/off, heat/cool transition, NaN/out-of-range sensor input, sensor-failure recovery, offline profile continuation) are non-negotiable acceptance criteria for the temperature-control feature, not a nice-to-have — see §8.

---

## ADR-007: HTTPS required, even for LAN-only deployment

**Decision**: Run Caddy as a reverse proxy from day one, terminating HTTPS with a self-signed or `mkcert`-issued local certificate.

**Context**: The Web Serial API (used for initial firmware flashing from the browser, §5.1) only works in a secure context — HTTPS or `localhost`. A bare HTTP deployment on the LAN (the natural default for a self-hosted Unraid app) would silently break this feature, likely discovered only when someone tries to flash a device in Phase 2.

**Alternatives considered**:
- **Defer HTTPS until the flashing feature is built**: rejected — retrofitting a reverse proxy after the fact touches auth, CORS, and WebSocket upgrade handling; cheaper to have it from the start than to debug "why doesn't WebSerial show up" mid-Phase-2.

**Consequences**: `docker-compose.yml` includes Caddy from Phase 1, even though flashing isn't built until Phase 2 — the cert/proxy plumbing should already be a non-issue by the time it's needed.

**Update (deployment host port conflict)**: The target Unraid host already runs NginxProxyManager and other services occupying the standard 80/443 range. Caddy binds to **8443 (HTTPS only)** instead, confirmed free against the host's current port allocation. NPM can optionally front a clean subdomain to BrewHub's Caddy later; not required for local/LAN use.

**Update (on-demand TLS, discovered during Docker verification)**: `tls internal` on a hostname-less site address (`:8443`, since the deployment IP isn't known ahead of time) cannot eagerly provision a certificate at config load — Caddy needs *some* hostname to put in the cert. Fixed with `tls internal { on_demand }`, which issues a cert lazily per incoming SNI. Caddy logs a warning that unrestricted on-demand TLS is an abuse vector if internet-facing; accepted here because it's consistent with ADR-008's threat model (LAN-only, never exposed to the internet per the project's own non-goals) — revisit if that ever changes.

---

## ADR-008: MQTT transport — plaintext on trusted LAN, auth required

**Decision**: Mosquitto runs without TLS, but requires username/password authentication for all clients (backend and ESP32s).

**Context**: TLS adds handshake cost and RAM pressure on a memory-constrained ESP32, for a broker that never leaves the trusted home LAN (the project's own non-goals explicitly rule out cloud dependency/exposure). The realistic threat model here is "another device on my LAN publishing bogus commands," not network eavesdropping by an external attacker — auth addresses that; TLS would not meaningfully improve it at this trust boundary.

**Alternatives considered**:
- **TLS everywhere**: rejected for v1 as unnecessary cost for the actual threat model. Revisit immediately if the broker is ever exposed outside the LAN (e.g. remote access) — that would change the threat model and make this decision void.

**Consequences**: Mosquitto config must ship with a password file / ACLs from the start, not as an afterthought — "no TLS" must not become "no auth either."

---

## ADR-009: OTA/flash endpoint auth

**Decision**: OTA-trigger and firmware-upload endpoints are gated by the same JWT/local-user auth as the rest of the API — no separate mechanism.

**Context**: These endpoints let an authenticated user push arbitrary code to a physical device; they're exactly as sensitive as any other authenticated mutation, no more, no less. Introducing a second auth scheme just for this would add complexity without added safety.

**Consequences**: Add an explicit test/checklist item during Phase 2 implementation confirming these specific routes require auth — it's an easy thing to leave open by accident while iterating on the flashing UI.
