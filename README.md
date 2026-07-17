# BrewHub / UniBrew Control

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

```
pnpm --filter @brewhub/frontend build              # Caddy serves this static output directly
cd docker
cp .env.example .env                                # then fill in real secrets
mosquitto_passwd -c mosquitto/passwd <username>     # generates the (gitignored) broker password file
docker compose up --build
```

Frontend/API: `https://localhost:8443` (self-signed cert via Caddy's `tls internal { on_demand }`, since the deployment IP isn't known ahead of time). Port 8443 was chosen instead of 443 because the reference deployment host already runs NginxProxyManager on the standard range — see DECISIONS.md ADR-007.
