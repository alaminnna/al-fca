"use strict";

/*
 * Update notification for AL-FCA.
 *
 * IMPORTANT (security): this module only *notifies*. It never installs
 * packages, never runs child processes, never modifies package.json and
 * never exits the consumer's application. Updates are the application
 * owner's decision: run `npm install al-fca@latest` yourself.
 *
 * The check is opt-in: call `checkForFCAUpdate()` explicitly, or pass
 * `autoUpdateCheck: true` in login options to allow a single notify-only
 * check per process. Nothing runs at require() time.
 */

const fs = require("fs");
const path = require("path");

var log;
try { log = require("./src/core/logger"); } catch (_) { log = null; }
function _log(level, prefix, msg) {
    if (log && typeof log[level] === "function") log[level](prefix, msg);
}

const PKG_NAME = "al-fca";
const REGISTRY_URL = "https://registry.npmjs.org/" + encodeURIComponent(PKG_NAME).replace("%40", "@") + "/latest";

let _checkedThisProcess = false;

function getCurrentVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
        if (pkg.version) return pkg.version;
    } catch (_) { }
    return null;
}

function compareVersions(a, b) {
    if (a == null || b == null) return 0;
    var pa = String(a).split(".").map(Number);
    var pb = String(b).split(".").map(Number);
    for (var i = 0; i < 3; i++) {
        var na = pa[i] || 0, nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

/**
 * Notify-only update check. Never has side effects beyond one HTTPS GET
 * to the npm registry.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=5000] network timeout.
 * @returns {Promise<{current: string|null, latest: string|null, updateAvailable: boolean, checked: boolean}>}
 */
async function checkForFCAUpdate(opts) {
    opts = opts || {};
    var current = getCurrentVersion();

    if (_checkedThisProcess && !opts.force) {
        return { current: current, latest: null, updateAvailable: false, checked: false };
    }
    _checkedThisProcess = true;

    let latest = null;
    try {
        // Lazy require so the HTTP client is only loaded when a check actually runs.
        const axios = require("axios");
        const res = await axios.get(REGISTRY_URL, { timeout: opts.timeoutMs || 5000 });
        latest = res.data && res.data.version ? res.data.version : null;
    } catch (error) {
        _log("warn", "update", "Could not check for AL-FCA updates: " + (error && error.message ? error.message : error));
        return { current: current, latest: null, updateAvailable: false, checked: false };
    }

    var updateAvailable = compareVersions(latest, current) > 0;
    if (updateAvailable) {
        _log("info", "update", "AL-FCA " + latest + " is available (installed: " + current + ").");
        _log("info", "update", "To update, run: npm install " + PKG_NAME + "@latest");
    }
    return { current: current, latest: latest, updateAvailable: updateAvailable, checked: true };
}

module.exports = { checkForFCAUpdate, compareVersions, getCurrentVersion };
