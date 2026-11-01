"use strict";

const test = require("node:test");
const assert = require("node:assert");
const utils = require("../utils");

test("getType classifies values", () => {
  assert.strictEqual(utils.getType([]), "Array");
  assert.strictEqual(utils.getType({}), "Object");
  assert.strictEqual(utils.getType("x"), "String");
  assert.strictEqual(utils.getType(1), "Number");
  assert.strictEqual(utils.getType(() => {}), "Function");
  assert.strictEqual(utils.getType(async () => {}), "AsyncFunction");
  assert.strictEqual(utils.getType(null), "Null");
});

test("generateOfflineThreadingID returns a numeric string", () => {
  const id = utils.generateOfflineThreadingID();
  assert.strictEqual(typeof id, "string");
  assert.match(id, /^\d+$/);
  assert.notStrictEqual(utils.generateOfflineThreadingID(), id, "should be unique-ish");
});

test("formatID strips fbid: / id: prefixes", () => {
  assert.strictEqual(utils.formatID("fbid:12345"), "12345");
  assert.strictEqual(utils.formatID("id:12345"), "12345");
  assert.strictEqual(utils.formatID("12345"), "12345");
  assert.strictEqual(utils.formatID(undefined), undefined);
});

test("getFrom extracts a delimited value", () => {
  const html = '<input name="fb_dtsg" value="TOKEN123">';
  assert.strictEqual(utils.getFrom(html, 'name="fb_dtsg" value="', '"'), "TOKEN123");
  assert.strictEqual(utils.getFrom(html, "not-present", '"'), "");
});

test("makeParsable strips the for(;;); prefix and joins chunked JSON", () => {
  assert.deepStrictEqual(JSON.parse(utils.makeParsable('for(;;);[{"a":1}]')), [{ a: 1 }]);
  assert.deepStrictEqual(JSON.parse(utils.makeParsable('for(;;);{"ok":true}')), { ok: true });
});

test("arrToForm builds a flat form", () => {
  const form = utils.arrToForm([
    { name: "lsd", val: "tok" },
    { val: "ignored-no-name" },
  ]);
  assert.strictEqual(form.lsd, "tok");
});

test("formatCookie renders a cookie string (arr[3] is the path)", () => {
  const c = utils.formatCookie(["c_user", "100", "true", "/"], "facebook");
  assert.strictEqual(c, "c_user=100; Path=/; Domain=facebook.com");
});

test("CustomError exists and carries structured data (regression: was undefined)", () => {
  assert.strictEqual(typeof utils.CustomError, "function");
  const e = new utils.CustomError({ error: "validation failed", detail: { x: 1 } });
  assert.ok(e instanceof Error);
  assert.strictEqual(e.error, "validation failed");
  assert.strictEqual(e.message, "validation failed");
  assert.deepStrictEqual(e.detail, { x: 1 });
  const e2 = new utils.CustomError("plain message");
  assert.strictEqual(e2.message, "plain message");
});

test("generateOfflineThreadingID survives large timestamps (no 32-bit overflow)", () => {
  // Regression: sendMessageMqtt used Date.now() << 22 (32-bit overflow).
  for (let i = 0; i < 20; i++) {
    const id = utils.generateOfflineThreadingID();
    assert.ok(BigInt(id) > 0n, "otid must stay positive");
  }
});

test("isReadableStream detects streams", () => {
  const { Readable } = require("stream");
  assert.strictEqual(utils.isReadableStream(Readable.from(["x"])), true);
  assert.strictEqual(utils.isReadableStream("nope"), false);
  assert.strictEqual(utils.isReadableStream(Buffer.from("x")), false);
});

test("delay resolves after ms", async () => {
  const start = Date.now();
  await utils.delay(40);
  assert.ok(Date.now() - start >= 35);
});

test("makeDefaults shares one __req counter across requests (regression: 120 counters)", async () => {
  const http = require("http");
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ echo: body }));
    });
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    const ctx = { fb_dtsg: undefined, ttstamp: undefined, globalOptions: {} };
    const html = '<html><input name="fb_dtsg" value="DTSGTOKEN"></html>';
    const d1 = utils.makeDefaults(html, "1000", ctx);
    const r1 = await d1.post(base + "/a", null, {});
    const r2 = await d1.post(base + "/b", null, {});
    const body1 = JSON.parse(r1.body).echo;
    const body2 = JSON.parse(r2.body).echo;
    const req1 = new URLSearchParams(body1).get("__req");
    const req2 = new URLSearchParams(body2).get("__req");
    assert.strictEqual(req1, "1");
    assert.strictEqual(req2, "2", "__req increments per request");
    assert.strictEqual(new URLSearchParams(body1).get("fb_dtsg"), "DTSGTOKEN");
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  }
});
