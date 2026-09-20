"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { mapFmeEvent } = require("../e2ee/fme/events");
const { decodeReceivedAttachment } = require("../e2ee/fme/media-decode");
const { _mappers } = require("../e2ee/core/bridge");

// ── Minimal protobuf wire encoder (proto2 wire format) ──────────────────────
function varint(n) {
  const out = [];
  let v = n;
  do { let b = v & 0x7f; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}
function tag(field, wireType) { return varint((field << 3) | wireType); }
function bytesField(field, buf) { return Buffer.concat([tag(field, 2), varint(buf.length), buf]); }
function varintField(field, n) { return Buffer.concat([tag(field, 0), varint(n)]); }
function strField(field, s) { return bytesField(field, Buffer.from(s, "utf8")); }

function buildImageTransportPayload() {
  const sha256 = Buffer.alloc(32, 0xaa);
  const mediaKey = Buffer.alloc(32, 0xbb);
  const encSha256 = Buffer.alloc(32, 0xcc);
  const directPath = "/v/t62.36572-24/test?oe=test";

  const integral = Buffer.concat([
    bytesField(1, sha256),
    bytesField(2, mediaKey),
    bytesField(3, encSha256),
    strField(4, directPath),
    varintField(5, 1720000000)
  ]);
  const ancillary = Buffer.concat([
    varintField(1, 4096),          // fileLength
    strField(2, "image/jpeg")      // mimetype
  ]);
  const transport = Buffer.concat([bytesField(1, integral), bytesField(2, ancillary)]);

  // ImageTransport { integral.transport, ancillary { height=1, width=2 } }
  return Buffer.concat([
    bytesField(1, bytesField(1, transport)),
    bytesField(2, Buffer.concat([varintField(1, 600), varintField(2, 800)]))
  ]);
}

test("media-decode extracts WAMediaTransport metadata from received images", () => {
  const decoded = decodeReceivedAttachment("image", {
    image: { payload: buildImageTransportPayload(), version: 1 }
  });
  assert.ok(decoded, "attachment should decode");
  const att = decoded.attachment;
  assert.strictEqual(att.type, "image");
  assert.strictEqual(att.mimeType, "image/jpeg");
  assert.strictEqual(att.fileSize, "4096");
  assert.strictEqual(att.width, 800);
  assert.strictEqual(att.height, 600);
  assert.strictEqual(att.directPath, "/v/t62.36572-24/test?oe=test");
  assert.strictEqual(Buffer.from(att.mediaKey, "base64").toString("hex"), "bb".repeat(32));
  assert.strictEqual(Buffer.from(att.mediaSha256, "base64").toString("hex"), "aa".repeat(32));
  assert.strictEqual(Buffer.from(att.mediaEncSha256, "base64").toString("hex"), "cc".repeat(32));
  assert.strictEqual(decoded.caption, "");
  assert.deepStrictEqual(decoded.mentions, []);
});

test("media-decode surfaces image captions and mentions", () => {
  const decoded = decodeReceivedAttachment("image", {
    image: { payload: buildImageTransportPayload(), version: 1 },
    caption: {
      text: "hi @bob",
      mentions: [{ mentionedJID: "1234567890.0@msgr", offset: 3, length: 4 }]
    }
  });
  assert.strictEqual(decoded.caption, "hi @bob");
  assert.deepStrictEqual(decoded.mentions, [{ userId: "1234567890", offset: 3, length: 4 }]);
});

test("media-decode returns null for garbage payloads", () => {
  assert.strictEqual(decodeReceivedAttachment("image", { image: { payload: Buffer.from([0xff, 0xff, 0xff]) } }), null);
  assert.strictEqual(decodeReceivedAttachment("image", null), null);
  assert.strictEqual(decodeReceivedAttachment("image", { image: { payload: Buffer.alloc(0) } }), null);
  assert.strictEqual(decodeReceivedAttachment("bogus", {}), null);
});

function textEvent() {
  return {
    type: "e2ee_message",
    data: {
      id: "m1",
      threadId: "61568577897207",
      chatJid: "61568577897207.0@msgr",
      senderJid: "61568577897207.69@msgr",
      senderId: "61568577897207",
      kind: "text",
      text: "hello",
      timestampMs: 1720000000000
    }
  };
}

test("FME text event maps to the legacy e2ee_message shape", () => {
  const out = mapFmeEvent(textEvent());
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, "message");
  const msg = _mappers.mapMsg(out[0].ev);
  assert.strictEqual(msg.type, "e2ee_message");
  assert.strictEqual(msg.senderID, "61568577897207");
  assert.strictEqual(msg.threadID, "61568577897207.0@msgr");
  assert.strictEqual(msg.body, "hello");
  assert.strictEqual(msg.messageID, "m1");
  assert.strictEqual(msg.isE2EE, true);
  assert.strictEqual(msg.isGroup, false);
  assert.deepStrictEqual(msg.args, ["hello"]);
  assert.deepStrictEqual(msg.attachments, []);
  assert.strictEqual(msg.e2ee.chatJid, "61568577897207.0@msgr");
  assert.strictEqual(msg.e2ee.senderJid, "61568577897207.69@msgr");
});

test("FME media event maps to e2ee_message with decoded attachments", () => {
  const out = mapFmeEvent({
    type: "e2ee_message",
    data: {
      id: "m2",
      chatJid: "61568577897207.0@msgr",
      senderJid: "61568577897207.69@msgr",
      kind: "image",
      text: "",
      timestampMs: 1720000000000,
      media: { image: { payload: buildImageTransportPayload(), version: 1 } }
    }
  });
  assert.strictEqual(out[0].kind, "message");
  const msg = _mappers.mapMsg(out[0].ev);
  assert.strictEqual(msg.attachments.length, 1);
  const att = msg.attachments[0];
  assert.strictEqual(att.type, "photo");           // legacy normalization
  assert.strictEqual(att.mimeType, "image/jpeg");
  assert.strictEqual(att.mediaKey, Buffer.alloc(32, 0xbb).toString("base64"));
  assert.strictEqual(att.directPath, "/v/t62.36572-24/test?oe=test");
  assert.ok(att.isE2EE);
});

test("FME media event without decodable payload still emits (flagged)", () => {
  const out = mapFmeEvent({
    type: "e2ee_message",
    data: { id: "m3", chatJid: "1.0@msgr", senderJid: "1.0@msgr", kind: "image", text: "", media: {} }
  });
  assert.strictEqual(out[0].kind, "message");
  assert.strictEqual(out[0].ev.mediaUndecodable, true);
});

test("FME reaction event maps to legacy e2ee_message_reaction", () => {
  const out = mapFmeEvent({
    type: "e2ee_message",
    data: {
      id: "m9", chatJid: "61568577897207.0@msgr", senderJid: "61568577897207.69@msgr",
      kind: "reaction", reaction: "❤️", targetId: "m0", timestampMs: 1720000000000
    }
  });
  assert.strictEqual(out[0].kind, "reaction");
  const ev = _mappers.mapReaction(out[0].ev);
  assert.strictEqual(ev.type, "e2ee_message_reaction");
  assert.strictEqual(ev.messageID, "m0");
  assert.strictEqual(ev.reaction, "❤️");
  assert.strictEqual(ev.threadID, "61568577897207.0@msgr");
  assert.strictEqual(ev.isE2EE, true);
});

test("FME edit event maps to legacy e2ee_message_edit", () => {
  const out = mapFmeEvent({
    type: "e2ee_message",
    data: {
      id: "m9", chatJid: "61568577897207.0@msgr", senderJid: "61568577897207.69@msgr",
      kind: "edit", text: "new text", targetId: "m0", timestampMs: 1720000000000
    }
  });
  assert.strictEqual(out[0].kind, "edit");
  const ev = _mappers.mapEdit(out[0].ev);
  assert.strictEqual(ev.type, "e2ee_message_edit");
  assert.strictEqual(ev.messageID, "m0");
  assert.strictEqual(ev.body, "new text");
  assert.strictEqual(ev.isE2EE, true);
});

test("FME revoke event produces the additive e2ee_message_revoke shape", () => {
  const out = mapFmeEvent({
    type: "e2ee_message",
    data: {
      id: "m9", chatJid: "61568577897207.0@msgr", senderJid: "61568577897207.69@msgr",
      kind: "revoke", targetId: "m0", fromMe: false, timestampMs: 1720000000000
    }
  });
  assert.strictEqual(out[0].kind, "revoke");
  assert.strictEqual(out[0].ev.messageId, "m0");
  assert.strictEqual(out[0].ev.fromMe, false);
});

test("FME receipt event maps to legacy e2ee_receipt", () => {
  const out = mapFmeEvent({
    type: "e2ee_receipt",
    data: { type: "delivery", chat: "61568577897207.0@msgr", sender: "61568577897207.69@msgr", messageIds: ["a", "b"] }
  });
  assert.strictEqual(out[0].kind, "receipt");
  const ev = _mappers.mapReceipt(out[0].ev);
  assert.strictEqual(ev.type, "e2ee_receipt");
  assert.strictEqual(ev.e2ee.receiptType, "delivery");
  assert.deepStrictEqual(ev.e2ee.messageIds, ["a", "b"]);
});

test("decryption failures surface as errors, never as message events", () => {
  const out = mapFmeEvent({
    type: "e2ee_message",
    data: { type: "decryption_failed", chatJid: "1.0@msgr", error: "No session", messageId: "mX" }
  });
  assert.strictEqual(out[0].kind, "error");
  assert.strictEqual(out[0].decryption, true);
  assert.match(out[0].err.message, /decrypt failed/);
});

test("connected / disconnected / error events are translated", () => {
  assert.strictEqual(mapFmeEvent({ type: "e2ee_connected", data: {} })[0].kind, "connected");
  assert.strictEqual(mapFmeEvent({ type: "disconnected", data: { isE2EE: true } })[0].kind, "disconnected");
  const errOut = mapFmeEvent({ type: "error", data: { message: "ws blew up" } });
  assert.strictEqual(errOut[0].kind, "error");
  assert.strictEqual(errOut[0].err.message, "ws blew up");
});

test("non-E2EE FCA events are ignored by the E2EE mapper", () => {
  assert.deepStrictEqual(mapFmeEvent({ type: "message", data: { body: "plain" } }), []);
  assert.deepStrictEqual(mapFmeEvent({ type: "presence", data: {} }), []);
  assert.deepStrictEqual(mapFmeEvent(null), []);
});
