#pragma once
#include <cstdint>
#include <WiFiClient.h>
#include <PubSubClient.h>

namespace unibrew {

// Wraps PubSubClient with: robust reconnect (exponential backoff, per §6/§7),
// a retained LWT so the backend's presence tracking works even on ungraceful
// power loss, and dispatch of incoming config and OTA messages. This class
// only ever subscribes to the device's own config/ota topics and publishes
// telemetry/status — it has no concept of a "command" topic, matching
// ADR-004's backend-side contract. OTA is the one deliberate exception to
// that contract's "retained declarative config only" shape (see
// DECISIONS.md) — it's still just another subscribed topic here, the
// retained-vs-not distinction is entirely a backend-side publish decision.
class MqttClientWrapper {
public:
    using ConfigCallback = void (*)(const uint8_t* payload, unsigned int length);
    using OtaCallback = void (*)(const uint8_t* payload, unsigned int length);

    // firmwareVersion is embedded in the LWT payload so an ungraceful
    // disconnect still reports a "last known" version alongside online=false.
    // board must be one of shared-types' FirmwareBoardSchema values (e.g.
    // "fermenter-brewpi") — used only for the discovery announcement below,
    // published retained on every successful connect so a backend that
    // wasn't running when this device first came online still discovers it
    // (see DECISIONS.md ADR on why discovery is per-device + retained,
    // deviating from claude.md §6's original single shared-topic sketch).
    void begin(const char* host, uint16_t port, const char* username, const char* password,
               const char* deviceId, const char* firmwareVersion, const char* board);
    void setConfigCallback(ConfigCallback callback);
    void setOtaCallback(OtaCallback callback);

    // Call every loop() iteration. Internally no-ops most of the time; only
    // attempts reconnection once the current backoff interval has elapsed.
    void loop();
    bool connected();

    void publishTelemetry(const char* json);
    void publishStatus(const char* json);
    // Gravity readings (Tilt/Rapt Pill/etc, see gravity-bridge board) — not
    // retained, same reasoning as publishTelemetry: a stream of readings,
    // not state to replay on reconnect.
    void publishGravity(const char* json);

    // Current control state — retained, like status. A client that has just
    // connected has to know whether the compressor is running without waiting
    // for the next transition, which may be hours away.
    void publishControlState(const char* json);

    // One control decision. Not retained: this is a log, and a retained log
    // would replay a single stale entry forever. Returns false when the
    // publish did not go out, which is the caller's signal to buffer it.
    bool publishDecision(const char* json);

private:
    WiFiClient wifiClient_;
    PubSubClient mqtt_{wifiClient_};

    String deviceId_;
    String statusTopic_;
    String telemetryTopic_;
    String configTopic_;
    String otaTopic_;
    String discoveryTopic_;
    String gravityTopic_;
    String stateTopic_;
    String decisionTopic_;
    String discoveryPayload_;
    String username_;
    String password_;
    String offlineLwtPayload_;

    ConfigCallback configCallback_ = nullptr;
    OtaCallback otaCallback_ = nullptr;
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
