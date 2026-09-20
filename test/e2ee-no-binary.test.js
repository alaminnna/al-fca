"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("retired native E2EE stack no longer exists in the repo", () => {
  assert.strictEqual(fs.existsSync(path.join(ROOT, "e2ee.js")), false, "old root e2ee.js should be deleted");
  assert.strictEqual(fs.existsSync(path.join(ROOT, "lib")), false, "old lib/ ESM bundle should be deleted");
  assert.strictEqual(fs.existsSync(path.join(ROOT, "build")), false, "old build/ binaries should be deleted");
});

test("loading the E2EE module does not load koffi or any native messagix loader", () => {
  const e2eePath = require.resolve("../e2ee");
  delete require.cache[e2eePath];
  require("../e2ee");

  const loaded = Object.keys(require.cache);
  const nativeLoaders = loaded.filter((p) =>
    /[\\/]koffi[\\/]|[\\/]lib[\\/]index\.mjs|messagix/i.test(p)
  );
  assert.deepStrictEqual(nativeLoaders, [], "koffi/messagix must not be in the require graph");
});

test("the vendored E2EE bundle loads standalone (no FB-Messenger-E2EE source folder needed)", () => {
  const vendorDist = path.join(ROOT, "e2ee", "vendor", "fbme", "dist", "index.cjs");
  assert.strictEqual(fs.existsSync(vendorDist), true, "vendored bundle must ship inside the package");

  const mod = require(vendorDist);
  assert.strictEqual(typeof mod.FBClient, "function");
  const client = new mod.FBClient({ platform: "facebook" });
  assert.strictEqual(typeof client.controller.connectE2EE, "function");
  assert.ok(client.controller.e2eeService);
});
