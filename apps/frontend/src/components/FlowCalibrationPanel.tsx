import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_POUR_DENSITY_G_PER_ML,
  MIN_CALIBRATION_VOLUME_ML,
  type Device,
  type FinishFlowCalibrationRequest,
  type FlowCalibrationResult,
  type Tap,
} from "@brewhub/shared-types";
import { ApiError } from "../api/client";
import { cancelCalibration, finishCalibration, getCalibration, startCalibration } from "../api/taps";

/** How often the live pulse count refreshes while a pour is in progress. */
const PROGRESS_POLL_MS = 1000;

/**
 * Turns the backend's structured rejection into something actionable. The
 * backend refuses rather than installing a bad factor (see
 * compute-flow-calibration.ts), so every one of these is recoverable —
 * the session stays open and the user can pour more or re-enter the amount.
 */
function rejectionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not apply the calibration.";
  try {
    const body = JSON.parse(error.message) as {
      rejection?: { reason: string; pulses?: number; volumeMl?: number; pulsesPerLiter?: number };
    };
    switch (body.rejection?.reason) {
      case "counter_reset":
        return "The device restarted mid-calibration, so the starting pulse count is no longer valid. Start over.";
      case "too_few_pulses":
        return `Only ${body.rejection.pulses ?? 0} pulses were counted — check the meter is wired to this tap's flow input, then pour again.`;
      case "too_little_volume":
        return `That pour is too small to calibrate from. Pour at least ${MIN_CALIBRATION_VOLUME_ML} mL and try again.`;
      case "implausible_factor":
        return `That works out to ${Math.round(body.rejection.pulsesPerLiter ?? 0)} pulses/L, which is not a plausible flow meter. Check the amount you entered.`;
      default:
        return "Could not apply the calibration.";
    }
  } catch {
    return "Could not apply the calibration.";
  }
}

const inputClass =
  "w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500";
const labelClass = "text-xs text-neutral-600 dark:text-neutral-500";
const buttonClass =
  "rounded-xl px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200";

export function FlowCalibrationPanel({ device, tap }: { device: Device; tap: Tap }): JSX.Element {
  const [method, setMethod] = useState<"volume" | "weight">("volume");
  const [amount, setAmount] = useState("");
  const [density, setDensity] = useState(String(DEFAULT_POUR_DENSITY_G_PER_ML));
  const [result, setResult] = useState<FlowCalibrationResult | null>(null);
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["calibration", device.id, tap.id],
    queryFn: () => getCalibration(device.id, tap.id),
    // Only poll while a pour is actually in progress.
    refetchInterval: (query) => (query.state.data ? PROGRESS_POLL_MS : false),
  });
  const session = sessionQuery.data ?? null;

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["calibration", device.id, tap.id] });
    void queryClient.invalidateQueries({ queryKey: ["taps", device.id] });
  }

  const startMutation = useMutation({
    mutationFn: () => startCalibration(device.id, tap.id),
    onSuccess: () => {
      setResult(null);
      invalidate();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelCalibration(device.id, tap.id),
    onSuccess: invalidate,
  });

  const finishMutation = useMutation({
    mutationFn: () => {
      const value = Number(amount);
      const request: FinishFlowCalibrationRequest =
        method === "volume"
          ? { method: "volume", actualVolumeMl: value }
          : { method: "weight", actualWeightG: value, densityGPerMl: Number(density) };
      return finishCalibration(device.id, tap.id, request);
    },
    onSuccess: (calibrationResult) => {
      setResult(calibrationResult);
      setAmount("");
      invalidate();
    },
  });

  const amountIsValid = Number.isFinite(Number(amount)) && Number(amount) > 0;

  return (
    <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-800 pt-2">
      {!session && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-600 dark:text-neutral-500">
            Currently {Math.round(tap.pulsesPerLiter ?? 0)} pulses/L. To recalibrate: start below,
            pour at least {MIN_CALIBRATION_VOLUME_ML} mL into a measuring jug or onto a scale, then
            enter what you actually got. The poured amount is deducted from the keg, so nothing is
            double-counted.
          </p>
          <button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {startMutation.isPending ? "Starting..." : "Start calibration"}
          </button>
          {startMutation.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">Could not start calibration.</p>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <p>
                Calibrated: {Math.round(result.previousPulsesPerLiter)} →{" "}
                <span className="font-medium">{Math.round(result.pulsesPerLiter)}</span> pulses/L (
                {result.driftPercent >= 0 ? "+" : ""}
                {result.driftPercent.toFixed(1)}%)
              </p>
              <p className="mt-0.5 opacity-80">
                {result.pulses} pulses over {Math.round(result.actualVolumeMl)} mL.
              </p>
            </div>
          )}
        </div>
      )}

      {session && (
        <div className="space-y-2">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 py-2">
            <p className="text-xs text-neutral-600 dark:text-neutral-500">Pouring...</p>
            <p className="text-sm tabular-nums text-neutral-800 dark:text-neutral-200">
              {session.pulsesSoFar} pulses
              <span className="text-neutral-600 dark:text-neutral-500">
                {" "}
                · ~{Math.round(session.estimatedVolumeMl)} mL at the old factor
              </span>
            </p>
          </div>

          <div className="flex gap-2">
            {(["volume", "weight"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setMethod(option)}
                className={`rounded-xl px-2.5 py-1 text-xs ${
                  method === option
                    ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {option === "volume" ? "By volume" : "By weight"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>
                {method === "volume" ? "Measured volume (mL)" : "Measured weight (g)"}
              </label>
              <input
                className={inputClass}
                type="number"
                step="1"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={method === "volume" ? "1000" : "1000"}
              />
            </div>
            {method === "weight" && (
              <div>
                <label className={labelClass}>Density (g/mL)</label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.001"
                  min="0"
                  value={density}
                  onChange={(e) => setDensity(e.target.value)}
                />
              </div>
            )}
          </div>
          {method === "weight" && (
            <p className="text-xs text-neutral-600 dark:text-neutral-500">
              Weigh the empty vessel first and subtract it. Water is 1.000; beer near terminal
              gravity is about 1.010.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => finishMutation.mutate()}
              disabled={!amountIsValid || finishMutation.isPending}
              className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {finishMutation.isPending ? "Applying..." : "Apply calibration"}
            </button>
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>

          {finishMutation.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {rejectionMessage(finishMutation.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
