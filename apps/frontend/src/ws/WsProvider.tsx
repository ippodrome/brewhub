import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { WsMessageSchema, type Device, type StatusPayload, type TelemetryPayload } from "@brewhub/shared-types";

export interface WsState {
  connected: boolean;
  devices: Device[];
  telemetryByDevice: Record<string, TelemetryPayload>;
  statusByDevice: Record<string, StatusPayload>;
}

export const WsContext = createContext<WsState>({
  connected: false,
  devices: [],
  telemetryByDevice: {},
  statusByDevice: {},
});

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;

export function WsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<WsState>({
    connected: false,
    devices: [],
    telemetryByDevice: {},
    statusByDevice: {},
  });

  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect(): void {
      socket = new WebSocket(wsUrl());

      socket.onopen = () => {
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        setState((prev) => ({ ...prev, connected: true }));
      };

      socket.onclose = () => {
        setState((prev) => ({ ...prev, connected: false }));
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, reconnectDelayRef.current);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onmessage = (event) => {
        let json: unknown;
        try {
          json = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = WsMessageSchema.safeParse(json);
        if (!parsed.success) return;

        const message = parsed.data;
        setState((prev) => {
          if (message.type === "device_list") {
            return { ...prev, devices: message.payload };
          }
          if (message.type === "telemetry") {
            return {
              ...prev,
              telemetryByDevice: { ...prev.telemetryByDevice, [message.payload.deviceId]: message.payload },
            };
          }
          // A status message is also the most current word on isOnline for that
          // device — patch it into the device list, not just statusByDevice,
          // so isOnline reflects live status without waiting for a full snapshot.
          return {
            ...prev,
            statusByDevice: { ...prev.statusByDevice, [message.payload.deviceId]: message.payload },
            devices: prev.devices.map((d) =>
              d.id === message.payload.deviceId ? { ...d, isOnline: message.payload.online } : d,
            ),
          };
        });
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return <WsContext.Provider value={state}>{children}</WsContext.Provider>;
}
