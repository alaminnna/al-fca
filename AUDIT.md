# AL-FCA — Complete Codebase Audit

> Audit date: 2026-11-01 · Codebase version: `@alaminnna/al-fca@2.0.1` (commit `acde405`)
> Scope: full repository discovery, dependency map, defect inventory with severity, remediation plan.

---

## 1. What AL-FCA is

AL-FCA is an unofficial Facebook Messenger automation library for Node.js. It emulates a
logged-in browser session (via cookie `appState` or email/password login), opens a WebSocket
MQTT connection to Facebook's edge chat servers for real-time events, sends messages through
the same MQTT channel (with an HTTP fallback), and optionally attaches an end-to-end-encrypted
session (Signal/Noise protocol, vendored `FB-Messenger-E2EE` bundle) over a second WebSocket.

## 2. Architecture map

```
                           consumer app (bot)
                                  │  require()
┌─────────────────────────────────▼──────────────────────────────────────────┐
│ index.js  — module.exports = login (src/auth/login.js)                     │
│   ├─ login(loginData, options, cb)                                         │
│   │    └─ src/auth/login.js  loginHelper()                                 │
│   │         ├─ HTTP GET facebook.com (cookie jar warm-up)                  │
│   │         ├─ optional email/password POST login (+2FA checkpoint flow)   │
│   │         └─ index.js buildAPI(globalOptions, html, jar)                 │
│   ├─ buildAPI()                                                            │
│   │    ├─ extract fb_dtsg / irisSeqID / MQTT endpoint from HTML            │
│   │    ├─ ctx = { userID, jar, clientID, mqttEndpoint, lastSeqId, … }      │
│   │    ├─ utils.makeDefaults(html, userID, ctx)   ← called ~120 times!     │
│   │    ├─ loadApiModules(src/) — requires every src/**/*.js                │
│   │    │      each module: module.exports = (defaultFuncs, api, ctx) => fn │
│   │    ├─ api.sendMessage wrapper (OldMessage fallback on ANY error)       │
│   │    ├─ silent ImgBB/ImageKit uploader (hardcoded key, auto re-upload    │
│   │    │   of every received photo — privacy issue)                        │
│   │    └─ optional E2EE patch (e2ee.patchApiForE2EE)                       │
│   └─ checkUpdate.js — auto npm install + process.exit(2) on load (!!)      │
├─────────────────────────────────────────────────────────────────────────────┤
│ utils.js (3,023 lines) — HTTP via deprecated `request`, cookie jar,        │
│   makeDefaults, parseAndCheckLogin, format* (delta/message/thread), IDs    │
├──────────────┬──────────────────────────────┬───────────────────────────────┤
│ src/auth/    │ src/mqtt/                    │ src/messaging/ (18 modules)   │
│  login       │  listenMqtt (928 lines)      │  sendMessage (MQTT+ack,       │
│  logout      │  stopListenMqtt              │    OldMessage HTTP fallback)  │
│  getAccess   │                              │  sendMessageMqtt (legacy dup) │
│  refresh…    │ src/http/ httpGet/httpPost   │  OldMessage, reactions, edits │
│ src/core/    │ src/media/ (12 modules)      │ src/users/ (24 modules)       │
│  logger      │  uploadAttachment, posts,    │ src/threads/ (20 modules)     │
│  addExternal │  stories, notes              │  thread history/info          │
├──────────────┴──────────────────────────────┴───────────────────────────────┤
│ e2ee/ — E2EE bridge                                                        │
│   core/bridge.js  (session lifecycle, event mapping, media)                │
│   core/media-server.js (local HTTP cache for decrypted attachments)        │
│   core/device-migrate.js, errors.js                                        │
│   fme/  (api-shim, fme-client, events, proto)                              │
│   vendor/fbme/dist/index.cjs  (vendored 6.7k-line FME bundle; uses         │
│   @signalapp/libsignal-client native module, ws, protobufjs)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Entry points
- `index.js` → `module.exports = login`, plus `login.buildAPI`, `login.setOptions`.

### Shared state
| State | Location | Problem |
|---|---|---|
| `global.ditconmemay` | index.js:17 | global flag, never read |
| `global.alfcaUpdateChecked` | index.js:18, login.js:204 | cross-instance update-check gate |
| `global.mqttClient` | listenMqtt.js:378 | last-connected instance's client; read by sendMessage/sendTypingIndicator as **fallback → cross-account send risk** |
| `global.GoatBot` | index.js, listenMqtt, sendMessage, OldMessage | third-party-framework coupling |
| `global._e2eeMessageMap`, `_e2eeSenderJidMap`, `_e2eeBotSentMsgIds`, `_e2eePendingUnsendJid` | e2ee/core/bridge.js:186, sendMessage.js | **unbounded global Maps/Sets**; `_e2eePendingUnsendJid` is read but never written (dead) |
| module-level `getSeqID`, `form`, `globalCallback`, `_mqttSpinner` | listenMqtt.js:202-203, 43 | shared across API instances → second instance overwrites first |
| `request.defaults({ jar: true })` | utils.js:12 | shared fallback cookie jar for the whole process |

### Event emitters / timers / sockets
- MQTT client (`mqtt.MqttClient` over a patched `ws` WebSocket) — one per `listenMqtt` call.
- E2EE FME WebSocket (inside vendored bundle), reconnect timer in bridge.js.
- Spinner intervals (logger.js, listenMqtt.js, 80 ms).
- `/t_ms` wait timer (5 s) in listenMqtt `connect` handler.
- MessageEmitter (per `api.listenMqtt()` call) — consumer-facing.

### External dependencies (18 direct, 161 installed)
| Package | Used for | Status |
|---|---|---|
| `request` | **all** HTTP in utils.js | deprecated since 2020 |
| `bluebird` | promise utils | legacy, redundant with native |
| `mqtt`, `ws` | MQTT transport | maintained; `ws` 8.18.3 has high advisories (fix available) |
| `axios` | checkUpdate, E2EE media | many 2025 advisories; fix available |
| `cheerio` | HTML parsing at login | maintained (1.1.2) |
| `@signalapp/libsignal-client` | vendored E2EE | native build, heavy but appropriate |
| `protobufjs` | E2EE protos | maintained |
| `npmlog` **1.2.1** | logging in 42 src files | 2015-era; current is 7.x |
| `mime`, `chalk`, `gradient-string`, `https-proxy-agent` | misc | fine |
| **`duplexify`, `totp-generator`, `yumi-json-bigint`, `undici`** | — | **unused** (0 references) — remove |
| `cfonts`, `boxen` | logger banner/spinner | **soft-required but not declared** in package.json |

### Circular dependencies
- `index.js` ⇄ `src/auth/login.js` — resolved at runtime via deferred `require` inside
  `getIndex()`; works but fragile (deferred to keep startup order valid).
- `src/messaging/sendMessage.js` → `e2ee` → (on error paths) back into api methods. Benign.

### Duplicate implementations (business-logic risk)
- `src/messaging/sendMessage.js` (modern, `BigInt` otid, /ls_resp ack correlation) **vs**
  `src/messaging/sendMessageMqtt.js` (legacy, 32-bit `<<` overflow on otid, no ack
  correlation, array-only mentions) — two different MQTT senders.
- `api.listen = api.listenMqtt` plus a *separate* `stopListenMqtt` API that duplicates
  `MessageEmitter.stopListening` with different cleanup (and no callback).
- Three copies of the config-loading block in index.js (initial, `refreshFcaConfig`, E2EE options).
- `src/http/httpPost.js` exports a function *named* `httpGet` (copy-paste).

### Dead code
- `checkVerified` interval cleared but never set (index.js:167).
- `e2eePendingUnsendJid` global — read, never written.
- `presenceDecode`, `formatDate`, `getData_Path`/`setData_Path`/`getPaths`, `getJazoest`,
  `getFormData`, `cleanHTML` exported but unused anywhere in src.
- `ctx.i_userID` referenced in listenMqtt but never set.
- `log.maxRecordSize`, `log.pause/resume` — accepted but no-ops.
- `e2eebot.js` listed in package.json `files` — does not exist in the repo.

---

## 3. Discovered problems

Severity: **P0** = breaks hosts/security, **P1** = reliability/correctness, **P2** = quality/perf.

### P0 — Supply chain & host integrity
| # | Finding | Location |
|---|---|---|
| P0-1 | **Auto-update executes `npm install al-fca@<ver>` via `execSync`, rewrites the consumer's package.json, then calls `process.exit(2)`** — killing the host app without consent. It runs *automatically on first `require()`* of the library. | checkUpdate.js:29-115, index.js:21-29, login.js:204-209 |
| P0-2 | **Self-referencing dependency**: `package.json` depends on `"al-fca": "^2.0.0"` — a *different npm package* (author's older unscoped publish). A second full copy of the library ships inside `node_modules`, doubling install size and creating package-identity ambiguity. | package.json:69 |
| P0-3 | Update check queries `registry.npmjs.org/al-fca` and `getCurrentVersion()` compares against the **foreign** package (`pkg.name === 'al-fca'` never matches this package's `@alaminnna/al-fca`), so the version check is always wrong. | checkUpdate.js:7-27 |
| P0-4 | **Hardcoded third-party API key** (ImgBB) in source, and every photo received via MQTT is silently re-uploaded to imgbb.com (and optionally ImageKit) by `attachImageUrlToAttachment` — user content exfiltrated to third parties by default, with no opt-out. | index.js:326-412, listenMqtt.js:494-501 |
| P0-5 | 12 npm audit findings (2 critical, 4 high, 6 moderate) in the dependency tree: `ws` (MQTT transport!), `axios`, `undici`, `uuid`, `ajv`. | package-lock.json |

### P1 — Memory & lifecycle
| # | Finding | Location |
|---|---|---|
| P1-1 | **Unbounded global Maps/Sets** for E2EE message tracking grow forever (every E2EE message adds entries; never pruned). | e2ee/core/bridge.js:186-191, sendMessage.js:324-340 |
| P1-2 | **Reconnect storm**: `mqttClient.on('error')` → `end()` → `getSeqID()` → brand-new connection. No backoff, no attempt cap, runs even after `stopListening()` (globalCallback set to `identity` but connection keeps being re-established). Same for the 5 s `/t_ms` timeout. Under a network outage this hammers Facebook in a tight loop and leaks WebSocket/MqttClient pairs. | listenMqtt.js:382-388, 420-423 |
| P1-3 | Module-level `getSeqID`/`form`/`globalCallback` shared across API instances: calling `login()` twice (two accounts) makes instance B's listen overwrite instance A's. | listenMqtt.js:202-203, 847 |
| P1-4 | `ctx.threadTypes` grows unboundedly (one entry per thread, never pruned). | index.js:216, listenMqtt.js:516 |
| P1-5 | `stopListening()` never calls back when `ctx.mqttClient` is undefined → `stopListeningAsync()` promise hangs forever. Also does not disconnect the E2EE bridge (its WebSocket stays open). | listenMqtt.js:868-890, bridge disconnect never wired |
| P1-6 | Calling `api.listenMqtt()` twice leaks the first connection (ctx.mqttClient overwritten; old client has no handle left to stop it). | listenMqtt.js:377, index.js |
| P1-7 | E2EE media server (local HTTP on 127.0.0.1) has **no shutdown API** and its cache only prunes when new media is stored; holds up to 10 min of all decrypted media (incl. videos) in RAM. | e2ee/core/media-server.js |
| P1-8 | Logger overrides `console.log` process-wide and installs a `SIGINT` handler at require time; `process.exit(130)` in the handler skips consumer cleanup. | src/core/logger.js:190-195, 505-517 |
| P1-9 | Spinner intervals in listenMqtt/logger write to stdout even when piped; module-level `_mqttSpinner` clobbered by second instance. | listenMqtt.js:43-71 |

### P1 — Correctness / crash vectors
| # | Finding | Location |
|---|---|---|
| P1-10 | **Unguarded `JSON.parse` on incoming MQTT payloads** (`prng`, `mercuryJSON`) and unguarded property chains (`messageMetadata.cid.canonicalParticipantFbids`) — a malformed/unexpected delta crashes the whole process from inside the `message` handler. | listenMqtt.js:575, 588, 602, 613 |
| P1-11 | `utils.CustomError` is used by 4 modules (addUserToGroup, changeAdminStatus, changeThreadColor, refreshFb_dtsg) but **does not exist** → those validation paths throw `TypeError: utils.CustomError is not a constructor`. | utils.js exports; src/threads/*, src/auth/refreshFb_dtsg.js:35 |
| P1-12 | `sendMessageMqtt` computes `otid` with `Date.now() << 22` — 32-bit overflow produces garbage/negative IDs. `sendMessage` (BigInt) is correct; the two senders diverge. | sendMessageMqtt.js:262 vs sendMessage.js:131 |
| P1-13 | `index.js` wraps `sendMessage` to fall back to `OldMessage` on *any* error, on top of sendMessage's own MQTT→HTTP fallback: a 15 s ack timeout (message actually delivered) triggers a **duplicate send**, and a failing OldMessage is retried once more. | index.js:472-480, sendMessage.js:389-395 |
| P1-14 | `sendMessageMqtt` throws synchronously for non-stream attachments (inside callback chain) → process crash instead of `callback(err)`. Mentions only accepted as array, while `sendMessage`/OldMessage accept the classic object form. | sendMessageMqtt.js:11-19, 129-174 |
| P1-15 | `uploadAttachment` validation condition is logically impossible (`!getType(x) === "Array" && getType(x) === "Array"`) → never fires; passing `undefined` yields a confusing "should be a readable stream" error. | uploadAttachment.js:83-90 |
| P1-16 | `refreshFb_dtsg` writes `ctx.jazoest`, but nothing reads it — makeDefaults uses `ctx.ttstamp`; the refreshed jazoest never takes effect. | refreshFb_dtsg.js:64 vs utils.js:2524 |
| P1-17 | `login()` with neither appState nor email/password: no branch runs, promise never settles, callback never called (silent hang). Also the email+password branch hard-forces `forceLogin:true`/`logLevel:"silent"`, ignoring caller options. | login.js:246-257 |
| P1-18 | `logout()` does not stop MQTT/E2EE connections; ctx remains "logged out" with open sockets. | logout.js |
| P1-19 | `markAsRead` and friends **return the error object instead of rejecting** on failure (`catch(e){ callback(e); return e; }`) — `await` succeeds with an error value; inconsistent with the rest of the API. | markAsRead.js:64-66, 88-90 |
| P1-20 | `parseAndCheckLogin` logs full response bodies at `verbose` (may include personal data); several modules `console.error` raw errors (may include cookies in request dumps). | utils.js:2597, many src files |

### P2 — Performance & quality
| # | Finding | Location |
|---|---|---|
| P2-1 | `utils.makeDefaults(html, userID, ctx)` is invoked **once per loaded API module (~120×)** during `buildAPI`; each call re-scans the login HTML and allocates fresh closures. The heavy `cheerio.load` in `extractFromHTML` also runs once per login. | index.js:453-466 |
| P2-2 | `console.log` on every MQTT publish ("Message published successfully…") — noisy, and console.log was itself redirected to stderr by the logger. | sendMessageMqtt.js:221, stopListenMqtt.js:13 |
| P2-3 | New message delivery for photo attachments is **serialized behind `resolvePhotoUrl` HTTP round-trips** before the event is emitted. | listenMqtt.js:507-541 |
| P2-4 | Synchronous `fs` reads of config.json (3×) at every login; `fs.existsSync/readFileSync` in hot paths. | index.js:219-310 |
| P2-5 | `post()` in utils drops `ctx`/`customHeader` args (headers built without region) — inconsistent with `get()`. | utils.js:150-163 |
| P2-6 | Logger `activeSpinners` unbounded; `pause/resume`/`maxRecordSize` accepted but no-op — misleading API. | logger.js |
| P2-7 | `cheerio` (full jQuery engine) used only to scrape two tokens from login HTML. | index.js, login.js |

### Security posture (Phase 5 preview)
- AppState cookies are parsed with a tolerant schema (`key`/`name`, string epoch or ISO)
  but `expirationDate` as ISO string yields `Invalid Date` cookies (silently dropped by jar).
- Session secrets (cookies) are attached to every request from `jar`; verbose logging can
  dump response bodies; no redaction helper exists.
- No file-permission guidance for appstate files; config.json is read from CWD (consumer's
  responsibility) — must be documented + example provided.
- The ImgBB uploader (P0-4) is the single worst data-path violation; must be opt-in or removed.
- No credentials are hardcoded (email/password path is caller-provided) — good.

---

## 4. Remediation plan (phases 2-13)

1. **P0 first**: remove auto-install/auto-exit from checkUpdate.js (make it a notify-only,
   opt-in check against the correct package name); drop the self-dependency; remove the
   silent ImgBB uploader (make image-URL proxying an explicit, documented opt-in); npm
   overrides for vulnerable transitive deps; drop unused deps.
2. **Lifecycle (P1-1..9)**: instance-scoped MQTT state; bounded E2EE maps; explicit
   connection state machine with capped exponential backoff + jitter; always-resolving
   stopListening; E2EE bridge disconnect wired into stop; media server close API + size cap;
   logger without process-global side effects.
3. **Correctness (P1-10..20)**: guarded delta parsing (emit `parse_error` instead of crash),
   real `CustomError`, remove double-send wrapper, fix otid/mention/validation bugs, login
   arg validation, logout stops transports.
4. **Perf (P2)**: makeDefaults once per login; single config read; lazy cheerio removal where
   trivial; logging through one logger; measure before/after (module-load time, RSS over
   synthetic message streams, listener counts, connect/disconnect cycles).
5. **Tests**: node:test suite (unit + integration with an in-process MQTT-over-WS test
   broker + regression tests for every fixed bug + resource-leak tests).
6. **Docs**: rewrite auto-update claims, add ARCHITECTURE/SECURITY/TESTING/TROUBLESHOOTING/
   API_REFERENCE, CHANGELOG.

Constraints honored during remediation:
- No new features beyond fixes; public API shapes preserved (callback + promise duality,
  method names, event names).
- No stealth/evasion features of any kind.
- No live Facebook traffic from tests; network-touching code paths tested via mocks.
