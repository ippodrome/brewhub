import { useContext } from "react";
import { WsContext, type WsState } from "./WsProvider";

export function useLiveTelemetry(): WsState {
  return useContext(WsContext);
}
