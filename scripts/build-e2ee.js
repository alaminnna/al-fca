"use strict";

/*
 * Maintainer script: rebuilds the vendored E2EE bundle from the
 * FB-Messenger-E2EE/ source checkout and refreshes e2ee/vendor/fbme/.
 *
 * The FB-Messenger-E2EE/ folder is a development-only reference. Runtime code
 * never reads it; the built bundle lives in e2ee/vendor/fbme/{dist,proto}.
 */

var path = require("path");
var fs = require("fs");
var { execSync } = require("child_process");

var ROOT = path.join(__dirname, "..");
var SRC = path.join(ROOT, "FB-Messenger-E2EE");
var VENDOR = path.join(ROOT, "e2ee", "vendor", "fbme");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copy(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  if (!fs.existsSync(path.join(SRC, "package.json"))) {
    console.error("FB-Messenger-E2EE/ source folder not found at:\n  " + SRC);
    console.error("Clone https://github.com/HerokeyVN/FB-Messenger-E2EE into that path to rebuild.");
    process.exit(1);
  }

  console.log("[1/3] Installing deps inside FB-Messenger-E2EE/ ...");
  execSync("npm install --no-audit --no-fund", { cwd: SRC, stdio: "inherit" });

  console.log("[2/3] Building (tsup) ...");
  execSync("npx tsup", { cwd: SRC, stdio: "inherit" });

  console.log("[3/3] Refreshing e2ee/vendor/fbme/ ...");
  rmrf(path.join(VENDOR, "dist"));
  rmrf(path.join(VENDOR, "proto"));
  copy(path.join(SRC, "dist"), path.join(VENDOR, "dist"));
  copy(path.join(SRC, "proto"), path.join(VENDOR, "proto"));

  require(path.join(VENDOR, "dist", "index.cjs"));
  console.log("OK — vendored bundle rebuilt and verified.");
}

try {
  main();
} catch (err) {
  console.error("build:e2ee failed:", err && err.message ? err.message : err);
  process.exit(1);
}
