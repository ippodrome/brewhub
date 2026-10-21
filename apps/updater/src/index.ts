import { loadUpdaterConfig } from "./config.js";
import { createCompose } from "./compose.js";
import { fetchLatestRelease } from "./github.js";
import { createUpdaterServer } from "./server.js";
import { createHealthWaiter, Updater } from "./updater.js";

const config = loadUpdaterConfig();
const updater = new Updater({
  config,
  compose: createCompose(config, undefined, (m) => console.log(`[updater] ${m}`)),
  fetchRelease: () => fetchLatestRelease(config.githubRepo, config.githubToken),
  waitHealthy: createHealthWaiter(config.backendHealthUrl, config.healthTimeoutMs),
});
await updater.init();
const server = createUpdaterServer(updater, config.secret);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`[updater] listening on :${config.port}${config.dryRun ? " (DRY RUN)" : ""} for project ${config.composeProject}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (updater.isRunning()) console.warn("[updater] stopping during an update — status will show it as interrupted");
    server.close(() => process.exit(0));
  });
}
