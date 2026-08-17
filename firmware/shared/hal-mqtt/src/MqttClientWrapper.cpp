#include "MqttClientWrapper.h"
#include <ArduinoJson.h>

namespace unibrew {

MqttClientWrapper* MqttClientWrapper::activeInstance_ = nullptr;

void MqttClientWrapper::begin(const char* host, uint16_t port, const char* username,
                               const char* password, const char* deviceId,
                               const char* firmwareVersion, const char* board) {
    deviceId_ = deviceId;
    username_ = username;
    password_ = password;
    statusTopic_ = String("unibrew/") + deviceId_ + "/status";
    telemetryTopic_ = String("unibrew/") + deviceId_ + "/telemetry";
    configTopic_ = String("unibrew/") + deviceId_ + "/config";
    otaTopic_ = String("unibrew/") + deviceId_ + "/ota";
    discoveryTopic_ = String("unibrew/") + deviceId_ + "/discovery";
    gravityTopic_ = String("unibrew/") + deviceId_ + "/gravity";
    stateTopic_ = String("unibrew/") + deviceId_ + "/state";
    decisionTopic_ = String("unibrew/") + deviceId_ + "/decision";

    JsonDocument lwtDoc;
    lwtDoc["deviceId"] = deviceId_;
    lwtDoc["online"] = false;
    lwtDoc["firmwareVersion"] = firmwareVersion;
    lwtDoc["uptimeS"] = 0;
    lwtDoc["ts"] = 0;
    serializeJson(lwtDoc, offlineLwtPayload_);

    JsonDocument discoveryDoc;
    discoveryDoc["deviceId"] = deviceId_;
    discoveryDoc["board"] = board;
    discoveryDoc["firmwareVersion"] = firmwareVersion;
    serializeJson(discoveryDoc, discoveryPayload_);

    activeInstance_ = this;
    mqtt_.setServer(host, port);
    mqtt_.setCallback(staticMessageCallback);
    mqtt_.setBufferSize(512);
}

void MqttClientWrapper::setConfigCallback(ConfigCallback callback) {
    configCallback_ = callback;
}

void MqttClientWrapper::setOtaCallback(OtaCallback callback) {
    otaCallback_ = callback;
}

bool MqttClientWrapper::connected() {
    return mqtt_.connected();
}

void MqttClientWrapper::loop() {
    if (!mqtt_.connected()) {
        uint32_t now = millis();
        if (now - lastReconnectAttemptMs_ >= reconnectBackoffMs_) {
            lastReconnectAttemptMs_ = now;
            attemptReconnect();
        }
        return;
    }
    mqtt_.loop();
}

void MqttClientWrapper::attemptReconnect() {
    bool ok = mqtt_.connect(
        deviceId_.c_str(),
        username_.c_str(),
        password_.c_str(),
        statusTopic_.c_str(), // willTopic
        1,                    // willQos
        true,                 // willRetain
        offlineLwtPayload_.c_str());

    if (ok) {
        mqtt_.subscribe(configTopic_.c_str(), 1);
        mqtt_.subscribe(otaTopic_.c_str(), 1);
        mqtt_.publish(discoveryTopic_.c_str(), discoveryPayload_.c_str(), true); // retained
        reconnectBackoffMs_ = 1000; // reset backoff on success
    } else {
        reconnectBackoffMs_ = min(reconnectBackoffMs_ * 2, kMaxReconnectBackoffMs);
    }
}

void MqttClientWrapper::publishTelemetry(const char* json) {
    mqtt_.publish(telemetryTopic_.c_str(), json, false);
}

void MqttClientWrapper::publishStatus(const char* json) {
    mqtt_.publish(statusTopic_.c_str(), json, true);
}

void MqttClientWrapper::publishGravity(const char* json) {
    mqtt_.publish(gravityTopic_.c_str(), json, false);
}

void MqttClientWrapper::publishControlState(const char* json) {
    mqtt_.publish(stateTopic_.c_str(), json, true);
}

bool MqttClientWrapper::publishDecision(const char* json) {
    return mqtt_.publish(decisionTopic_.c_str(), json, false);
}

void MqttClientWrapper::handleMessage(char* topic, uint8_t* payload, unsigned int length) {
    if (configTopic_.equals(topic) && configCallback_ != nullptr) {
        configCallback_(payload, length);
    } else if (otaTopic_.equals(topic) && otaCallback_ != nullptr) {
        otaCallback_(payload, length);
    }
}

void MqttClientWrapper::staticMessageCallback(char* topic, uint8_t* payload, unsigned int length) {
    if (activeInstance_ != nullptr) {
        activeInstance_->handleMessage(topic, payload, length);
    }
}

} // namespace unibrew
