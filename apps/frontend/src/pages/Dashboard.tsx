import { Link } from "react-router-dom";
import { Beer, FlaskConical, Plus, Radio } from "lucide-react";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { TemperatureReadout } from "../components/TemperatureReadout";
import { TapVolumeSummary } from "../components/TapVolumeSummary";
import { EmptyState } from "../components/EmptyState";
import { StatusDot } from "../components/StatusDot";
import { ProfileProgress } from "../components/ProfileProgress";
import { summarizeFleet } from "../lib/status";

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Dashboard(): JSX.Element {
  const { connected, devices, telemetryByDevice } = useLiveTelemetry();

  const kegerators = devices.filter((d) => d.type === "kegerator");
  const fermenters = devices.filter((d) => d.type === "fermenter");
  const fleet = summarizeFleet(devices);

  return (
    <div className="page space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1 className="page-title mt-1">Your brewery</h1>
        </div>
        {/* Device health only — the server connection lives in the header,
            so a green dot here can never mean "socket open, devices dead". */}
        {connected && fleet.total > 0 && (
          <p className="flex items-center gap-2 text-sm font-medium text-muted" role="status">
            <StatusDot tone={fleet.tone} />
            {fleet.label}
          </p>
        )}
      </header>

      {!connected && devices.length === 0 ? (
        <div className="grid gap-5 sm:grid-cols-2" aria-busy="true" aria-label="Connecting">
          {[0, 1].map((i) => (
            <div key={i} className="card h-56 animate-pulse bg-tint/60" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nothing to watch yet"
          action={
            <Link to="/devices" className="btn-primary">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add a device
            </Link>
          }
        >
          Add a fermenter or kegerator controller and its live temperatures will appear here.
        </EmptyState>
      ) : (
        <div className="space-y-12">
          {fermenters.length > 0 && (
            <section className="space-y-4" aria-labelledby="sec-ferm">
              <h2 id="sec-ferm" className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
                <FlaskConical className="h-5 w-5 text-amber" strokeWidth={1.75} />
                Fermentation
              </h2>
              <div className="grid gap-5 md:grid-cols-2">
                {fermenters.map((device) => (
                  <TemperatureReadout key={device.id} device={device} telemetry={telemetryByDevice[device.id]}>
                    <ProfileProgress deviceId={device.id} compact />
                  </TemperatureReadout>
                ))}
              </div>
            </section>
          )}

          {kegerators.length > 0 && (
            <section className="space-y-4" aria-labelledby="sec-keg">
              <h2 id="sec-keg" className="flex items-center gap-2 font-display text-xl font-semibold text-fg">
                <Beer className="h-5 w-5 text-amber" strokeWidth={1.75} />
                Serving
              </h2>
              <div className="grid gap-5 md:grid-cols-2">
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
