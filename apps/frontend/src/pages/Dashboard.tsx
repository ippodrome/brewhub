import { Link } from "react-router-dom";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { TemperatureReadout } from "../components/TemperatureReadout";
import { TapVolumeSummary } from "../components/TapVolumeSummary";

export function Dashboard(): JSX.Element {
  const { connected, devices, telemetryByDevice } = useLiveTelemetry();

  const kegerators = devices.filter((d) => d.type === "kegerator");
  const fermenters = devices.filter((d) => d.type === "fermenter");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Dashboard</h1>
        <span className={`text-xs ${connected ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-500"}`}>
          {connected ? "Live" : "Connecting..."}
        </span>
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-500">
          No devices yet.{" "}
          <Link to="/devices" className="text-neutral-700 dark:text-neutral-300 underline underline-offset-2">
            Add one
          </Link>{" "}
          to see live readings here.
        </p>
      ) : (
        <div className="space-y-8">
          {fermenters.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-500">Fermentation</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {fermenters.map((device) => (
                  <TemperatureReadout key={device.id} device={device} telemetry={telemetryByDevice[device.id]} />
                ))}
              </div>
            </section>
          )}

          {kegerators.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-500">Kegerator</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {kegerators.map((device) => (
                  <TemperatureReadout key={device.id} device={device} telemetry={telemetryByDevice[device.id]}>
                    <TapVolumeSummary device={device} />
                  </TemperatureReadout>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
