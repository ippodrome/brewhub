#pragma once
#include <cstdint>
#include <WiFiClient.h>
#include <PubSubClient.h>

namespace unibrew {

// Wraps PubSubClient with: robust reconnect (exponential backoff, per §6/§7),
// a retained LWT so the backend's presence tracking works even on ungraceful
// power loss, and dispatch of incoming retained config messages. This class
// only ever subscribes to the device's own config topic and publishes
// telemetry/status — it has no concept of a "command" topic, matching
// ADR-004's backend-side contract.
class MqttClientWrapper {
public:
    using ConfigCallback = void (*)(const uint8_t* payload, unsigned int length);

    // firmwareVersion is embedded in the LWT payload so an ungraceful
    // disconnect still reports a "last known" version alongside online=false.
    void begin(const char* host, uint16_t port, const char* username, const char* password,
               const char* deviceId, const char* firmwareVersion);
    void setConfigCallback(ConfigCallback callback);

    // Call every loop() iteration. Internally no-ops most of the time; only
    // attempts reconnection once the current backoff interval has elapsed.
    void loop();
    bool connected();

    void publishTelemetry(const char* json);
    void publishStatus(const char* json);

private:
    WiFiClient wifiClient_;
    PubSubClient mqtt_{wifiClient_};

    String deviceId_;
    String statusTopic_;
    String telemetryTopic_;
    String configTopic_;
    String username_;
    String password_;
    String offlineLwtPayload_;

    ConfigCallback configCallback_ = nullptr;
    uint32_t lastReconnectAttemptMs_ = 0;
    uint32_t reconnectBackoffMs_ = 1000;
    static constexpr uint32_t kMaxReconnectBackoffMs = 30000;

    void attemptReconnect();
    void handleMessage(char* topic, uint8_t* payload, unsigned int length);

    // PubSubClient's callback is a plain function pointer with no user-data
    // slot, so we bridge to the instance via a static trampoline. Fine given
    // exactly one MqttClientWrapper exists per device.
    static void staticMessageCallback(char* topic, uint8_t* payload, unsigned int length);
    static MqttClientWrapper* activeInstance_;
};

} // namespace unibrew
