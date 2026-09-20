"use strict";

const test = require("node:test");
const assert = require("node:assert");

const log = require("../src/core/logger");

function captureStderr(fn) {
  const orig = process.stderr.write;
  let out = "";
  process.stderr.write = (chunk, enc, cb) => {
    out += chunk.toString();
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return out;
}

// Chalk may or may not emit ANSI codes depending on the terminal;
// strip them so assertions hold in both cases.
function stripAnsi(s) {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

test("logger exposes the npmlog-compatible surface plus AL-FCA levels", () => {
  for (const m of ["error", "warn", "success", "info", "http", "network", "event", "e2ee", "verbose", "debug", "silly", "log", "setLevel", "getLevel"]) {
    assert.strictEqual(typeof log[m], "function", m + " should be a function");
  }
  assert.ok("level" in log, "level accessor should exist");
  assert.ok("maxRecordSize" in log, "maxRecordSize compat field should exist");
});

test("logger emits timestamped AL-FCA lines", () => {
  const prev = log.getLevel();
  log.setLevel("verbose");
  try {
    const out = stripAnsi(captureStderr(() => log.info("myPrefix", "hello", 42)));
    assert.match(out, /\[AL-FCA\] \[\d{2}:\d{2}:\d{2}\] \[INFO {3}\] \[myPrefix\] hello 42/);
  } finally {
    log.setLevel(prev);
  }
});

test("new levels render with padded uppercase labels", () => {
  const prev = log.getLevel();
  log.setLevel("silly");
  try {
    const out = stripAnsi(captureStderr(() => {
      log.success("s", "ok-msg");
      log.event("e", "evt-msg");
      log.e2ee("k", "e2ee-msg");
      log.network("n", "net-msg");
      log.debug("d", "dbg-msg");
    }));
    assert.match(out, /\[SUCCESS\] \[s\] ok-msg/);
    assert.match(out, /\[EVENT {2}\] \[e\] evt-msg/);
    assert.match(out, /\[E2EE {3}\] \[k\] e2ee-msg/);
    assert.match(out, /\[NETWORK\] \[n\] net-msg/);
    assert.match(out, /\[DEBUG {2}\] \[d\] dbg-msg/);
  } finally {
    log.setLevel(prev);
  }
});

test("level filtering suppresses verbose at default info", () => {
  const prev = log.getLevel();
  log.setLevel("info");
  try {
    const out = captureStderr(() => {
      log.verbose("p", "hidden-msg");
      log.debug("p", "hidden-dbg");
      log.error("p", "shown-msg");
      log.success("p", "shown-success");
      log.network("p", "shown-net");
      log.event("p", "shown-evt");
      log.e2ee("p", "shown-e2ee");
    });
    assert.ok(!out.includes("hidden-msg"), "verbose must be suppressed at info level");
    assert.ok(!out.includes("hidden-dbg"), "debug must be suppressed at info level");
    assert.ok(out.includes("shown-msg"), "error must be shown at info level");
    assert.ok(out.includes("shown-success"), "success must be shown at info level");
    assert.ok(out.includes("shown-net"), "network must be shown at info level");
    assert.ok(out.includes("shown-evt"), "event must be shown at info level");
    assert.ok(out.includes("shown-e2ee"), "e2ee must be shown at info level");
  } finally {
    log.setLevel(prev);
  }
});

test("silent level suppresses everything, bad input falls back to info", () => {
  const prev = log.getLevel();
  try {
    log.setLevel("silent");
    assert.strictEqual(captureStderr(() => log.error("p", "x")), "");
    log.setLevel("not-a-level");
    assert.strictEqual(log.getLevel(), "info");
  } finally {
    log.setLevel(prev);
  }
});
