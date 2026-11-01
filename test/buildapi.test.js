"use strict";

const test = require("node:test");
const assert = require("node:assert");
const utils = require("../utils");

function makeFakeJar() {
  const jar = utils.getJar();
  jar.setCookie("c_user=1000; Path=/; Domain=.facebook.com", "https://www.facebook.com");
  jar.setCookie("xs=42%3Aabc; Path=/; Domain=.facebook.com", "https://www.facebook.com");
  return jar;
}

const FAKE_HTML = `
<html><body>
<script>["DTSGInitialData",[],{"token":"DTSGTESTTOKEN"}]</script>
<script>require("RelayPrefetchedStreamCache").inject({"endpoint":"wss://edge-chat.facebook.com/chat?region=atn","irisSeqID":"777"});</script>
</body></html>`;

test("buildAPI builds the full api surface offline (no network)", () => {
  const login = require("../index.js");
  const jar = makeFakeJar();
  const globalOptions = {
    selfListen: false,
    listenEvents: true,
    autoReconnect: true,
    userAgent: "test-agent",
  };

  // Count makeDefaults invocations (regression P2-1: was called once per module)
  const origMakeDefaults = utils.makeDefaults;
  let makeDefaultsCalls = 0;
  utils.makeDefaults = function () {
    makeDefaultsCalls++;
    return origMakeDefaults.apply(this, arguments);
  };

  let ctx, api, defaultFuncs;
  try {
    ({ ctx, api, defaultFuncs } = login.buildAPI(globalOptions, FAKE_HTML, jar));
  } finally {
    utils.makeDefaults = origMakeDefaults;
  }

  assert.strictEqual(makeDefaultsCalls, 1, "makeDefaults must run exactly once per login");

  assert.strictEqual(ctx.userID, "1000");
  assert.strictEqual(ctx.fb_dtsg, "DTSGTESTTOKEN");
  assert.strictEqual(ctx.lastSeqId, "777");
  assert.ok(ctx.mqttEndpoint.includes("region=atn"), "mqtt endpoint region extracted");
  assert.strictEqual(ctx.loggedIn, true);

  // Representative methods from every src/ group
  const expected = [
    "sendMessage", "OldMessage", "sendMessageMqtt", "sendMessageDM",
    "listenMqtt", "listen", "stopListenMqtt",
    "getCurrentUserID", "getUserInfo", "getFriendsList",
    "getThreadInfo", "getThreadHistory", "getThreadList",
    "uploadAttachment", "resolvePhotoUrl", "createPost",
    "markAsRead", "markAsDelivered", "sendTypingIndicator",
    "httpGet", "httpPost", "refreshFb_dtsg", "logout", "getAppState",
    "setOptions", "getRegion", "addExternalModule",
  ];
  const missing = expected.filter((m) => typeof api[m] !== "function");
  assert.deepStrictEqual(missing, [], "all documented api methods exist");

  // E2EE methods are not attached when enableE2EE is off
  assert.strictEqual(typeof api.connectE2EE, "undefined");

  // getCurrentUserID reflects ctx
  assert.strictEqual(api.getCurrentUserID(), "1000");
});

test("setOptions validates boolean and value options", () => {
  const log = require("../src/core/logger");
  const login = require("../index.js");
  const opts = { selfListen: 1, logLevel: "warn", pageID: 42 };
  login.setOptions(opts, { online: "yes", selfListen: 0, pageID: 42, logLevel: "warn" });
  assert.strictEqual(opts.online, true);
  assert.strictEqual(opts.selfListen, false);
  assert.strictEqual(opts.pageID, "42");
  assert.strictEqual(opts.logLevel, "warn");
  log.setLevel("info");
});
