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

**Update (port allocation re-checked)**: NginxProxyManager on this host has since moved to 1880/7818/18443 rather than 80/443/81 — the specific "NPM occupies 80/443" claim above is now stale (whether because NPM was reconfigured, or 80/443 were never actually NPM's in Docker terms and are reserved by Unraid's own webUI outside Docker — either way, moot). Re-verified against the host's full current Docker port allocation: 8443 remains free, no change needed to the decision itself.

**Update (on-demand TLS, discovered during Docker verification)**: `tls internal` on a hostname-less site address (`:8443`, since the deployment IP isn't known ahead of time) cannot eagerly provision a certificate at config load — Caddy needs *some* hostname to put in the cert. Fixed with `tls internal { on_demand }`, which issues a cert lazily per incoming SNI. Caddy logs a warning that unrestricted on-demand TLS is an abuse vector if internet-facing; accepted here because it's consistent with ADR-008's threat model (LAN-only, never exposed to the internet per the project's own non-goals) — revisit if that ever changes.

**Update (deploy-readiness pass)**: Tried adding `on_demand_tls { interval 2m; burst 5 }` as a global Caddy option to directly answer the "vulnerable to abuse" warning above. Caught by the smoke test, not in review: this Caddy version (2.11.4, from the `caddy:2` tag) has removed the built-in `interval`/`burst` rate limiter — Caddy refused to start ("the on_demand_tls 'interval' option is no longer supported"), crash-looping the container. Current Caddy only supports gating on-demand issuance via an `ask` URL (an HTTP endpoint Caddy calls to approve/deny each hostname before minting a cert). Implementing that properly here would mean hand-rolling a rate limiter *inside* the ask endpoint ourselves — real added complexity for a risk this project already accepted in the note above, given the LAN-only/never-internet-facing threat model. Reverted to the plain `tls internal { on_demand }` config rather than build that. Also added Docker Compose `healthcheck`/`depends_on: condition: service_healthy` for all three services, so `caddy` doesn't start proxying to a `backend` that hasn't finished running migrations yet, and `backend` doesn't attempt its first MQTT connection before `mosquitto` is actually accepting connections — verified via a full `docker compose up --build` smoke test (containers healthy, HTTPS/WSS through Caddy, authenticated MQTT round-trip, data survives a `backend` restart). Deliberately did **not** add a non-root `USER` to `backend.Dockerfile`: doing it safely (chown-then-drop-privileges on the mounted volume, to not break upgrades from an existing root-owned volume) needs a hand-rolled entrypoint script, and the fragility risk of getting that exec/signal-forwarding right outweighs the marginal benefit for a single-tenant, LAN-only container with no untrusted code execution surface — revisit if the threat model ever changes.

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

**Update (implementation)**: Holds exactly as decided for every user-facing route (`POST /api/firmware`, `GET /api/firmware`, `DELETE /api/firmware/:id`, `POST /api/devices/:id/ota`) — all gated by `fastify.verifyAuth`, same as everything else. The one endpoint this doesn't (and can't) cover is `GET /api/firmware/:id/download` — a device fetching its own OTA binary has no browser session and can't send a JWT. That route accepts *either* a valid JWT (covers WebSerial/browser downloads) *or* a short-lived, single-use `?token=` minted specifically by the OTA-trigger call (covers device downloads) — see ADR-010. This is a second mechanism, but for a fundamentally different caller (a device, not a user), not a weakening of the original decision for anything a *user* does.

---

## ADR-010: OTA firmware — not retained, per-device binaries

**Decision**: Two things, both narrower in scope than they might first look:

1. The MQTT message that triggers an OTA update (`unibrew/{deviceId}/ota`) is published with `retain: false` — the one deliberate exception to ADR-004's "everything published to a device is retained, declarative config" rule.
2. Each uploaded firmware binary is tied to one specific device's id (baked-in `DEVICE_ID`/WiFi/MQTT credentials in `secrets.h` at compile time, unchanged from how flashing has always worked) — not a generic per-board-type image flashable to any device.

**Context**: (1) A firmware push is inherently a one-shot imperative action — "update to this version now" — not state a device should keep re-applying on every reconnect. Retaining it would mean every device that ever reconnects to the broker (e.g. after any Wi-Fi hiccup) re-triggers the same OTA download forever, since the retained message never expires on its own. ADR-004's retained-config pattern exists specifically for state a device should self-heal to after any disconnect; that's the opposite of what OTA needs. The distinction is enforced entirely on the backend side (`apps/backend/src/mqtt/publish-ota.ts`, kept as its own function deliberately separate from `publish-config.ts`) — firmware itself doesn't need to know or care that this topic behaves differently.

(2) Considered moving WiFi/MQTT/device-id to NVS-backed runtime config (flash one generic binary per board type from the browser, provision each device's identity afterward over serial or a captive portal) so a non-technical user could flash any device with zero local build step. Explicitly deferred — real architecture change across all three firmware codebases (`ConfigStore`, `hal-mqtt`, a new provisioning protocol + UI) for a benefit that doesn't matter much at the current single-user, single-installation scale. The existing compile-time-secrets pairing flow (README "Adding a device") already works and is unaffected by this feature.

**Consequences**: A firmware build uploaded for one device cannot be OTA'd to a different device — `POST /api/devices/:id/ota` 400s if the build's `deviceId` doesn't match. WebSerial flashing (browser, via `esptool-js`) writes only the app partition (offset `0x10000`, the Arduino-ESP32 default OTA partition scheme's `app0`) — it assumes the board already has a compatible bootloader + partition table from a prior flash (e.g. `pio run -t upload`), not a factory-blank chip. Revisit the generic-image option (2) if/when onboarding many devices per install becomes the common case rather than the exception.

---

## ADR-011: Notifications — narrow trigger scope, VAPID auto-generated, channels fan out independently

**Decision**: Three things:

1. Only two triggers fire a notification in v1: a device going offline (presence sweep), and a tap's remaining volume crossing below `LOW_VOLUME_THRESHOLD_PERCENT` (15%, shared-types — matches the UI's own red-threshold styling, `taps.low_volume_notified` guarantees exactly one notification per fill cycle). Explicitly **not** included: a device coming back online, sensor-fault/forced-idle control-loop events, OTA success/failure. All would be easy to bolt on to the same `sendNotification()` call, deliberately left out for now rather than because they're hard.
2. The VAPID key pair (needed for web push) is generated on first boot and persisted in `notification_settings`, not supplied via env var like `JWT_SECRET`.
3. `sendNotification()` fans out to web push + Telegram + Discord in parallel, with each channel's failure caught and logged independently — one bad Telegram token or an expired push subscription never blocks the other channels, and never blocks the MQTT message-processing path that triggered it (every call site fires it with `void`, never awaited).

**Context**: (1) "Back online" was cut specifically to avoid alert fatigue — a device blipping offline for a few seconds (WiFi hiccup) and reconnecting would otherwise generate two notifications for a non-event; "offline" alone is the actionable half (something may need attention), matching the general principle of notifying on state that needs a decision, not every transition. Sensor-fault/OTA-result notifications are reasonable future additions once there's a concrete need, not deferred for a technical reason.

(2) VAPID keys identify the push *sender* to the browser's push service — unlike `JWT_SECRET`, they don't sign anything a user's auth depends on, so there's no security reason to make key management a manual setup step. Auto-generating removes friction for the common case; the private key never leaves `notification_settings` (never returned by `GET /api/notifications/settings`, see shared-types doc comment).

(3) A dedicated `fetch()` call per channel (Telegram Bot API `sendMessage`, a plain Discord webhook POST) rather than an SDK for either — both are a single JSON POST, pulling in a dependency for one HTTP call each would be pure overhead. web-push (the one channel with real cryptographic complexity — payload encryption, VAPID JWT signing) uses the `web-push` npm package rather than hand-rolling that.

**Consequences**: Expired/unsubscribed push subscriptions are pruned automatically (404/410 response from the push service deletes the row in `push_subscriptions` — see `notifications/send.ts`) rather than accumulating forever. Adding a new trigger later is just another call site for the same `sendNotification()` function; adding a new channel is a new function inside `send.ts` fanned into the same `Promise.all`.

---

## ADR-012: BrewHub device discovery is per-device + retained; Home Assistant integration is MQTT Discovery, always on, no new device-facing state

**Decision**: Three things:

1. Device self-announcement uses `unibrew/{deviceId}/discovery`, retained — not claude.md §6's original single shared `unibrew/discovery` topic sketch. A single shared topic's retained value gets overwritten by whichever device announced most recently, so a backend that's down when a device announces would permanently miss it; per-device + retained means a backend started later still discovers every device that's ever connected by subscribing to the wildcard `unibrew/+/discovery`.
2. The backend publishes Home Assistant's [MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery) config topics (`homeassistant/<component>/<node_id>/<object_id>/config`) for every registered device's online status, discovered temperature sensors, and taps — unconditionally, no settings toggle. Every message is retained and inert to anything that isn't HA (or something else speaking the same convention), so there's no real cost to non-HA users.
3. Tap remaining volume is additionally published by the backend to `unibrew/{deviceId}/taps/{tapId}/state` (`{remainingVolumeMl, remainingPercent}`), retained — a genuinely new thing, since remaining volume is backend-computed (from cumulative pulses or load-cell weight) and was previously only available via the REST API / WebSocket, never plain MQTT. This does **not** touch ADR-004 ("backend never sends direct actuator commands, only declarative config **to devices**") — that ADR governs the backend→device direction specifically; this is the backend acting as a *data source* for other systems (HA, or anyone else on the LAN broker), an orthogonal concern.

**Context**: HA discovery configs are re-published in full on every backend startup (`republishHomeAssistantDiscovery` in `index.ts`), not just on the state-changing event that first created them — covers brokers without persistent retained-message storage (the bundled Mosquitto has `persistence true`, but a self-hosted external broker might not). Idempotent and cheap: HA treats an unchanged republished config as a no-op.

Removing an entity from HA (device deleted, tap deleted) publishes an empty retained payload to the same config topic — HA's own convention, and also just how MQTT retained messages work (an empty retained payload deletes the retained message rather than storing an empty one, verified live: a fresh subscriber after deletion gets nothing at all, not an empty string).

**Consequences**: A new HA-relevant entity type (e.g. flow-meter raw pulse count, keg-scale raw weight) is a new pair of publish/remove functions in `mqtt/publish-ha-discovery.ts`, called from wherever that data's lifecycle events already live — no new architecture needed. Every discovery/state publish call site needs to stay paired with a corresponding removal call site (device delete, tap delete) or HA accumulates stale entities; there's no separate garbage-collection pass for this, so getting a new entity type's delete-path wrong would be a silent leak, not a hard failure — worth double-checking when this is next extended.

## ADR-013: In-app restore swaps the file on disk but requires a manual restart, rather than the backend restarting itself

**Decision**: `POST /api/backup/restore` validates the upload (SQLite magic-header check), takes a safety backup of the *current* database first (via the same online-backup API the download endpoint uses), then atomically renames the uploaded file into place at `DB_PATH` and deletes any stale `-wal`/`-shm` sidecars left over from the file that used to be there. It deliberately does **not** call `process.exit()` afterward to trigger a restart.

**Context**: `better-sqlite3` holds the database file open by file descriptor, not by path — on POSIX, renaming a new file over that path doesn't affect the already-open fd, so the running process keeps serving the *old* data, completely unaffected, until it's actually restarted and reopens `DB_PATH` fresh. Two options were considered for closing that gap: have the route call `process.exit(0)` and rely on Docker's `restart: unless-stopped` policy to bring it back up automatically, or leave the restart to the operator. Auto-exit was rejected because it's Docker-specific behavior baked into a route that also needs to work for a plain `pnpm dev`/systemd deployment, where a self-triggered exit either does nothing helpful (no supervisor watching) or is a surprising side effect of clicking a button in a settings page. The response instead returns `{ restartRequired: true, safetyBackup: <path> }`, and the UI surfaces the exact restart command.

**Consequences**: A restore is a two-step operator action (click restore, then restart), not fully self-contained — acceptable since restore is a rare, deliberate, already-destructive operation where an extra explicit step is a feature, not friction. The pre-restore safety backup means a botched or accidental restore is always recoverable from the server's own filesystem, without needing the operator to have kept their own copy.

## ADR-014: Gravity/hydrometer ingestion is a documented MQTT contract; BLE scanning lives on a new dedicated `gravity-bridge` board, never on the fermenter

**Decision**: Tilt and Rapt Pill hydrometers broadcast readings over Bluetooth LE (passive advertisements, no pairing). Something needs a BLE radio scanning for these. Three options were weighed, with a second opinion from an independent advisor before committing: (A) add BLE scanning into the existing fermenter board's firmware, (B) require an external bridge (e.g. Home Assistant/ESPHome's `tilt_ble`/`rapt_ble` republishing to MQTT) as the only path, or (C) a new, dedicated, lightweight `gravity-bridge` firmware target — a third board type alongside fermenter/kegerator, structured like the existing `keg-scale` board (no control loop, just a sensor + MQTT). **(C) was chosen**, with the ingestion boundary designed as a documented MQTT contract rather than something bespoke to BrewHub's own firmware, so (B) works too without being required.

**Context — why not (A)**: ADR-004 protects the control loop from *network* failure, not from *its own MCU*. A BLE stack fault doesn't corrupt relay logic, but it can reboot the chip — cycling actuators and resetting min-on/off timers on the one device the project says must never go down, for a purely observational feature. There's also a concrete blocker: the fermenter's OTA partition scheme is pinned to `default.csv` (~1.3MB app slots, see ADR-010), and WiFi+Arduino+a BLE stack together routinely exceed that, which would force a partition change on the safety-critical board. (ESPHome doing WiFi+BLE coexistence elsewhere proves it's *possible* generally, not that it belongs in this codebase's most protected binary.)

**Context — why not (B) alone**: requires the user to already run Home Assistant, which isn't self-contained for users without it. Instead, `packages/shared-types/src/gravity.ts`'s `GravityTelemetryPayloadSchema`, published (not retained) to `unibrew/{deviceId}/gravity`, is the actual contract — `gravity-bridge` is simply BrewHub's own first-party publisher to it. An HA/ESPHome bridge (or anything else) publishing the same shape to the same topic pattern is ingested identically, no special-casing.

**iSpindel** doesn't involve BLE at all — it's a WiFi device that POSTs its own native JSON directly (configured in its own web UI), normalized into the same internal pipeline via `POST /api/gravity/ispindel` (unauthenticated, same LAN-trust reasoning as MQTT/OTA tokens per ADR-008/009, scoped tight to only accept readings for an already-configured hydrometer identifier). The backend does not convert units — the iSpindel must be configured to report Celsius, keeping this a thin passthrough rather than a second unit-conversion path to maintain.

**Calibration** (`correctedSG = rawSG * calibrationSlope + calibrationOffset`, per `hydrometers.calibration_slope`/`calibration_offset`) is applied exactly once, at ingest (`apps/backend/src/gravity/apply-calibration.ts`) — every downstream reader (the gravity-profile scheduler, history/charts) always sees the already-corrected value, never raw.

**Profile schema is now a discriminated union** (`packages/shared-types/src/profile.ts`, on `triggerType: "time" | "gravity"`) rather than a single shape — a profile is either purely time-driven or purely gravity-driven, never mixed, keeping resolution a simple branch (`resolve-setpoint.ts` vs. `resolve-setpoint-by-gravity.ts`, near-identical clamp+interpolate algorithms, just keyed on elapsed minutes vs. measured gravity) rather than needing to interleave two independent variables. This is a breaking schema change; migration `0011_gravity.sql`'s `ALTER TABLE profiles ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'time'` backfills every existing row correctly with no data migration needed for `steps_json` itself, since existing steps already match the time-step shape. Unlike time-based profiles (anchored by `profile_started_at`, captured at activation), gravity-based profiles need no baseline/anchor column — resolution is driven by whatever the *latest* gravity reading is at each scheduler tick, not an elapsed delta from a starting value; activating a gravity profile on a device with no assigned hydrometer is rejected (400) rather than silently activating something that can never resolve.

**Rapt Pill support** (`firmware/gravity-bridge/src/RaptParser.cpp`): no physical Rapt Pill was available during implementation, so this has never been tested against a real device's actual advertisement bytes — that ceiling doesn't change. What changed since first writing this: the byte layout is now sourced from [sairon/rapt-ble](https://github.com/sairon/rapt-ble/blob/main/src/rapt_ble/parser.py), the actual parser behind Home Assistant's official `rapt_ble` integration (a real, actively-maintained, widely-used reference — not a datasheet, but a credible one, cross-checked against a second independent community decoder that cites the same source). Only the "V1" payload shape (25 bytes: 4-byte "RAPT" ASCII prefix instead of a real Bluetooth SIG company ID, version, 6-byte MAC used as the identifier, then big-endian temperature/gravity/accelerometer/battery) is implemented — `tryParse()` returns `false` for any other version rather than guess, since the one community project attempting "V2" (gravity-velocity) support has a slice-offset bug in its own math that doesn't line up with its own struct definition, which is exactly the kind of subtle mistake that argues for not also guessing at a second format. The byte-level math (big-endian u16/i16/f32 reconstruction, all the field offsets) was verified with a standalone native test against a hand-constructed known-correct payload — genuinely tested, just not against real hardware. Tilt support has no such caveat at all (its 8 fixed per-colour iBeacon UUIDs are long-standing public documentation, and the standard iBeacon layout is unambiguous) and was verified via a real `pio run -e gravity-bridge` compile plus live MQTT/scheduler round-trip testing.

Also fixed while working on this: `GravityReading::identifier` was a `const char*` pointing at a function-local `static` buffer — safe for Tilt (whose identifiers are compile-time string literals, one per colour) but not for Rapt Pill's MAC-derived identifier, where a second hydrometer parsed later in the same scan pass would silently overwrite the first one's identifier through the shared buffer, corrupting an already-collected `GravityReading` still sitting in that scan's results array. Only reachable once Rapt Pill actually started returning `true`, so it was latent/inert until now. Fixed by making `identifier` a fixed-size array embedded directly in the struct — each reading owns its own bytes, no shared mutable state to alias.

## ADR-015: Telemetry ordering/history uses `recorded_at` (server clock), never the device's own `ts`; hourly rollup retires data past 30 days

**Decision**: none of BrewHub's firmware ever calls an NTP sync (`configTime()`) — `ts` in every telemetry payload is `millis()`, i.e. milliseconds since that specific device last booted, not wall-clock time. It was nonetheless being used directly for `ORDER BY ts DESC` (latest-reading lookups), `devices.last_seen_at`, and history-chart timestamps. This is a real correctness bug, not cosmetic: after any device reboot, `millis()` resets near zero, so pre-reboot rows (high uptime values) sort as *newer* than genuinely-newer post-reboot rows. Concretely, `getLatestGravityReading` — which the gravity-profile scheduler (ADR-014) calls every tick to resolve a fermenter's setpoint — could return stale, pre-reboot data after a device reboot, silently driving temperature control off old data. History charts would additionally cluster near the Unix epoch instead of showing real dates.

**Fix**: every one of these tables already had `recorded_at INTEGER NOT NULL DEFAULT (unixepoch())` — a server-side wall-clock timestamp set automatically on insert — just unused for anything. `getLatestReadingForSensor`/`getRecentReadingsForSensor`/`getRecentFlowReadings`/`getRecentWeightReadings`/`getRecentGravityReadings`/`getLatestGravityReading` now `ORDER BY recorded_at DESC, id DESC` (the `id` tiebreak matters: `recorded_at` only has second granularity, and several channels from one telemetry message land in the same second). History routes return `recorded_at * 1000` as `ts` in API responses, not the raw device value. `index.ts`'s `setDeviceOnline`/`recordSensorSeen` calls now pass `Date.now()` instead of `payload.ts`. Migration `0012_recorded_at_indexes.sql` drops the now-pointless `ts`-based indexes and adds `recorded_at`-based ones matching the new query pattern.

**What deliberately wasn't touched**: `applyFlowReading`'s use of the device's own `ts` for pour-idle-timeout detection and flow-rate delta math (`process-flow-reading.ts`) — that's correct as-is, since it's a *duration* comparison between two `millis()` readings from the *same* boot session, where absolute wall-clock meaning doesn't matter, only the delta does. Pour event (`pour_events.started_at`/`ended_at`) absolute timestamps have the same underlying issue (they'd display near-epoch dates for pour history) but were left as a known, smaller-severity follow-up — fixing it cleanly requires threading a second, server-side timestamp through `applyFlowReading` alongside the existing device-ts delta math, and pour history display accuracy is lower-stakes than stale data silently feeding temperature control.

**Retention**: `apps/backend/src/telemetry/rollup.ts` collapses every hour-bucket of rows older than `TELEMETRY_RETENTION_DAYS` (default 30, matching claude.md §0.3's original spec) into one representative row per bucket, run daily (`TELEMETRY_ROLLUP_INTERVAL_MS`, default 24h) via `startTelemetryRollup` in `index.ts`, same pattern as the existing presence-sweep/profile-scheduler jobs. One rollup function per table (not a generalized one) matching the schema's own established "no generalized value column" precedent (migration 0007's comment): `readings`/`weight_readings`/`gravity_readings` use `AVG()` per value column (instantaneous readings — SQL `AVG` already ignores `NULL`/sensor-fault rows correctly); `flow_readings` uses `MAX(pulse_count)` instead, since it's a cumulative monotonic counter (see `telemetry.ts`) — averaging it would produce a value nothing ever actually reported and would violate the non-decreasing assumption the flow-delta logic depends on. Buckets that already collapsed to a single row are skipped (`HAVING COUNT(*) > 1`), making repeat daily runs cheap rather than re-scanning the entire historical tail every time. Verified live: seeded genuinely old rows into a running instance, restarted, confirmed the rollup ran automatically on startup and collapsed them correctly, confirmed recent data was untouched.

## ADR-016: JWTs expire; login is rate-limited

**Decision**: `fastify.jwt.sign()` now includes `expiresIn: config.JWT_EXPIRES_IN` (default `30d`, configurable). `POST /api/auth/login` gets `@fastify/rate-limit` (max 5 requests/minute), registered inside `auth.routes.ts`'s own plugin function rather than at the app level — Fastify's encapsulation means this only rate-limits routes registered within that same scope (today, just login), not the whole API.

**Context**: neither existed before. A token that never expires is valid forever if it ever leaks, with no way to invalidate it short of rotating `JWT_SECRET` (which invalidates every session, not just the compromised one). Login had no defense against unlimited password-guessing attempts — low realistic severity given the LAN-only threat model this project already accepts (ADR-008), but "no defense at all" was a needless gap for a few added lines. 30 days was chosen over something shorter because there's no refresh-token flow — a shorter expiry just means re-logging-in more often for a home app with no real session-hijacking exposure beyond "someone else already has LAN access," which is the same threat model MQTT already accepts.

**Verification**: `apps/backend/src/routes/auth.routes.test.ts` — the first test in this codebase using Fastify's `.inject()` rather than only repo-level unit tests, since rate-limiting and JWT expiry only exist at the HTTP layer, not something a direct DB-function call can exercise. Confirms the issued token's `exp - iat` matches the configured duration, confirms the 6th rapid login attempt within a minute gets `429` regardless of whether the password was right, and confirms an unrelated route (`/api/health`) is unaffected — proving the rate limiter's scope is actually just the login route, not accidentally global. Also verified live against a real running server.

## ADR-017: Backend image is published to GHCR and pulled by default; Unraid gets a WebUI label now, a real CA template later

**Decision**: `.github/workflows/publish-backend-image.yml` builds `docker/backend.Dockerfile` and pushes it to `ghcr.io/ippodrome/brewhub-backend` on every push to `main` (tagged `latest` and `sha-<short>`) and on `vX.Y.Z` tags (tagged with the matching semver components). `docker-compose.yml`'s `backend` service now references that image by default (`image: ghcr.io/ippodrome/brewhub-backend:${BREWHUB_IMAGE_TAG:-latest}`) instead of `build: context: ..` — nothing to compile on whatever host runs the stack. `docker-compose.dev.yml` is a new, optional overlay that adds `build:` back for testing local changes (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`); Compose allows `image:` and `build:` on the same service simultaneously by design — `--build` builds and tags the result with the base file's `image:` name, purely locally, nothing pushed.

The `caddy` service also gets a `net.unraid.docker.webui` label — Unraid's Docker tab reads this off any running container regardless of how it was started (compose, `docker run`, or an XML template), so the app gets a proper WebUI button under Unraid's native Docker Compose support (6.12+) or the community "Docker Compose Manager" plugin, without needing an Unraid-specific template at all.

**Context**: the user wants to eventually publish BrewHub as an installable Unraid Community Applications (CA) app. That's a bigger step than it first looks: CA apps pull a prebuilt image (never build from source on the installer's box), need an XML template (ports/volumes/env vars with descriptions, WebUI URL, icon, category), and — the genuinely hard part — CA templates are fundamentally one-container-each, while BrewHub is backend + Caddy (+ optional mosquitto). The two realistic long-term shapes are (a) bundle backend+Caddy into a single container image (most CA-native, but undoes ADR-007's separate-reverse-proxy design, a real architectural change) or (b) publish as a compose-based CA entry (less work, but reaches fewer users — only those with the Compose Manager plugin installed). That choice is deliberately **not** made now — it doesn't need to be, and making it prematurely would be the more expensive mistake.

What's done now is exactly the subset that's useful regardless of which shape gets picked later, *and* independently useful today even without any CA ambitions at all: a published image (Unraid — or anyone — pulls instead of building) and the WebUI label (one of CA's actual requirements, and works immediately under compose too). Both are pure prerequisites either way; neither commits to (a) or (b).

**Note**: the frontend still isn't part of this — Caddy serves `apps/frontend/dist` via a bind mount, which still needs a local `pnpm --filter @brewhub/frontend build` before `docker compose up`, on whatever machine runs the stack. That's a real gap in the "pull and go, nothing to build locally" story this ADR is aimed at, deliberately left alone here to keep this change to what was actually asked for — worth closing (a small custom Caddy image with the built frontend baked in, published the same way) as a natural next step, but not yet done.

**Verification**: `docker compose config` (both the base file alone and combined with the dev overlay) confirmed to parse correctly — image reference resolves with the right default tag, the dev overlay correctly produces both `image:` and `build:` on the same service, and the WebUI label renders as expected. The publish workflow itself was watched running for real via `gh run watch`, not just written and assumed correct — which caught a genuine gap on the first run: `docker/build-push-action` defaults to single-platform (the runner's own `amd64`), so the first published image had no `arm64` manifest at all. Harmless for the actual Unraid target (x86_64-only) but found by trying to pull it on this machine (Apple Silicon) as part of verifying the pipeline for real, rather than stopping at "the push step succeeded." Fixed with `setup-qemu-action` + an explicit `platforms: linux/amd64,linux/arm64`, then re-verified all the way through: pulled the rebuilt image natively on `arm64`, ran it standalone (`docker run`, no compose), and confirmed `/api/health` responds `200` — genuinely proving publish → pull → run works, not just publish → push-step-exits-zero.

## ADR-018: `devices.type`'s CHECK constraint and `DeviceTypeSchema` are two sources of truth that must be updated together

**Decision**: `0013_gravity_bridge_device_type.sql` recreates `devices` (same table-recreate pattern as ADR-003/0006, SQLite can't `ALTER` a `CHECK` constraint) to add `gravity_bridge` to the allowed `type` values.

**Context**: found live, registering a real `gravity-bridge-01` device against a freshly deployed instance — `POST /api/devices` returned a `500` with `SQLITE_CONSTRAINT_CHECK`, not the `400` a validation failure would give. `packages/shared-types/src/device.ts`'s `DeviceTypeSchema` (Zod, request validation) and `devices`' own `CHECK (type IN (...))` (SQLite, storage-level enforcement) are independent, hand-maintained lists — nothing keeps them in sync automatically, and Zod validating a request successfully says nothing about whether the database will actually accept the resulting `INSERT`. `gravity_bridge` was added to the Zod schema when gravity/hydrometer support landed (ADR-014) but the matching migration was never written, so every gravity-bridge device registration has been broken since — silently, since nothing in the test suite exercised inserting one.

**Consequences**: `apps/backend/src/db/repositories/devices.repo.test.ts` (new) parameterizes over every `DeviceTypeSchema.options` value and asserts each one actually inserts — not just the one value that was broken, so a *future* device type added to the Zod enum without a matching migration fails a test immediately instead of waiting for someone to hit it live. Worth remembering as a standing rule: any change to `DeviceTypeSchema` needs a paired migration recreating `devices`' `CHECK` constraint, in the same commit — this test is the backstop, not a substitute for remembering that by hand.

**Update (same bug, second table)**: found immediately after fixing the above, uploading a real `gravity-bridge` firmware build — `firmware_builds.board`'s `CHECK` constraint had the identical problem against `FirmwareBoardSchema`, fixed the same way in `0014_gravity_bridge_firmware_board.sql`, with the same parameterized-test treatment added to `firmware-builds.repo.test.ts`. Prompted an audit of every other `CHECK` constraint in the schema against its corresponding Zod schema (`device_configs.mode` vs. `ControlModeSchema`, `taps.measurement_type` vs. `TapMeasurementTypeSchema`) — both already correct, no further drift found. Worth noting: `hydrometers.type` has no `CHECK` constraint at all (just `type TEXT NOT NULL`), so it can't have this exact failure mode, but it also means SQLite enforces nothing about that column — weaker validation, a different and lower-severity gap, not fixed here.
