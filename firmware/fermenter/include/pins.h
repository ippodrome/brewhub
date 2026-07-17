#pragma once

// Fermenter board (BrewPi ESP D32-style) pin map, Phase 1 scope.
// No relay pins yet — no actuators are wired until Phase 2 (§10 Phase 1
// item 5 explicitly scopes this board to "reports temperature and accepts
// a setpoint", no heating/cooling output).
constexpr uint8_t ONE_WIRE_PIN = 4;
