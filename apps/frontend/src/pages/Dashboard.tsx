import { Link } from "react-router-dom";
import { Beer, CircleDot, Cpu, Snowflake } from "lucide-react";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { TemperatureReadout } from "../components/TemperatureReadout";
import { TapVolumeSummary } from "../components/TapVolumeSummary";

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: typeof Cpu;
  tone?: "neutral" | "amber" | "emerald";
}): JSX.Element {
  const iconTone = {
    neutral: "text-neutral-400 dark:text-neutral-600",
    amber: "text-amber-500/70",
    emerald: "text-emerald-500/70",
  }[tone];

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-500">{label}</div>
          <div className="mt-1 text-3xl font-display font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {value}
          </div>
        </div>
        <Icon className={`mt-0.5 h-6 w-6 ${iconTone}`} strokeWidth={2} />
      </div>
    </div>
  );
}

export function Dashboard(): JSX.Element {
  const { connected, devices, telemetryByDevice } = useLiveTelemetry();

  const kegerators = devices.filter((d) => d.type === "kegerator");
  const fermenters = devices.filter((d) => d.type === "fermenter");
  const onlineCount = devices.filter((d) => d.isOnline).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Dashboard</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-500 mt-0.5">Live status across every device</p>
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${
            connected ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-600 dark:text-neutral-500"
          }`}
        >
          <CircleDot className="h-3 w-3" strokeWidth={2.5} />
          {connected ? "Live" : "Connecting..."}
        </span>
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-500">
          No devices yet.{" "}
          <Link to="/devices" className="text-amber-600 dark:text-amber-400 underline underline-offset-2">
            Add one
          </Link>{" "}
          to see live readings here.
        </p>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Devices online" value={`${onlineCount}/${devices.length}`} icon={Cpu} tone="emerald" />
            <StatCard label="Fermenters" value={String(fermenters.length)} icon={Beer} tone="amber" />
            <StatCard label="Kegerators" value={String(kegerators.length)} icon={Snowflake} tone="amber" />
          </div>

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
