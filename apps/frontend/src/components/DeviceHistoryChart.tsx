import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getFlowHistory, getGravityHistory, getTemperatureHistory, getWeightHistory } from "../api/history";

export type HistoryMetric = "temperature" | "flow" | "weight" | "gravity";

const REFETCH_INTERVAL_MS = 10000;
const CHART_HEIGHT = 160;

const unitByMetric: Record<HistoryMetric, string> = {
  temperature: "°C",
  flow: "pulses",
  weight: "g",
  gravity: "SG",
};

// For metric === "gravity", `channel` carries the hydrometer id (a number
// as a string) instead of a device-scoped sensor/flow/weight index —
// gravity history is hydrometer-scoped, not device-scoped (see
// hydrometers.routes.ts), so `deviceId` is simply unused for that branch.
async function fetchPoints(
  deviceId: string,
  metric: HistoryMetric,
  channel: string,
): Promise<Array<{ ts: number; value: number | null }>> {
  if (metric === "temperature") {
    const rows = await getTemperatureHistory(deviceId, channel);
    return rows.map((r) => ({ ts: r.ts, value: r.temperatureC }));
  }
  if (metric === "flow") {
    const rows = await getFlowHistory(deviceId, Number(channel));
    return rows.map((r) => ({ ts: r.ts, value: r.pulseCount }));
  }
  if (metric === "gravity") {
    const rows = await getGravityHistory(Number(channel));
    return rows.map((r) => ({ ts: r.ts, value: r.gravitySg }));
  }
  const rows = await getWeightHistory(deviceId, Number(channel));
  return rows.map((r) => ({ ts: r.ts, value: r.grams }));
}

export function DeviceHistoryChart({
  deviceId,
  metric,
  channel,
  label,
}: {
  deviceId: string;
  metric: HistoryMetric;
  channel: string;
  label: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const query = useQuery({
    queryKey: ["history", deviceId, metric, channel],
    queryFn: () => fetchPoints(deviceId, metric, channel),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  // uPlot expects x in seconds (its built-in time formatting assumes unix
  // seconds), our API returns ms — convert once here rather than baking
  // unit assumptions into the backend response shape.
  const uplotData = useMemo<uPlot.AlignedData>(() => {
    const rows = query.data ?? [];
    return [rows.map((r) => Math.floor(r.ts / 1000)), rows.map((r) => r.value)];
  }, [query.data]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!plotRef.current) {
      plotRef.current = new uPlot(
        {
          width: containerRef.current.clientWidth || 400,
          height: CHART_HEIGHT,
          series: [
            {},
            {
              label,
              stroke: "#34d399",
              width: 1.5,
              points: { show: false },
            },
          ],
          axes: [
            { stroke: "#525252", grid: { stroke: "#262626" }, ticks: { stroke: "#262626" } },
            {
              stroke: "#525252",
              grid: { stroke: "#262626" },
              ticks: { stroke: "#262626" },
              label: unitByMetric[metric],
            },
          ],
          scales: { x: { time: true } },
          legend: { show: false },
          cursor: { show: true },
        },
        uplotData,
        containerRef.current,
      );
    } else {
      plotRef.current.setData(uplotData);
    }
  }, [uplotData, label, metric]);

  useEffect(() => {
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      plotRef.current?.setSize({ width: el.clientWidth, height: CHART_HEIGHT });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasData = (query.data ?? []).length > 0;

  return (
    <div className="space-y-1">
      {query.isLoading && <p className="text-xs text-neutral-600 dark:text-neutral-500">Loading history...</p>}
      {query.isError && <p className="text-xs text-red-600 dark:text-red-400">Could not load history.</p>}
      {query.data && !hasData && <p className="text-xs text-neutral-600 dark:text-neutral-500">No history yet.</p>}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
