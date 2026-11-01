"use strict";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { getSharedMap, createBoundedMap } = require("../e2ee/core/bounded-store");
const mediaServer = require("../e2ee/core/media-server");
const e2ee = require("../e2ee");

// ── Bounded store (regression P1-1: unbounded global maps) ──────────────────

test("bounded map evicts oldest entries beyond the cap", () => {
  const m = createBoundedMap(3);
  m.set("a", 1); m.set("b", 2); m.set("c", 3);
  assert.strictEqual(m.size, 3);
  m.set("d", 4);
  assert.strictEqual(m.size, 3, "cap enforced");
  assert.strictEqual(m.get("a"), undefined, "oldest evicted");
  assert.strictEqual(m.get("d"), 4);
  m.set("b", 9); // refresh recency
  m.set("e", 5);
  assert.strictEqual(m.get("b"), 9, "recently-set entries survive");
  assert.strictEqual(m.get("c"), undefined);
});

test("getSharedMap installs one bounded instance per name", () => {
  const a = getSharedMap("__test_map_x", 10);
  const b = getSharedMap("__test_map_x", 10);
  assert.strictEqual(a, b);
  a.set("k", "v");
  assert.strictEqual(global.__test_map_x.get("k"), "v");
  delete global.__test_map_x;
});

test("E2EE global message maps are bounded, not raw Maps", () => {
  // bridge.js installs these at require time
  require("../e2ee/core/bridge.js");
  assert.ok(typeof global._e2eeMessageMap.size === "number");
  for (let i = 0; i < 6000; i++) global._e2eeMessageMap.set("m" + i, "jid");
  assert.ok(global._e2eeMessageMap.size <= 5000, "global._e2eeMessageMap is capped, size=" + global._e2eeMessageMap.size);
});

// ── Media server (regression P1-7: no shutdown, no cache cap) ───────────────

test("media server serves stored media and closes cleanly", async () => {
  const buf = Buffer.from("PNGDATA1234567890");
  const url = await mediaServer.storeMedia(buf, "image/png");
  assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/e2ee\//.test(url), url);

  const body = await new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
  assert.deepStrictEqual(body, buf);

  const state = mediaServer.mediaServerState();
  assert.strictEqual(state.running, true);
  assert.strictEqual(state.entries, 1);

  await mediaServer.closeMediaServer();
  const after = mediaServer.mediaServerState();
  assert.strictEqual(after.running, false);
  assert.strictEqual(after.entries, 0);
  // Idempotent
  await mediaServer.closeMediaServer();
});

test("media server respects the total-bytes cap", async () => {
  const big = Buffer.alloc(64 * 1024, 7);
  await mediaServer.storeMedia(big, "application/octet-stream", { maxCacheBytes: 100 * 1024 });
  await mediaServer.storeMedia(big, "application/octet-stream", { maxCacheBytes: 100 * 1024 });
  const state = mediaServer.mediaServerState();
  assert.ok(state.bytes <= 100 * 1024, "bytes capped: " + state.bytes);
  await mediaServer.closeMediaServer();
});

// ── JID detection & event mappers ───────────────────────────────────────────

test("isE2EEChatJid only accepts JID-style thread IDs", () => {
  assert.strictEqual(e2ee.isE2EEChatJid("61568577897207.0@msgr"), true);
  assert.strictEqual(e2ee.isE2EEChatJid("abc@g.us"), true);
  assert.strictEqual(e2ee.isE2EEChatJid("100023456789012"), false);
  assert.strictEqual(e2ee.isE2EEChatJid(""), false);
  assert.strictEqual(e2ee.isE2EEChatJid(null), false);
});

test("event mappers produce the documented legacy shapes", () => {
  const { _mappers } = require("../e2ee/core/bridge.js");
  const msg = _mappers.mapMsg({
    id: "mid.123",
    senderId: "61568577897207:69@msgr",
    chatJid: "100023456789012.0@msgr",
    text: "hello world",
    timestampMs: 1700000000000,
    attachments: [{ type: "image", url: "https://x/y.jpg", fileName: "y.jpg" }],
    mentions: [{ userId: "2000", offset: 0, length: 5 }],
  });
  assert.strictEqual(msg.type, "e2ee_message");
  assert.strictEqual(msg.senderID, "61568577897207");
  assert.strictEqual(msg.threadID, "100023456789012.0@msgr");
  assert.strictEqual(msg.body, "hello world");
  assert.strictEqual(msg.isE2EE, true);
  assert.strictEqual(msg.attachments[0].type, "photo", "image → photo normalized");
  assert.strictEqual(msg.mentions["2000"], "hello");

  const react = _mappers.mapReaction({ chatJid: "g@g.us", messageId: "m1", reaction: "👍", senderId: "2000", isGroup: true });
  assert.strictEqual(react.type, "e2ee_message_reaction");
  assert.strictEqual(react.isGroup, true, "isGroup taken from the event");

  const edit = _mappers.mapEdit({ messageId: "m1", text: "edited", chatJid: "x@msgr" });
  assert.strictEqual(edit.type, "e2ee_message_edit");
});

test("patchApiForE2EE attaches the documented helpers", () => {
  const bridge = require("../e2ee/core/bridge.js");
  const api = {};
  const ctx = { globalOptions: { enableE2EE: true } };
  bridge.patchApiForE2EE(api, ctx);
  assert.strictEqual(typeof api.downloadE2EEMedia, "function");
  assert.strictEqual(typeof api.resolveE2EEAttachment, "function");
  assert.strictEqual(typeof api.sendTypingE2EE, "function");
  assert.strictEqual(typeof ctx._e2eeApiSource, "function");
});
