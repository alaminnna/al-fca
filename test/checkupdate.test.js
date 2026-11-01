"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

test("checkUpdate module has no process-killing or install side effects", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "checkUpdate.js"), "utf8");
  // Regression P0-1: the module used to execSync npm install and process.exit(2)
  assert.ok(!src.includes("execSync"), "must not exec npm");
  assert.ok(!src.includes("child_process"), "must not spawn child processes");
  assert.ok(!src.includes("process.exit"), "must not exit the host app");
  assert.ok(!src.includes("writeFileSync"), "must not mutate package.json");
  assert.ok(!src.includes("updateNpmPackage"), "auto-install helper must be gone");
});

test("checkUpdate targets this package, not a lookalike (regression P0-3)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "checkUpdate.js"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.strictEqual(pkg.name, "al-fca");
  assert.ok(src.includes(`PKG_NAME = "${pkg.name}"`), "queries its own published package, not a lookalike");
});

test("compareVersions orders semver triples", () => {
  const { compareVersions } = require("../checkUpdate");
  assert.ok(compareVersions("2.0.2", "2.0.1") > 0);
  assert.ok(compareVersions("2.0.1", "2.0.1") === 0);
  assert.ok(compareVersions("1.9.9", "2.0.0") < 0);
  assert.ok(compareVersions("10.0.0", "9.0.0") > 0, "numeric, not lexicographic");
});

test("getCurrentVersion reads the local package version", () => {
  const { getCurrentVersion } = require("../checkUpdate");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.strictEqual(getCurrentVersion(), pkg.version);
});

test("checkForFCAUpdate survives an unreachable registry without throwing", async () => {
  // Deterministic: stub axios so the result never depends on sandbox network.
  const axios = require("axios");
  const { checkForFCAUpdate } = require("../checkUpdate");
  const realGet = axios.get;
  axios.get = async () => { throw new Error("simulated offline"); };
  try {
    const result = await checkForFCAUpdate({ force: true });
    assert.strictEqual(result.checked, false);
    assert.strictEqual(result.updateAvailable, false);
  } finally {
    axios.get = realGet;
  }
});

test("checkForFCAUpdate compares registry version against local (P0-3 end-to-end)", async () => {
  const axios = require("axios");
  const { checkForFCAUpdate } = require("../checkUpdate");
  const realGet = axios.get;
  let queriedUrl = "";
  axios.get = async (url) => { queriedUrl = url; return { data: { version: "99.0.0" } }; };
  try {
    const result = await checkForFCAUpdate({ force: true });
    assert.strictEqual(result.checked, true);
    assert.strictEqual(result.latest, "99.0.0");
    assert.strictEqual(result.updateAvailable, true);
    assert.ok(queriedUrl.startsWith("https://registry.npmjs.org/al-fca/"), "queries the real published package URL");
  } finally {
    axios.get = realGet;
  }
});

test("library entry loads offline and exports the documented surface", () => {
  const login = require("../index.js");
  assert.strictEqual(typeof login, "function");
  assert.strictEqual(typeof login.buildAPI, "function");
  assert.strictEqual(typeof login.setOptions, "function");
});

test("no load-time global pollution (regression P1: globals in index.js)", () => {
  delete require.cache[require.resolve("../index.js")];
  require("../index.js");
  assert.ok(!("ditconmemay" in global), "global.ditconmemay removed");
  assert.ok(!("alfcaUpdateChecked" in global), "global.alfcaUpdateChecked removed");
  assert.ok(!("mqttClient" in global), "global.mqttClient not set at load");
});
