"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ensureCurrentDevice, defaultPaths } = require("../e2ee/device-migrate");
const { resolveDevicePath } = require("../e2ee/fme/fme-client");

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "al-fca-mig-"));
}

test("default device path uses .al-fca-e2ee", () => {
  assert.ok(resolveDevicePath({}).endsWith(path.join(".al-fca-e2ee", "device.json")));
});

test("migrates legacy device preserving bytes and mode, legacy untouched", () => {
  const dir = sandbox();
  const { current, legacy } = defaultPaths(dir);
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  const payload = JSON.stringify({ seed: "synthetic-test-value" });
  fs.writeFileSync(legacy, payload, { mode: 0o600 });
  const res = ensureCurrentDevice(current, { cwd: dir, log: null });
  assert.strictEqual(res.migrated, true);
  assert.strictEqual(res.path, path.resolve(current));
  assert.strictEqual(fs.readFileSync(current, "utf8"), payload);
  assert.strictEqual(fs.readFileSync(legacy, "utf8"), payload);
  if (process.platform !== "win32") {
    assert.strictEqual(fs.statSync(current).mode & 0o777, 0o600);
  } else {
    assert.ok(fs.existsSync(current));
  }
});

test("never overwrites an existing current device", () => {
  const dir = sandbox();
  const { current, legacy } = defaultPaths(dir);
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ v: "legacy" }));
  fs.writeFileSync(current, JSON.stringify({ v: "current" }));
  const res = ensureCurrentDevice(current, { cwd: dir, log: null });
  assert.strictEqual(res.migrated, false);
  assert.strictEqual(res.reason, "already-exists");
  assert.strictEqual(JSON.parse(fs.readFileSync(current, "utf8")).v, "current");
});

test("skips cleanly when no legacy device exists", () => {
  const dir = sandbox();
  const { current } = defaultPaths(dir);
  const res = ensureCurrentDevice(current, { cwd: dir, log: null });
  assert.strictEqual(res.migrated, false);
  assert.strictEqual(res.reason, "no-legacy-device");
  assert.strictEqual(fs.existsSync(current), false);
});

test("corrupt legacy rolls back and falls back to legacy path", () => {
  const dir = sandbox();
  const { current, legacy } = defaultPaths(dir);
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, "not-json{{{");
  const res = ensureCurrentDevice(current, { cwd: dir, log: null });
  assert.strictEqual(res.migrated, false);
  assert.strictEqual(res.path, legacy);
  assert.strictEqual(fs.existsSync(current), false);
  assert.strictEqual(fs.readFileSync(legacy, "utf8"), "not-json{{{");
});
