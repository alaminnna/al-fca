"use strict";

/*
 * ST-FCA Animated Logger — full specification implementation.
 *
 * New animated API (primary):
 *   logger.info / success / warn / error / debug / e2ee / net  -> (msg)
 *   logger.recv(user, body) / logger.sent(user, body)
 *   logger.spinner(text) -> { update, succeed, fail, warn }
 *   logger.divider(title?) / logger.banner(name, subtitle?)
 *   logger.gradient / logger.raw
 *
 * Backward compat (96 existing call sites + test/logger.test.js):
 *   logger.info(prefix, msg, ...args) etc. still emit the legacy
 *   `[AL-FCA] [HH:MM:SS] [LEVEL] [prefix] message` line on stderr,
 *   with level filtering, silent, setLevel/getLevel/level, log(),
 *   http/network/event/verbose/silly, maxRecordSize, pause/resume.
 *   Single-arg calls use the new animated `[time] ICON  message` format.
 */

var util = require("util");

var chalk = null;
try { chalk = require("chalk"); } catch (_) { chalk = null; }

var gradient = null;
try { gradient = require("gradient-string"); } catch (_) { gradient = null; }

var boxen = null;
try { boxen = require("boxen"); } catch (_) { boxen = null; }

var cfonts = null;
try { cfonts = require("cfonts"); } catch (_) { cfonts = null; }

// ---------------------------------------------------------------- globals
function liveWidth() {
  return (process.stdout && process.stdout.columns) || 80;
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function timestamp() {
  var d = new Date();
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function dim(s) {
  return chalk ? chalk.dim(s) : s;
}
function gray(s) {
  return chalk ? chalk.gray(s) : s;
}
function boldWhite(s) {
  return chalk ? chalk.bold.white(s) : s;
}
function whiteBright(s) {
  return chalk && chalk.whiteBright ? chalk.whiteBright(s) : s;
}

function sleep(ms) {
  return new Promise(function (res) { setTimeout(res, ms); });
}

// ------------------------------------------------------- level filtering
var RANK = {
  error: 0,
  warn: 1,
  success: 2,
  info: 3,
  http: 3,
  network: 3,
  net: 3,
  event: 3,
  e2ee: 3,
  verbose: 5,
  debug: 5,
  silly: 6
};

var ALIASES = { net: "network" };

function resolveLevel(name) {
  if (name == null) return "info";
  var n = String(name).toLowerCase();
  if (ALIASES[n]) n = ALIASES[n];
  if (n === "silent") return "silent";
  return RANK[n] !== undefined ? n : "info";
}

var currentLevel = resolveLevel(process.env.AL_FCA_LOG_LEVEL || "info");

function allowed(level) {
  if (currentLevel === "silent") return false;
  var canon = ALIASES[level] || level;
  var cur = RANK[currentLevel] !== undefined ? RANK[currentLevel] : RANK.info;
  var got = RANK[canon] !== undefined ? RANK[canon] : RANK.info;
  return got <= cur;
}

// ------------------------------------------------------- spinner infra
var FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var activeSpinners = [];
var cursorHidden = false;
var raw = console.log.bind(console);

function hideCursor() {
  if (cursorHidden) return;
  cursorHidden = true;
  try { process.stdout.write("\x1b[?25l"); } catch (_) {}
}

function showCursor() {
  if (!cursorHidden) return;
  cursorHidden = false;
  try { process.stdout.write("\x1b[?25h"); } catch (_) {}
}

function spinnerClear() {
  try {
    if (process.stdout.clearLine && process.stdout.cursorTo) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    } else {
      process.stdout.write("\r");
    }
  } catch (_) {}
}

function spinnerRender(sp) {
  var frame = FRAMES[sp.frameIdx % FRAMES.length];
  var f = chalk ? chalk.cyan(frame) : frame;
  var t = chalk ? chalk.cyan(sp.text) : sp.text;
  try {
    if (process.stdout.clearLine && process.stdout.cursorTo) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(f + "  " + t);
    } else {
      process.stdout.write("\r" + frame + "  " + sp.text);
    }
  } catch (_) {}
}

function stopAllSpinnerLines() {
  for (var i = 0; i < activeSpinners.length; i++) {
    try { if (activeSpinners[i].timer) clearInterval(activeSpinners[i].timer); } catch (_) {}
    activeSpinners[i].timer = null;
    spinnerClear();
  }
}

function resumeAllSpinnerLines() {
  for (var i = 0; i < activeSpinners.length; i++) {
    if (!activeSpinners[i].done) resumeSpinner(activeSpinners[i]);
  }
}

function resumeSpinner(sp) {
  spinnerRender(sp);
  if (!sp.timer && !sp.done) {
    sp.timer = setInterval(function () {
      sp.frameIdx++;
      spinnerRender(sp);
    }, 80);
    if (sp.timer && sp.timer.unref) sp.timer.unref();
  }
}

// Every log prints at column 0 on a fresh line; spinner never shares a line.
function printStderrLine(line) {
  var alive = activeSpinners.length > 0;
  if (alive) stopAllSpinnerLines();
  try { process.stderr.write(line + "\n"); } catch (_) {}
  if (alive) resumeAllSpinnerLines();
}

// Wrap console.log so direct console.log calls also dodge the spinner.
try {
  console.log = function () {
    var line = util.format.apply(null, arguments);
    printStderrLine(line);
  };
} catch (_) {}

function elapsedStr(start) {
  var s = (Date.now() - start) / 1000;
  return "(" + s.toFixed(1) + "s)";
}

function finishSpinner(sp, kind, msg) {
  if (sp.done) return;
  sp.done = true;
  try { if (sp.timer) clearInterval(sp.timer); } catch (_) {}
  sp.timer = null;
  spinnerClear();
  var idx = activeSpinners.indexOf(sp);
  if (idx >= 0) activeSpinners.splice(idx, 1);
  var text = (msg == null || msg === "") ? sp.text : String(msg);
  var el = gray("· " + elapsedStr(sp.start));
  var stamp = gray("[" + timestamp() + "]");
  var out;
  if (kind === "succeed") {
    var ok = chalk ? chalk.green.bold("✔") : "✔";
    out = stamp + " " + ok + "  " + whiteBright(text) + " " + el;
  } else if (kind === "fail") {
    var bad = chalk ? chalk.red.bold("✖") : "✖";
    out = stamp + " " + bad + "  " + (chalk ? chalk.red(text) : text) + " " + el;
  } else {
    var wr = chalk ? chalk.yellow.bold("▲") : "▲";
    out = stamp + " " + wr + "  " + (chalk ? chalk.yellow(text) : text) + " " + el;
  }
  printStderrLine(out);
  if (activeSpinners.length === 0) showCursor();
}

function makeSpinner(text) {
  var sp = {
    text: String(text == null ? "" : text),
    start: Date.now(),
    frameIdx: 0,
    timer: null,
    done: false,
    update: function (t) {
      sp.text = String(t);
      spinnerRender(sp);
    },
    succeed: function (m) { finishSpinner(sp, "succeed", m); },
    fail: function (m) { finishSpinner(sp, "fail", m); },
    warn: function (m) { finishSpinner(sp, "warn", m); }
  };
  activeSpinners.push(sp);
  hideCursor();
  spinnerRender(sp);
  sp.timer = setInterval(function () {
    sp.frameIdx++;
    spinnerRender(sp);
  }, 80);
  if (sp.timer && sp.timer.unref) sp.timer.unref();
  return sp;
}

// ------------------------------------------------------- new-format lines
function iconFor(level) {
  switch (level) {
    case "info": return chalk ? chalk.hex("#4FC3F7")("ℹ") : "ℹ";
    case "success": return chalk ? chalk.green("✔") : "✔";
    case "warn": return chalk ? chalk.yellow("▲") : "▲";
    case "error": return chalk ? chalk.red("✖") : "✖";
    case "debug": return chalk ? chalk.magenta("»") : "»";
    case "e2ee": return "🔒";
    case "net":
    case "network": return chalk ? chalk.hex("#FFA726")("◉") : "◉";
    default: return chalk ? chalk.cyan("ℹ") : "ℹ";
  }
}

function newStyleLine(level, msg) {
  var stamp = gray("[" + timestamp() + "]");
  var icon = iconFor(level);
  var body;
  if (level === "info") body = whiteBright(String(msg));
  else if (level === "success") body = whiteBright(String(msg));
  else if (level === "warn") body = chalk ? chalk.yellow(String(msg)) : String(msg);
  else if (level === "error") body = chalk ? chalk.red(String(msg)) : String(msg);
  else if (level === "debug") body = chalk ? chalk.dim(String(msg)) : String(msg);
  else if (level === "e2ee") body = chalk ? chalk.cyan(String(msg)) : String(msg);
  else body = String(msg);
  return stamp + " " + icon + "  " + body;
}

// Legacy line for old-style (prefix) calls — keeps tests + 96 call sites green.
function legacyColorize(level, text) {
  if (!chalk) return text;
  switch (level) {
    case "error": return chalk.red(text);
    case "warn": return chalk.yellow(text);
    case "success": return chalk.green(text);
    case "http":
    case "network": return chalk.magenta(text);
    case "info": return chalk.cyan(text);
    case "event": return chalk.blue(text);
    case "e2ee": return chalk.cyan(text);
    case "verbose":
    case "debug":
    case "silly": return chalk.gray(text);
    default: return text;
  }
}

function legacyLine(level, prefix, args) {
  var message = util.format.apply(null, args);
  var label = String(level || "info").toUpperCase();
  while (label.length < 7) label += " ";
  return "[AL-FCA] [" + timestamp() + "] [" + legacyColorize(level, label) + "]" +
    (prefix ? " [" + prefix + "]" : "") + (message ? " " + message : "");
}

function emitLevel(level, argsArray) {
  var canon = ALIASES[level] || level;
  if (!allowed(canon)) return;
  if (argsArray.length >= 2) {
    var prefix = argsArray[0] == null ? "" : String(argsArray[0]);
    var rest = argsArray.slice(1);
    printStderrLine(legacyLine(canon, prefix, rest));
  } else if (argsArray.length === 1) {
    var m = argsArray[0];
    var msg = (typeof m === "string") ? m : util.format(m);
    printStderrLine(newStyleLine(level === "net" ? "net" : canon, msg));
  } else {
    printStderrLine(newStyleLine(level === "net" ? "net" : canon, ""));
  }
}

function makeLevelFn(level) {
  return function () {
    emitLevel(level, Array.prototype.slice.call(arguments));
  };
}

// ------------------------------------------------------- recv / sent
function logRecv(user, body) {
  if (!allowed("info")) return;
  var stamp = gray("[" + timestamp() + "]");
  var icon = chalk ? chalk.magenta("◄") : "◄";
  var u = chalk ? chalk.bold.magenta(String(user)) : String(user);
  var sep = gray(" » ");
  var b = whiteBright(String(body == null ? "" : body));
  printStderrLine(stamp + " " + icon + "  " + u + sep + b);
}

function logSent(user, body) {
  if (!allowed("info")) return;
  var stamp = gray("[" + timestamp() + "]");
  var icon = chalk ? chalk.green("►") : "►";
  var u = chalk ? chalk.bold.green(String(user)) : String(user);
  var sep = gray(" « ");
  var b = chalk ? chalk.green(String(body == null ? "" : body)) : String(body == null ? "" : body);
  printStderrLine(stamp + " " + icon + "  " + u + sep + b);
}

// ------------------------------------------------------- divider
function divider(title) {
  var W = liveWidth();
  var width = clamp(W - 6, 10, 52);
  if (title == null || String(title) === "") {
    printStderrLine(dim("─".repeat(width)));
    return;
  }
  var t = String(title);
  var tLen = stripAnsi(t).length;
  var dashTotal = width - tLen - 2;
  if (dashTotal < 2) {
    printStderrLine(" " + boldWhite(t) + " ");
    return;
  }
  var left = Math.floor(dashTotal / 2);
  var right = dashTotal - left;
  printStderrLine(dim("─".repeat(left)) + " " + boldWhite(t) + " " + dim("─".repeat(right)));
}

// ------------------------------------------------------- banner
var FONTS = ["block", "chrome", "simple3d", "simple", "tiny", "mini"];

function tryRender(name, font) {
  try {
    var out = cfonts.render(name, {
      font: font,
      align: "left",
      colors: ["cyan", "magenta"],
      gradient: ["#00C6FF", "#7B2FBE", "#FF00C6"],
      transitionGradient: true,
      background: "transparent",
      letterSpacing: 1,
      lineHeight: 1,
      space: true,
      maxLength: 0,
      independentGradient: false
    });
    return out && out.string ? out.string : null;
  } catch (_) {
    return null;
  }
}

function artFits(art, W) {
  var lines = String(art).split("\n");
  var max = 0;
  for (var i = 0; i < lines.length; i++) {
    var w = stripAnsi(lines[i]).replace(/\s+$/, "").length;
    if (w > max) max = w;
  }
  return { fits: max <= W - 2, width: max };
}

async function banner(name, subtitle) {
  var W = liveWidth();
  try { process.stdout.write("\n"); } catch (_) {}
  var label = String(name == null || name === "" ? "ST-FCA" : name);
  var picked = null;
  var pickedWidth = 0;

  if (cfonts) {
    for (var i = 0; i < FONTS.length; i++) {
      var art = tryRender(label, FONTS[i]);
      if (!art) continue;
      var r = artFits(art, W);
      if (r.fits) { picked = art; pickedWidth = r.width; break; }
    }
  }

  if (!picked) {
    var plain = label.slice(0, Math.max(1, W - 2));
    var padded = " ".repeat(Math.max(0, Math.floor((W - stripAnsi(plain).length) / 2))) + plain;
    try {
      process.stdout.write((chalk ? chalk.bold.hex("#FF00C6")(padded) : padded) + "\n");
    } catch (_) {}
  } else {
    var lines = String(picked).split("\n");
    for (var l = 0; l < lines.length; l++) {
      var clean = lines[l].replace(/\s+$/, "");
      if (clean === "") continue;
      var lineW = stripAnsi(clean).length;
      var p = " ".repeat(Math.max(0, Math.floor((W - Math.min(lineW, pickedWidth || lineW)) / 2)));
      try { process.stdout.write(p + clean + "\n"); } catch (_) {}
      await sleep(60);
    }
    try { process.stdout.write("\n"); } catch (_) {}
  }

  if (subtitle != null && String(subtitle) !== "") {
    var W2 = liveWidth();
    var sub = String(subtitle);
    var gradSub = (gradient && gradient.pastel) ? gradient.pastel(sub) : sub;
    var boxW = clamp(stripAnsi(sub).length + 8, 12, W2 - 2);
    if (boxen) {
      try {
        var box = boxen(gradSub, {
          padding: 0,
          margin: 0,
          borderStyle: "round",
          borderColor: "cyan",
          textAlignment: "center",
          width: boxW
        });
        var blines = String(box).split("\n");
        for (var b = 0; b < blines.length; b++) {
          var bw = stripAnsi(blines[b]).length;
          var bp = " ".repeat(Math.max(0, Math.floor((W2 - bw) / 2)));
          try { process.stdout.write(bp + blines[b] + "\n"); } catch (_) {}
        }
      } catch (_) {
        var fb = " ".repeat(Math.max(0, Math.floor((W2 - stripAnsi(sub).length) / 2))) + sub;
        try { process.stdout.write(fb + "\n"); } catch (_) {}
      }
    } else {
      var line2 = " ".repeat(Math.max(0, Math.floor((W2 - stripAnsi(sub).length) / 2))) + gradSub;
      try { process.stdout.write(line2 + "\n"); } catch (_) {}
    }
  }
  try { process.stdout.write("\n"); } catch (_) {}
}

// ------------------------------------------------------- exit sequence
var exitHooked = false;
function shutdown() {
  stopAllSpinnerLines();
  showCursor();
}
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  try {
    process.on("exit", function () { shutdown(); });
    process.on("SIGINT", function () {
      shutdown();
      try { process.stderr.write(dim("◦ session closed") + "\n"); } catch (_) {}
      try { process.exit(130); } catch (_) {}
    });
  } catch (_) {}
}
hookExit();

// ------------------------------------------------------- exports
var log = {
  info: makeLevelFn("info"),
  success: makeLevelFn("success"),
  warn: makeLevelFn("warn"),
  error: makeLevelFn("error"),
  debug: makeLevelFn("debug"),
  e2ee: makeLevelFn("e2ee"),
  net: makeLevelFn("net"),
  network: makeLevelFn("net"),
  http: makeLevelFn("http"),
  event: makeLevelFn("event"),
  verbose: makeLevelFn("verbose"),
  silly: makeLevelFn("silly"),
  recv: logRecv,
  sent: logSent,
  spinner: makeSpinner,
  divider: divider,
  banner: banner,
  gradient: gradient,
  raw: raw,
  log: function (level) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (args.length >= 1) {
      var prefix = String(args[0]);
      var rest = args.slice(1);
      var canon = ALIASES[level] || level;
      if (!allowed(canon)) return;
      printStderrLine(legacyLine(canon, prefix, rest));
    }
  },
  setLevel: function (name) { currentLevel = resolveLevel(name); },
  getLevel: function () { return currentLevel; },
  maxRecordSize: 100,
  pause: function () {},
  resume: function () {}
};

Object.defineProperty(log, "level", {
  get: function () { return currentLevel; },
  set: function (name) { currentLevel = resolveLevel(name); },
  enumerable: true,
  configurable: true
});

module.exports = log;
