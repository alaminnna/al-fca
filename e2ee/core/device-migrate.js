"use strict";

var fs = require("fs");
var path = require("path");

var LEGACY_DIRNAME = ".stfca-e2ee";
var CURRENT_DIRNAME = ".al-fca-e2ee";
var DEVICE_FILENAME = "device.json";

function defaultPaths(cwd) {
  var base = cwd || process.cwd();
  return {
    current: path.join(base, CURRENT_DIRNAME, DEVICE_FILENAME),
    legacy: path.join(base, LEGACY_DIRNAME, DEVICE_FILENAME)
  };
}

function readModeOrDefault(p) {
  try {
    return fs.statSync(p).mode & 0o777;
  } catch (_) {
    return 0o600;
  }
}

function verifyLoadable(p) {
  var parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("migrated device file is not a JSON object");
  }
  return true;
}

function ensureCurrentDevice(currentPath, opts) {
  opts = opts || {};
  var log = opts.log || null;
  function note(level, msg) {
    if (log && typeof log[level] === "function") {
      try { log[level]("e2ee", msg); } catch (_) {}
    }
  }

  var current = path.resolve(currentPath);
  var legacyPath = path.join(opts.cwd || process.cwd(), LEGACY_DIRNAME, DEVICE_FILENAME);

  if (fs.existsSync(current)) {
    return { path: current, migrated: false, reason: "already-exists" };
  }
  if (!fs.existsSync(legacyPath)) {
    return { path: current, migrated: false, reason: "no-legacy-device" };
  }

  var tmpPath = current + ".migrate-" + process.pid + ".tmp";
  try {
    var mode = readModeOrDefault(legacyPath);
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.writeFileSync(tmpPath, fs.readFileSync(legacyPath), { mode: mode });
    fs.renameSync(tmpPath, current);
    try { fs.chmodSync(current, mode); } catch (_) {}
    verifyLoadable(current);
    note("info", "E2EE device migrated: " + LEGACY_DIRNAME + "/" + DEVICE_FILENAME +
      " -> " + CURRENT_DIRNAME + "/" + DEVICE_FILENAME + " (original preserved, load verified)");
    return { path: current, migrated: true, reason: "migrated" };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    try {
      var usable = false;
      try { verifyLoadable(current); usable = true; } catch (_) { usable = false; }
      if (fs.existsSync(current) && !usable) fs.unlinkSync(current);
    } catch (_) {}
    note("warn", "E2EE device migration failed, continuing with legacy path: " +
      (err && err.message ? err.message : String(err)));
    return { path: legacyPath, migrated: false, reason: "failed-rollback-to-legacy", error: err };
  }
}

module.exports = {
  ensureCurrentDevice: ensureCurrentDevice,
  defaultPaths: defaultPaths,
  CURRENT_DIRNAME: CURRENT_DIRNAME,
  LEGACY_DIRNAME: LEGACY_DIRNAME,
  DEVICE_FILENAME: DEVICE_FILENAME
};
