"use strict";

const test = require("node:test");
const assert = require("node:assert");

const e2ee = require("../e2ee");

test("isE2EEChatJid detects legacy colon JIDs", () => {
  assert.strictEqual(e2ee.isE2EEChatJid("61568577897207:69@msgr"), true);
});

test("isE2EEChatJid detects dot JIDs", () => {
  assert.strictEqual(e2ee.isE2EEChatJid("61568577897207.0@msgr"), true);
});

test("isE2EEChatJid detects group JIDs", () => {
  assert.strictEqual(e2ee.isE2EEChatJid("123456-987654@g.us"), true);
  // E2EE detection is "@"-based by design: every encrypted chat JID
  // carries a server suffix. Bare IDs always go through normal Messenger.
  assert.strictEqual(e2ee.isE2EEChatJid("1234.g.us"), false);
});

test("isE2EEChatJid rejects plain thread IDs", () => {
  assert.strictEqual(e2ee.isE2EEChatJid("61568577897207"), false);
  assert.strictEqual(e2ee.isE2EEChatJid(""), false);
  assert.strictEqual(e2ee.isE2EEChatJid(undefined), false);
  assert.strictEqual(e2ee.isE2EEChatJid(12345), false);
});

test("module exports match the retired e2ee.js public surface", () => {
  const keys = Object.keys(e2ee).sort();
  assert.deepStrictEqual(keys, ["createBridge", "isE2EEChatJid", "patchApiForE2EE", "storeMedia"]);
});

test("createBridge exposes the same method surface as the native bridge", () => {
  const ctx = { globalOptions: { enableE2EE: true } };
  const bridge = e2ee.createBridge(ctx);
  const methods = Object.keys(bridge).sort();
  assert.deepStrictEqual(methods, [
    "connect", "disconnect", "downloadMedia", "editMessage", "getDeviceData",
    "getState", "isConnected", "isFullyReady", "sendMedia", "sendMessage",
    "sendReaction", "sendTyping", "unsendMessage"
  ]);
  assert.strictEqual(bridge.isConnected(), false);
  assert.strictEqual(bridge.isFullyReady(), false);
});

test("createBridge is a per-ctx singleton", () => {
  const ctx = { globalOptions: { enableE2EE: true } };
  assert.strictEqual(e2ee.createBridge(ctx), e2ee.createBridge(ctx));
});

test("connect throws when E2EE is explicitly disabled", async () => {
  const ctx = { globalOptions: { enableE2EE: false } };
  const bridge = e2ee.createBridge(ctx);
  await assert.rejects(() => bridge.connect(), /E2EE is disabled/);
});

test("connect rejects when no authenticated api is available", async () => {
  const ctx = { globalOptions: { enableE2EE: true } };
  const bridge = e2ee.createBridge(ctx);
  await assert.rejects(() => bridge.connect(), /authenticated api is not available/);
});

test("patchApiForE2EE adds the documented api helpers", () => {
  const ctx = { globalOptions: { enableE2EE: true } };
  const api = {};
  e2ee.patchApiForE2EE(api, ctx);
  assert.strictEqual(typeof api.downloadE2EEMedia, "function");
  assert.strictEqual(typeof api.resolveE2EEAttachment, "function");
  assert.strictEqual(typeof api.sendTypingE2EE, "function");
  assert.strictEqual(typeof ctx._e2eeApiSource, "function");
});

test("sendTypingE2EE no-ops for non-E2EE threads", async () => {
  const ctx = { globalOptions: { enableE2EE: true } };
  const api = {};
  e2ee.patchApiForE2EE(api, ctx);
  const result = await api.sendTypingE2EE("61568577897207");
  assert.strictEqual(result, undefined);
});

test("typed E2EE errors are exposed with stable names/codes", () => {
  const { E2EEInitializationError, E2EEMediaError } = require("../e2ee/errors");
  const initErr = new E2EEInitializationError("no bundle");
  assert.strictEqual(initErr.name, "E2EEInitializationError");
  assert.strictEqual(initErr.code, "E2EE_INITIALIZATION");
  const mediaErr = new E2EEMediaError("bad key");
  assert.strictEqual(mediaErr.code, "E2EE_MEDIA");
  assert.ok(mediaErr instanceof Error);
});

test("bridge.sendTyping strips DM JIDs to numeric threads", async () => {
  const calls = [];
  const ctx = { globalOptions: { enableE2EE: true } };
  const api = {
    sendTypingIndicator: (isTyping, threadID) => {
      calls.push([isTyping, threadID]);
      return Promise.resolve("ok");
    }
  };
  require("../e2ee").patchApiForE2EE(api, ctx);
  const bridge = require("../e2ee").createBridge(ctx);
  const result = await bridge.sendTyping("61578789046935.0@msgr", true);
  assert.strictEqual(result, "ok");
  assert.deepStrictEqual(calls, [[true, "61578789046935"]]);
});

test("bridge.sendTyping passes group JIDs through untouched", async () => {
  const calls = [];
  const ctx = { globalOptions: { enableE2EE: true } };
  const api = {
    sendTypingIndicator: (isTyping, threadID) => {
      calls.push([isTyping, threadID]);
      return Promise.resolve("ok");
    }
  };
  require("../e2ee").patchApiForE2EE(api, ctx);
  const bridge = require("../e2ee").createBridge(ctx);
  await bridge.sendTyping("123456-789@g.us", false);
  assert.deepStrictEqual(calls, [[false, "123456-789@g.us"]]);
});

test("markAsRead strips E2EE DM JIDs to numeric threads", async () => {
  const published = [];
  const fakeMqtt = {
    publish: (topic, payload, opts, cb) => {
      published.push([topic, JSON.parse(payload)]);
      cb(null);
    }
  };
  const markAsRead = require("../src/markAsRead.js")({}, {}, { mqttClient: fakeMqtt, globalOptions: {} });
  await markAsRead("61578789046935.0@msgr");
  assert.strictEqual(published.length, 1);
  assert.strictEqual(published[0][0], "/mark_thread");
  assert.strictEqual(published[0][1].threadID, "61578789046935");
  assert.strictEqual(published[0][1].mark, "read");
});
