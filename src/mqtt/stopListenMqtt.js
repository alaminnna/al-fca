"use strict";

// @NethWs3Dev
//
// Standalone stop helper. Delegates to the MessageEmitter's stopListening so
// there is exactly one implementation of connection teardown.

module.exports = function (defaultFuncs, api, ctx) {
  return function stopListenMqtt(callback) {
    if (typeof api.stopListening === "function") {
      return api.stopListening(callback);
    }
    const err = new Error("Not connected to MQTT — no active listener (call api.listenMqtt() first)");
    if (typeof callback === "function") return callback(err);
    return Promise.reject(err);
  };
};
