"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { Transform } = require("stream");
const listenMqttModule = require("../src/mqtt/listenMqtt");
const { createMqttPatchStream, parseDelta, sanitizeHeaderValue } = listenMqttModule._test;

// ── MQTT frame patch stream ─────────────────────────────────────────────────

function collect(stream) {
  return new Promise((resolve) => {
    const out = [];
    stream.on("data", (c) => out.push(c));
    stream.on("end", () => resolve(Buffer.concat(out)));
  });
}

test("patch stream clears reserved flag bits on FB's non-standard ACKs", async () => {
  const s = createMqttPatchStream();
  // PUBACK (type 4) with illegal flags 0x0F → expect 0x40; then msg ID + length
  const frame = Buffer.from([0x4F, 0x00, 0x02, 0x12, 0x34]);
  s.write(frame);
  s.end();
  const out = await collect(s);
  assert.strictEqual(out[0], 0x40, "PUBACK flags cleared");
  assert.strictEqual(out[1], 0x00);
});

test("patch stream leaves standard packets untouched", async () => {
  const s = createMqttPatchStream();
  // PUBLISH (type 3, flags 0) + length + payload
  const frame = Buffer.from([0x30, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  s.write(frame);
  s.end();
  const out = await collect(s);
  assert.deepStrictEqual(out, frame);
});

test("patch stream handles frames split across chunks", async () => {
  const s = createMqttPatchStream();
  // Header first (incomplete length), body next
  s.write(Buffer.from([0x40, 0x00]));
  s.end(Buffer.from([0x40])); // extra byte: another flags-cleared ack start
  const out = await collect(s);
  assert.strictEqual(out[0], 0x40);
});

test("sanitizeHeaderValue strips control chars and brackets", () => {
  assert.strictEqual(sanitizeHeaderValue("a=b; c=d"), "a=b; c=d");
  assert.strictEqual(sanitizeHeaderValue("bad\nvalue\r"), "badvalue");
  assert.strictEqual(sanitizeHeaderValue("[1,2,3]"), "");
  assert.strictEqual(sanitizeHeaderValue(null), "");
});

// ── parseDelta crash guards (regression P1-10: malformed deltas crashed) ────

function makeStubs() {
  const events = [];
  const ctx = {
    userID: "1000",
    jar: {},
    threadTypes: {},
    loggedIn: true,
    globalOptions: { selfListen: false, listenEvents: true, pageID: undefined, autoMarkDelivery: false },
  };
  const api = { resolvePhotoUrl: (id, cb) => cb(new Error("offline")), _imgUpload: undefined };
  const globalCallback = (err, msg) => events.push({ err, msg });
  return { events, ctx, api, globalCallback };
}

function clientPayloadDelta(delta) {
  // decodeClientPayload expects a byte array of UTF-8 JSON
  return { delta: { class: "ClientPayload", payload: Array.from(Buffer.from(JSON.stringify(delta), "utf8")) } };
}

test("malformed prng in message_reply does not crash (regression)", () => {
  const { events, ctx, api, globalCallback } = makeStubs();
  const v = clientPayloadDelta({
    deltas: [{
      deltaMessageReply: {
        message: {
          body: "re body",
          data: { prng: "NOT_JSON{{{" },
          messageMetadata: { messageId: "m1", actorFbId: "2000", threadKey: { otherUserFbId: "3000" } },
          attachments: [],
        },
      },
    }],
  });
  assert.doesNotThrow(() => parseDelta({}, api, ctx, globalCallback, v));
  const reply = events.find((e) => e.msg && e.msg.type === "message_reply");
  assert.ok(reply, "reply still emitted");
  assert.deepStrictEqual(reply.msg.mentions, {});
});

test("malformed mercuryJSON in reply attachments does not crash (regression)", () => {
  const { events, ctx, api, globalCallback } = makeStubs();
  const v = clientPayloadDelta({
    deltas: [{
      deltaMessageReply: {
        message: {
          body: "b",
          messageMetadata: { messageId: "m1", actorFbId: "2000", threadKey: { threadFbId: "3000" } },
          attachments: [{ mercuryJSON: "{{{bad", attach_type: "photo" }],
        },
      },
    }],
  });
  assert.doesNotThrow(() => parseDelta({}, api, ctx, globalCallback, v));
  const reply = events.find((e) => e.msg && e.msg.type === "message_reply");
  assert.ok(reply, "reply emitted");
  assert.strictEqual(reply.msg.attachments[0].type, "unknown");
  assert.ok(reply.msg.attachments[0].error);
});

test("missing cid / threadKey does not crash (regression)", () => {
  const { events, ctx, api, globalCallback } = makeStubs();
  const v = clientPayloadDelta({
    deltas: [{
      deltaMessageReply: {
        message: {
          body: "b",
          messageMetadata: { messageId: "m1", actorFbId: "2000" /* no threadKey, no cid */ },
          attachments: [],
        },
      },
    }],
  });
  assert.doesNotThrow(() => parseDelta({}, api, ctx, globalCallback, v));
});

test("unparseable ClientPayload emits parse_error instead of crashing", () => {
  const { events, ctx, api, globalCallback } = makeStubs();
  const v = { delta: { class: "ClientPayload", payload: [0xff, 0xfe, 0x00] } };
  assert.doesNotThrow(() => parseDelta({}, api, ctx, globalCallback, v));
  assert.ok(events.some((e) => e.err && e.err.type === "parse_error"));
});

test("malformed NewMessage metadata emits parse_error instead of crashing", () => {
  const { events, ctx, api, globalCallback } = makeStubs();
  const v = { delta: { class: "NewMessage", body: "x", attachments: [], messageMetadata: { /* no threadKey */ } } };
  assert.doesNotThrow(() => parseDelta({}, api, ctx, globalCallback, v));
  assert.ok(events.some((e) => e.err && e.err.type === "parse_error"));
});

test("photo attachment errors do not block the message event", () => {
  const { events, ctx, api, globalCallback } = makeStubs();
  ctx.globalOptions.selfListen = false; // allow the message to be delivered
  const v = {
    delta: {
      class: "NewMessage",
      body: "with photo",
      attachments: [{ mercury: { attach_type: "photo", metadata: { fbid: "111", dimensions: "1,1" } }, fbid: "1" }],
      messageMetadata: {
        messageId: "m9",
        actorFbId: "2000",
        timestamp: "1700000000000",
        threadKey: { otherUserFbId: "3000" },
      },
    },
  };
  assert.doesNotThrow(() => parseDelta({}, api, ctx, globalCallback, v));
  const msg = events.find((e) => e.msg && e.msg.type === "message");
  assert.ok(msg, "message emitted despite resolvePhotoUrl failing");
  assert.strictEqual(msg.msg.body, "with photo");
});
