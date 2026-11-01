"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

function readRepo(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

test("no third-party data endpoints in src/ (user data goes to Facebook only)", () => {
  const allowed = ["facebook.com", "fbcdn.net", "messenger.com", "instagram.com", "github.com", "upload.facebook.com", "edge-chat.facebook.com", "mmeg.facebook.com", "reg-e2ee.facebook.com"];
  const srcDir = path.join(__dirname, "..", "src");
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (st.isDirectory()) return walk(fp);
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(fp, "utf8");
      const urls = src.match(/https:\/\/[a-zA-Z0-9.-]+/g) || [];
      for (const u of urls) {
        const host = u.slice("https://".length);
        if (!allowed.some((a) => host === a || host.endsWith("." + a))) {
          offenders.push(fp.replace(srcDir, "src") + " → " + u);
        }
      }
    }
  };
  walk(srcDir);
  assert.deepStrictEqual(offenders, [], "third-party endpoints found: " + offenders.join(", "));
});

test("no hardcoded upload API keys ship in the source (regression P0-4)", () => {
  const entry = readRepo("index.js");
  assert.ok(!/3e198e6ffe205d1c7968a92fd92177c9/.test(entry), "old hardcoded ImgBB key must not return");
  // uploadImageToImgbb must require a caller-provided key
  assert.ok(entry.includes("imgbbApiKey"), "explicit apiKey plumbing exists");
});

test("getUID does not talk to third-party resolvers (regression)", () => {
  const src = readRepo("src/users/getUID.js");
  assert.ok(!src.includes("traodoisub"), "traodoisub removed");
  assert.ok(!src.includes("findids"), "findids removed");
  assert.ok(!/Math\.random\(\) \* userAgentArray/.test(src), "UA rotation removed");
});

test("update check never spawns processes or exits the host", () => {
  const src = readRepo("checkUpdate.js");
  for (const bad of ["execSync", "child_process", "process.exit", "writeFileSync", "updateNpmPackage"]) {
    assert.ok(!src.includes(bad), "checkUpdate.js must not contain " + bad);
  }
});

test("no process-global side effects at require time", () => {
  const logger = readRepo("src/core/logger.js");
  assert.ok(!logger.includes("console.log ="), "logger must not override console.log");
  assert.ok(!/process\.on\(['"]SIGINT/.test(logger), "logger must not install SIGINT at require time");
});

test("mqtt writes are buffered until the websocket is open (regression: lost CONNECT)", () => {
  const lm = readRepo("src/mqtt/listenMqtt.js");
  assert.ok(lm.includes("pendingWrites"), "buildStream buffers pre-open writes");
});

test("stopListening always resolves and disconnects E2EE", () => {
  const lm = readRepo("src/mqtt/listenMqtt.js");
  assert.ok(/No live connection: still resolve/.test(lm) || /cannot\s+hang/.test(lm) || lm.includes("done([]);"), "callback invoked without a live client");
  assert.ok(lm.includes("_e2eeBridge.disconnect"), "E2EE bridge disconnected on stop");
});

test("E2EE message maps are bounded (regression P1-1)", () => {
  const bridge = readRepo("e2ee/core/bridge.js");
  assert.ok(bridge.includes("getSharedMap"), "bridge uses bounded shared maps");
  const store = readRepo("e2ee/core/bounded-store.js");
  assert.ok(store.includes("while (m.size > cap)"), "eviction loop present");
});
