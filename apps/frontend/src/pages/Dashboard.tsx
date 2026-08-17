import { Link } from "react-router-dom";
import { CircleDot } from "lucide-react";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { TemperatureReadout } from "../components/TemperatureReadout";
import { TapVolumeSummary } from "../components/TapVolumeSummary";

export function Dashboard(): JSX.Element {
  const { connected, devices, telemetryByDevice } = useLiveTelemetry();

  const kegerators = devices.filter((d) => d.type === "kegerator");
  const fermenters = devices.filter((d) => d.type === "fermenter");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fg">Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">Live status across every device</p>
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${
            connected ? "text-ok" : "text-dim"
          }`}
        >
          <CircleDot className="h-3 w-3" strokeWidth={2.5} />
          {connected ? "Live" : "Connecting..."}
        </span>
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-dim">
          No devices yet.{" "}
          <Link to="/devices" className="text-amber underline underline-offset-2">
            Add one
          </Link>{" "}
          to see live readings here.
        </p>
      ) : (
        <div className="space-y-8">
          {fermenters.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-dim">Fermentation</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {fermenters.map((device) => (
                  <TemperatureReadout key={device.id} device={device} telemetry={telemetryByDevice[device.id]} />
                ))}
              </div>
            </section>
          )}

          {kegerators.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-dim">Kegerator</h2>
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
