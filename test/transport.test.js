"use strict";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const zlib = require("zlib");
const client = require("../src/transport/http-client");

let server;
let base;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/gzip") {
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip" });
      res.end(zlib.gzipSync("hello gzip world"));
    } else if (url.pathname === "/redir") {
      res.writeHead(302, { Location: "/target" });
      res.end();
    } else if (url.pathname === "/setcookie") {
      res.writeHead(200, { "Set-Cookie": "testck=abc123; Path=/; Domain=127.0.0.1" });
      res.end("cookie set");
    } else if (url.pathname === "/echo") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          method: req.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          cookie: req.headers.cookie || "",
          contentType: req.headers["content-type"] || "",
          body: body.slice(0, 500),
        }));
      });
    } else if (url.pathname === "/upload") {
      let body = [];
      req.on("data", (c) => body.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(body).toString();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          contentType: req.headers["content-type"] || "",
          hasStreamMarker: raw.includes("STREAMFILECONTENT123"),
        }));
      });
    } else {
      res.writeHead(200);
      res.end("body:" + req.method + ":" + url.pathname);
    }
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  base = "http://127.0.0.1:" + server.address().port;
});

test.after(() => {
  if (server) {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  }
});

test("gzip responses are decoded to strings", async () => {
  const r = await client.request({ url: base + "/gzip", headers: { "Accept-Encoding": "gzip, deflate" } });
  assert.strictEqual(r.body, "hello gzip world");
  assert.strictEqual(typeof r.body, "string");
});

test("GET follows redirects; response carries the request shim", async () => {
  const r = await client.request({ url: base + "/redir" });
  assert.strictEqual(r.body, "body:GET:/target");
  assert.ok(r.request.uri.protocol && r.request.uri.hostname && r.request.uri.pathname);
  assert.strictEqual(r.request.method, "GET");
});

test("POST does NOT follow redirects (login flow reads headers.location)", async () => {
  const r = await client.request({ url: base + "/redir", method: "POST", form: { a: "1" } });
  assert.strictEqual(r.statusCode, 302);
  assert.strictEqual(r.headers.location, "/target");
});

test("urlencoded form body and object qs", async () => {
  const r = await client.request({ url: base + "/echo", method: "POST", form: { email: "a@b.c" } });
  const parsed = JSON.parse(r.body);
  assert.ok(parsed.body.includes("email=a%40b.c"));

  const r2 = await client.request({ url: base + "/echo", qs: { q: "s", obj: { a: 1 } } });
  const p2 = JSON.parse(r2.body);
  assert.strictEqual(p2.query.q, "s");
  assert.strictEqual(p2.query.obj, '{"a":1}');
});

test("cookie jar round-trip: send, persist set-cookie, re-send", async () => {
  const jar = client.jar();
  jar.setCookie("sid=zzz; Path=/; Domain=127.0.0.1", base + "/");
  let r = await client.request({ url: base + "/echo", jar });
  assert.ok(JSON.parse(r.body).cookie.includes("sid=zzz"));

  await client.request({ url: base + "/setcookie", jar });
  const cookies = jar.getCookies(base + "/");
  assert.ok(cookies.some((c) => c.key === "testck"));
  r = await client.request({ url: base + "/echo", jar });
  assert.ok(JSON.parse(r.body).cookie.includes("testck=abc123"));
});

test("multipart formData uploads stream content", async () => {
  const { Readable } = require("stream");
  const stream = Readable.from([Buffer.from("STREAMFILECONTENT123")]);
  const r = await client.request({
    url: base + "/upload",
    method: "POST",
    formData: {
      farr: { value: stream, options: { filename: "x.txt", contentType: "text/plain" } },
      extra: "1",
    },
  });
  const parsed = JSON.parse(r.body);
  assert.ok(parsed.contentType.startsWith("multipart/form-data"));
  assert.ok(parsed.hasStreamMarker);
});

test("timeout surfaces an error", async () => {
  const slow = http.createServer(() => { });
  await new Promise((res) => slow.listen(0, "127.0.0.1", res));
  try {
    await assert.rejects(
      () => client.request({ url: "http://127.0.0.1:" + slow.address().port + "/x", timeout: 200 }),
      /timed out/
    );
  } finally {
    slow.close();
  }
});

test("utils.getJar / utils.get / utils.post run through the same transport", async () => {
  const utils = require("../utils");
  const jar = utils.getJar();
  const r = await utils.get(base + "/echo", jar, { a: "b" }, {});
  assert.strictEqual(r.statusCode, 200);
  assert.ok(JSON.parse(r.body).query.a === "b");
  const r2 = await utils.post(base + "/echo", jar, { k: "v" }, {});
  assert.strictEqual(r2.statusCode, 200);
  assert.ok(JSON.parse(r2.body).body.includes("k=v"));
});
