import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { getFlowHistory, getGravityHistory, getTemperatureHistory, getWeightHistory } from "../api/history";
import { useTheme } from "../theme/ThemeProvider";

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

// uPlot paints to a canvas, so it can't pick up the colour tokens through a
// class the way the rest of the UI does — it has to read the resolved custom
// property itself. The tokens are stored as space-separated RGB channels (see
// styles/index.css), which `rgb()` accepts verbatim.
function token(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `rgb(${v})`;
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
  const { theme } = useTheme();

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

  // The plot is constructed from whatever data is current at the time, and the
  // effect below only ever pushes updates — so the latest data has to be
  // readable during render, before either effect runs.
  const dataRef = useRef<uPlot.AlignedData>(uplotData);
  dataRef.current = uplotData;

  // uPlot resolves its colours once, at construction. Rebuilding on a theme
  // change is what keeps the chart legible in both themes; it happens at most
  // once per toggle, so the cost is irrelevant.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const axis = { stroke: token("--c-dim"), grid: { stroke: token("--c-line") }, ticks: { stroke: token("--c-line") } };

    const plot = new uPlot(
      {
        width: el.clientWidth || 400,
        height: CHART_HEIGHT,
        series: [
          {},
          {
            label,
            stroke: token("--c-amber"),
            width: 1.5,
            points: { show: false },
          },
        ],
        axes: [axis, { ...axis, label: unitByMetric[metric] }],
        scales: { x: { time: true } },
        legend: { show: false },
        cursor: { show: true },
      },
      dataRef.current,
      el,
    );
    plotRef.current = plot;

    return () => {
      plot.destroy();
      plotRef.current = null;
    };
  }, [theme, label, metric]);

  useEffect(() => {
    plotRef.current?.setData(uplotData);
  }, [uplotData]);

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
      {query.isLoading && <p className="text-xs text-dim">Loading history...</p>}
      {query.isError && <p className="text-xs text-crit">Could not load history.</p>}
      {query.data && !hasData && <p className="text-xs text-dim">No history yet.</p>}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
