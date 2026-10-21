# BrewHub / UniBrew Control

[![CI](https://github.com/ippodrome/brewhub/actions/workflows/ci.yml/badge.svg)](https://github.com/ippodrome/brewhub/actions/workflows/ci.yml)

Unified control platform for kegerators and fermentation chambers, replacing Keg Cop and BrewPiLess.

See [claude.md](./claude.md) for the full project spec and [DECISIONS.md](./DECISIONS.md) for resolved architecture decisions and rationale.

## Local development

```
pnpm install
pnpm --filter @brewhub/shared-types build   # required once after install, see note below
pnpm --filter @brewhub/backend create-user -- --username admin --password <password>
pnpm --filter @brewhub/backend dev       # needs JWT_SECRET, DB_PATH, MQTT_URL env vars
pnpm --filter @brewhub/frontend dev      # BACKEND_PORT=<port> if backend isn't on 3000
```

`packages/shared-types` is a compiled package (not zero-build) so its output works under plain `node`, not just `tsx`/Vite's on-the-fly TS transpilation. If you edit anything in `packages/shared-types/src`, run `pnpm --filter @brewhub/shared-types build` (or `pnpm -r build`) before the backend/frontend will see the change — there's no watch mode wired up yet.

## Docker

`docker-compose.yml` is just `backend` + `caddy` — it does **not** bundle an MQTT broker by default, since plenty of self-hosters (this project's own target deployment included) already run one for other things (Home Assistant, other IoT gear, etc.) and running a second broker would be pure waste. Pick one of the two paths below.

Both services **pull** prebuilt images rather than building from source, so there is nothing to compile — and no Node toolchain needed — on whatever host you run this on. `backend` pulls `ghcr.io/ippodrome/brewhub-backend`; `caddy` pulls `ghcr.io/ippodrome/brewhub-frontend`, which is stock Caddy with the built frontend and the Caddyfile baked in. Both are published on every push to `main` and on version tags.

Pin a version instead of tracking `latest` with `BREWHUB_IMAGE_TAG` (backend) and `BREWHUB_FRONTEND_TAG` (frontend) in `.env` — a `sha-xxxxxxx` or a released version tag. They are separate variables because the two workflows have separate path filters: a frontend-only commit publishes a frontend `sha-` tag and no matching backend one, so a single shared variable would fail to resolve.

```
cd docker
cp .env.example .env                                # then fill in real secrets
```

**Path A — you already have an MQTT broker** (this is the Unraid target deployment's actual situation): edit `.env` — set `MQTT_URL` to that broker's address (e.g. `mqtt://192.168.1.50:1883`, or `mqtt://<container-name>:1883` if it's reachable by Docker DNS on the same host), and `MQTT_USERNAME`/`MQTT_PASSWORD` to a user you create *on that broker* for BrewHub's backend (however you manage that broker's users/ACLs — it's not BrewHub's to configure). Then:

```
docker compose up
```

That's it — no `mosquitto` service starts, `backend` connects straight to your existing broker. Every physical BrewHub device (ESP32) also needs its own user on that same broker (see "Adding a device" below) — created the same way you manage any other user on it.

**Path B — you don't have one yet**: use the bundled overlay, which adds a `mosquitto` service and points `backend` at it automatically:

```
mosquitto_passwd -b -c mosquitto/passwd brewhub-backend <password>   # match MQTT_PASSWORD in .env
docker compose -f docker-compose.yml -f docker-compose.mosquitto.yml up
```

**Testing uncommitted changes to the backend** (not the usual path — most of the time you want the published image above): add the dev overlay, which builds from local source instead of pulling, and don't forget `--build` or Compose won't know anything changed:

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

**Unraid**: the `caddy` service carries a `net.unraid.docker.webui` label, so once the stack is running under Unraid's Docker tab (native Compose support on 6.12+, or the community "Docker Compose Manager" plugin on older versions) it gets a proper WebUI button pointing straight at the app — no separate Unraid-specific template needed, the same `docker-compose.yml` works as-is. A traditional Community-Applications-store template (for one-click installs by other people) is a bigger, deliberately deferred step — see DECISIONS.md ADR-017.

Either way, frontend/API end up at `https://localhost:8443` (self-signed cert from Caddy's internal CA, issued up front for whatever you set `BREWHUB_HOST` to — see `docker/caddy/Caddyfile` and DECISIONS.md ADR-024). Port 8443 was chosen instead of 443 because the reference deployment host already runs NginxProxyManager on the standard range — see DECISIONS.md ADR-007.

The Caddyfile is baked into the frontend image, not bind-mounted, so that a deployment needs nothing on disk but `docker-compose.yml` and `.env`. Editing it therefore means rebuilding: use the dev overlay (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`), which builds both images from local source.

**In-app updates:** Settings → Updates can install new releases with an automatic database backup and rollback, via a separate, socket-proxied `updater` service (`docker/docker-compose.updater.yml`). Releases are cut by pushing a `vX.Y.Z` tag (`.github/workflows/release.yml`). Setup and operations guide (Swedish): [docs/UPDATERING.md](docs/UPDATERING.md).

To upgrade a running deployment manually to the latest release:

```
docker compose pull && docker compose up -d
```

First login needs a user, created from inside the running backend container:

```
docker compose exec backend node dist/scripts/create-user.js -- --username admin --password <password>
```

## Backup

The whole application state is the single SQLite file at `backend-data:/data/brewhub.db` (Docker named volume) — nothing else to back up.

The Settings page has "Download backup" / "Restore from backup" buttons that cover this without touching Docker directly — download streams a live, consistent snapshot (via SQLite's own online backup API, safe to run while the stack is up), and restore uploads a file, validates it's actually a SQLite database, automatically saves a safety copy of the current database on the server first, then atomically swaps the restored file into place. The running backend keeps serving the *old* data until it's restarted (it already has the old file open, restoring only changes what's on disk) — restart it after a restore for the change to take effect:

```
docker compose restart backend
```

The manual/CLI equivalent still works if you'd rather not go through the UI:

```
docker compose exec backend sh -c 'cp /data/brewhub.db /data/brewhub.db.bak'
docker cp docker-backend-1:/data/brewhub.db.bak ./brewhub-backup-$(date +%Y%m%d).db
```

To restore this way: stop the stack, replace the volume's `brewhub.db` (and delete any `-wal`/`-shm` sidecar files) with the backup, then `docker compose up -d`.

**Telemetry retention**: temperature/flow/weight/gravity history older than 30 days (`TELEMETRY_RETENTION_DAYS`) is automatically collapsed into hourly averages once a day (`TELEMETRY_ROLLUP_INTERVAL_MS`), so the database stays bounded indefinitely regardless of how long the stack has been running — see DECISIONS.md ADR-015. No action needed; both env vars have sensible defaults and only need setting if you want a different window.

## Adding a device

The firmware's compile-time `DEVICE_ID` and the id you use when adding the device via the UI must match **exactly**, or the device's telemetry/status messages will be silently dropped (the backend only accepts messages from devices it already knows about). Once a device has been flashed and connects to the broker at least once, it announces itself over MQTT — the "Add device" dialog shows it as a one-click pick (prefills id/type) instead of you needing to type the id manually. It only needs to have connected once, not currently be online.

1. **Configure secrets.** In the relevant `firmware/<board>/include/` directory, copy `secrets.h.example` to `secrets.h` (gitignored) and fill in your WiFi SSID/password, the Mosquitto host/port/username/password (the *device* credentials — see below, not the backend's own), and a unique `DEVICE_ID` (e.g. `fermenter-01`, `kegerator-01`, `keg-scale-01`).
   - Every physical device needs its **own** Mosquitto user — don't reuse the backend's own credentials for devices. On the bundled broker (Path B above): `mosquitto_passwd -b docker/mosquitto/passwd <device-id> <password>`, then `docker compose restart mosquitto`. On your own existing broker (Path A): create it however you already manage that broker's users.
2. **Flash it.** With the board connected over USB, either the CLI (works everywhere):
   ```
   cd firmware/<board>
   pio run -e <env> -t upload
   pio device monitor    # optional, watch boot logs at 115200 baud
   ```
   or the browser, via the Firmware page — see "Firmware / flashing" below. Board/environment names: `fermenter-brewpi` (fermenter), `kegerator-kegcop` (kegerator), `keg-scale` (keg scale), `gravity-bridge` (gravity/hydrometer BLE bridge — see "Gravity / hydrometers" below). Run `pio test -e native` first for `fermenter`/`kegerator` if you've touched anything under `firmware/shared/control` — those are the safety-critical control-loop tests and must pass before flashing real hardware.
3. **Add the device in BrewHub.** Devices page → Add device → same `id` as the firmware's `DEVICE_ID`, matching `type` (`fermenter`, `kegerator`, or `keg_scale`). It'll show Offline until the device's first status/telemetry message arrives.
4. **Type-specific follow-up:**
   - **Fermenter/kegerator:** sensors and their addresses appear automatically under "Sensors" once telemetry starts arriving — no manual entry. Configure setpoint/mode/PID under "Configure".
   - **Kegerator taps:** under "Taps", add one per physical flow meter (`measurementType: flow`) or per keg-scale channel (`measurementType: weight`, referencing a separately-added `keg_scale` device).
   - **Keg scale:** the load cell needs calibrating before its readings mean anything — see `firmware/keg-scale/include/pins.h` for the calibration factor procedure, and use the device card's live weight readout + "Tare" button (only with the platform in its true empty/reference state) while setting up a weight-measured tap's empty/full weight fields.

## Firmware / flashing

The Firmware nav page covers both the initial flash (in-browser alternative to the `pio run -t upload` CLI step above) and pushing updates to already-paired devices over WiFi (OTA) — no physical access needed for the latter.

**Every uploaded `.bin` is tied to one specific device's id** — WiFi/MQTT credentials and `DEVICE_ID` are still compile-time constants (see "Adding a device" above), completely unchanged by this feature. Build locally as usual (`pio run -e <env>`, producing `firmware/<board>/.pio/build/<env>/firmware.bin`), then upload that file tagged with the device id it was built for. There's no generic "flash any device" image — see DECISIONS.md ADR-010 for why that's a deliberate v1 scope decision, not an oversight.

- **Flash via WebSerial** (initial flash, board connected over USB): needs Chrome or Edge — the Web Serial API isn't implemented anywhere else. Only writes the app partition; it assumes the board already has a compatible bootloader + partition table from some prior flash (the CLI method above, typically), not a completely factory-blank chip.
- **Push OTA** (already-paired device, on WiFi): only enabled once a build's tagged device id matches a device you've actually added in BrewHub. Requires `PUBLIC_URL` set in the backend's environment (e.g. `https://192.168.1.50:8443` — the LAN address devices reach Caddy at; the backend has no way to know this on its own) or the trigger request 400s with a clear error. The device downloads over HTTPS with certificate validation disabled (`WiFiClientSecure::setInsecure()`) — same LAN-trust reasoning as plaintext MQTT, see DECISIONS.md ADR-008.

## Notifications

The Settings page notifies you (any/all of the channels below) when a device goes offline, or a keg's remaining volume drops below 15%. See DECISIONS.md ADR-011 for the exact trigger scope and why it's deliberately narrow for v1.

- **Browser push**: click "Enable push notifications" on the Settings page — needs Chrome, Edge, or Firefox, and (per ADR-007) works because the whole app is already served over HTTPS. No setup beyond that; the VAPID key pair notifications rely on is generated automatically on first backend boot.
- **Telegram**: message [@BotFather](https://t.me/BotFather) to create a bot and get a token, message your new bot once (anything), then open `https://api.telegram.org/bot<token>/getUpdates` in a browser to find your chat id in the response. Enter both on the Settings page.
- **Discord**: Server Settings → Integrations → Webhooks → New Webhook → copy the webhook URL. Enter it on the Settings page.

"Send test notification" fires all configured channels at once — useful for confirming setup without waiting for a real device to go offline.

## Home Assistant

If Home Assistant is already on the same MQTT broker as BrewHub (see "Bring your own broker" above), entities appear automatically — no YAML, no separate integration to install. This uses [HA's MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery) protocol, always on: every registered device gets an online/offline entity, every discovered temperature sensor gets a sensor entity, and every tap gets a "remaining %" sensor entity, grouped in HA under one device per BrewHub device. Discovery configs are republished on every backend startup, so this also works if your broker doesn't persist retained messages across restarts.

Removing a device or tap in BrewHub removes the corresponding HA entities too. See DECISIONS.md ADR-012 for the exact scope and reasoning — in particular, why keg volume is published to a *new* MQTT topic rather than reusing the REST API, and why this doesn't conflict with ADR-004's "backend never commands a device" rule (this is the opposite direction: backend publishing data *outward*, not commanding anything).

## Gravity / hydrometers

Fermenters can follow a gravity-based profile (setpoint driven by measured specific gravity instead of elapsed time) once a wireless hydrometer is assigned to them — the "Hydrometer" tab on a fermenter's card handles both adding one and assigning an existing one. See DECISIONS.md ADR-014 for the full architecture (why BLE scanning lives on its own dedicated board rather than the fermenter, and why ingestion is a documented MQTT contract rather than something bespoke).

- **Tilt / Rapt Pill** (Bluetooth): flash the `gravity-bridge` board (`firmware/gravity-bridge`, PlatformIO env `gravity-bridge`) onto a spare ESP32 and place it within BLE range of the fermenter — it scans every 30s and publishes anything it finds over MQTT, no pairing needed. It self-announces like every other board, so it shows up in "Add device"'s discovered-devices pick-list once it's connected — though registering it as a device is optional, since gravity readings are matched by hydrometer identifier, not by device. Add a hydrometer with the exact identifier the bridge uses (Tilt: `tilt-<colour>`, e.g. `tilt-red`; Rapt Pill: `rapt-<mac>`, a 6-byte hex MAC printed in the bridge's serial log on first sighting). **Rapt Pill parsing has never been tested against real hardware** (see ADR-014) — its byte layout is sourced from a real, credible reference (the parser behind Home Assistant's official `rapt_ble` integration) and its math was verified with a standalone test, so it's a considerably more trustworthy implementation than a guess, but "no physical device available" is a ceiling that stays until someone tries it against an actual Rapt Pill. Only its "V1" payload format is supported; a newer "V2" format (with gravity-velocity) is deliberately not implemented. Tilt support has no such caveat.
- **iSpindel** (WiFi): in the iSpindel's own web configuration, set it to POST to `https://<your-brewhub-host>/api/gravity/ispindel`, with units set to Celsius (BrewHub doesn't convert units — see ADR-014). Add a hydrometer with identifier matching the iSpindel's configured `name`.

Once a hydrometer has readings, use the calibration slope/offset fields on the Hydrometer tab if its reported gravity is consistently off from a manual hydrometer reading (`correctedSG = rawSG * slope + offset`) — applied once at ingest, so history and profile resolution both use the corrected value automatically.

## Tests

`pnpm -r test` runs backend + shared-types unit tests (frontend has none yet). `pnpm -r typecheck` and `pnpm -r build` across the whole workspace — run `build` before `typecheck`/`test` on a clean checkout, since `shared-types` is a compiled package the others need `dist/` from. Firmware: `pio test -e native` (control-loop logic, no hardware) and `pio run -e <env>` (real compile check) per board under `firmware/`.

All of the above runs automatically on every push/PR via GitHub Actions (`.github/workflows/ci.yml`) — three jobs: monorepo verification, a `pio run` compile matrix across all four boards, and the native control-loop tests. Every board's `secrets.h` (gitignored, holds real WiFi/MQTT credentials) is stubbed from its committed `.example` file for the compile check — no real credentials or device pairing involved.
