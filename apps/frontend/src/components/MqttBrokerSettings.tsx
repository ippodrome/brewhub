import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ZodError } from "zod";
import { AlertTriangle, Check, Info, Loader2, PlugZap, Server } from "lucide-react";
import type { MqttBrokerMode, MqttBrokerSettings as Settings, UpdateMqttBrokerRequest } from "@brewhub/shared-types";
import { getMqttBroker, saveMqttBroker, testMqttBroker } from "../api/mqtt";
import { describeError } from "../api/system";
import { StatusPill } from "./StatusDot";

const labelClass = "text-xs font-medium text-dim";

function errorText(err: unknown): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? "Check the fields.";
  return describeError(err);
}

function since(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ConnectionStatus({ status }: { status: Settings["status"] }): JSX.Element {
  const tone = status.state === "connected" ? "ok" : status.state === "connecting" ? "warn" : "crit";
  const label = status.state === "connected" ? "Connected" : status.state === "connecting" ? "Connecting…" : "Disconnected";
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface/60 px-4 py-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow">Backend connection</p>
          <p className="mt-0.5 truncate font-mono text-sm text-fg">{status.url || "—"}</p>
        </div>
        <StatusPill tone={tone} label={label} />
      </div>
      {status.state === "connected" && status.connectedAt && (
        <p className="text-xs text-dim">Connected since {since(status.connectedAt)}</p>
      )}
      {status.lastError && status.state !== "connected" && (
        <p className="flex items-start gap-1.5 text-xs text-crit">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> Last error: {status.lastError}
        </p>
      )}
    </div>
  );
}

function ModeOption({
  value,
  current,
  title,
  description,
  onSelect,
}: {
  value: MqttBrokerMode;
  current: MqttBrokerMode;
  title: string;
  description: string;
  onSelect: (m: MqttBrokerMode) => void;
}): JSX.Element {
  const active = value === current;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
        active ? "border-amber/50 bg-amber/[0.07]" : "border-line hover:border-line-strong"
      }`}
    >
      <input
        type="radio"
        name="mqtt-mode"
        value={value}
        checked={active}
        onChange={() => onSelect(value)}
        className="mt-1 accent-[rgb(var(--c-amber))]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{description}</span>
      </span>
    </label>
  );
}

export function MqttBrokerSettings(): JSX.Element {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["mqtt-broker"],
    queryFn: getMqttBroker,
    // Keeps the status pill honest while a broker is (re)connecting.
    refetchInterval: (q) => (q.state.data?.status.state === "connected" ? 15000 : 3000),
  });

  const [mode, setMode] = useState<MqttBrokerMode>("builtin");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("1883");
  const [tls, setTls] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const d = query.data;
    if (!d || initialized) return;
    setMode(d.mode);
    setHost(d.host ?? "");
    setPort(String(d.port));
    setTls(d.tls);
    setUsername(d.username ?? "");
    setInitialized(true);
  }, [query.data, initialized]);

  const request = (): UpdateMqttBrokerRequest =>
    mode === "builtin"
      ? { mode: "builtin" }
      : { mode: "custom", host: host.trim(), port: Number(port), tls, username: username.trim() || null, password: password || undefined };

  const test = useMutation({ mutationFn: () => testMqttBroker(request()) });
  const save = useMutation({
    mutationFn: () => saveMqttBroker(request()),
    onSuccess: (data) => {
      setPassword("");
      test.reset();
      queryClient.setQueryData(["mqtt-broker"], data);
    },
  });

  if (query.isLoading) return <div className="card h-48 animate-pulse p-6" />;
  if (!query.data) return <p className="text-sm text-crit">Could not load MQTT settings: {errorText(query.error)}</p>;
  const d = query.data;

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="card space-y-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-amber">
          <Server className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-display text-base font-semibold text-fg">MQTT broker</h3>
          <p className="text-xs text-dim">Where the backend and your devices exchange telemetry and settings.</p>
        </div>
      </div>

      <ConnectionStatus status={d.status} />

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Broker</legend>
        <ModeOption
          value="builtin"
          current={mode}
          onSelect={setMode}
          title="Built-in (BrewHub Mosquitto)"
          description={`Bundled broker with per-device ACL · ${d.builtinUrl}`}
        />
        <ModeOption
          value="custom"
          current={mode}
          onSelect={setMode}
          title="Custom"
          description="Your own broker, e.g. Home Assistant's Mosquitto add-on."
        />
      </fieldset>

      {mode === "custom" && (
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="space-y-1 sm:col-span-4">
            <label className={labelClass} htmlFor="mqtt-host">Host</label>
            <input id="mqtt-host" className="field" placeholder="192.168.1.20" value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className={labelClass} htmlFor="mqtt-port">Port</label>
            <input id="mqtt-port" className="field tabular-nums" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <label className={labelClass} htmlFor="mqtt-user">Username</label>
            <input id="mqtt-user" className="field" placeholder="brewhub" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <label className={labelClass} htmlFor="mqtt-pass">Password</label>
            <input
              id="mqtt-pass"
              type="password"
              className="field"
              placeholder={d.hasPassword ? "Saved · leave empty to keep" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted sm:col-span-6">
            <input
              type="checkbox"
              checked={tls}
              onChange={(e) => {
                setTls(e.target.checked);
                if (e.target.checked && port === "1883") setPort("8883");
                if (!e.target.checked && port === "8883") setPort("1883");
              }}
              className="h-4 w-4 accent-[rgb(var(--c-amber))]"
            />
            Use TLS (mqtts://)
          </label>
        </div>
      )}

      <div className="flex gap-3 rounded-2xl border border-line bg-surface/60 p-4 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <div className="space-y-1">
          <p>
            Devices connect to the broker themselves: each ESP32 must be reflashed with the same broker host, port,
            username and password in <code className="text-[11px] text-fg">secrets.h</code>.
          </p>
          <p>ACL protection (each device can only use its own topics) only applies to the built-in broker.</p>
        </div>
      </div>

      {test.data && (
        <p className={`flex items-center gap-1.5 text-sm ${test.data.ok ? "text-ok" : "text-crit"}`} role="status">
          {test.data.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {test.data.ok
            ? `Connected to ${test.data.url} in ${test.data.latencyMs} ms.`
            : `Could not connect to ${test.data.url}: ${test.data.error}`}
        </p>
      )}
      {test.isError && <p className="text-sm text-crit">Test failed: {errorText(test.error)}</p>}
      {save.isError && <p className="text-sm text-crit">Could not save: {errorText(save.error)}</p>}
      {save.isSuccess && !save.isPending && (
        <p className="text-sm text-muted">
          Saved. {d.status.state === "connected" ? "The backend reconnected to the new broker." : "The backend keeps retrying — see status above."}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn-ghost" onClick={() => test.mutate()} disabled={test.isPending || save.isPending}>
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          {test.isPending ? "Testing…" : "Test connection"}
        </button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {save.isPending ? "Reconnecting…" : "Save & reconnect"}
        </button>
      </div>
    </form>
  );
}
