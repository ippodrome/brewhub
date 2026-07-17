import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "@brewhub/shared-types";

const clients = new Set<WebSocket>();

export function registerWsClient(socket: WebSocket): void {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
}

export function broadcastToAll(message: WsMessage): void {
  const serialized = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(serialized);
    }
  }
}

export function sendTo(socket: WebSocket, message: WsMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
