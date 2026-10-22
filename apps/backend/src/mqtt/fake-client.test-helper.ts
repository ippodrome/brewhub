import { EventEmitter } from "node:events";
import type { MqttClient } from "mqtt";

/** Minimal stand-in for an mqtt.js client: an EventEmitter with publish/subscribe/end spies. */
export class FakeMqttClient extends EventEmitter {
  published: Array<{ topic: string; message: string }> = [];
  ended = false;
  constructor(public readonly url: string, public readonly opts: Record<string, unknown> = {}) {
    super();
  }
  publish(topic: string, message: string): this {
    this.published.push({ topic, message });
    return this;
  }
  subscribe(): this {
    return this;
  }
  end(_force?: boolean, _o?: unknown, cb?: () => void): this {
    this.ended = true;
    cb?.();
    return this;
  }
  asClient(): MqttClient {
    return this as unknown as MqttClient;
  }
}
