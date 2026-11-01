
# Changelog

All notable changes to AL-FCA will be documented in this file.

## [2.1.0] - 2026-11-01

Complete security, lifecycle and correctness overhaul. See `AUDIT.md` for the
full defect inventory and `API_COMPATIBILITY.md` for per-method verification.

### Security (breaking changes, see API_COMPATIBILITY.md §Deliberate changes)

- 🔒 **Auto-update system removed.** On load the library used to run
  `npm install al-fca@<ver>` via `execSync`, rewrite the consumer's
  package.json and call `process.exit(2)` — silently, against a package whose
  identity it never matched. The update check is now notify-only, opt-in
  (`autoUpdateCheck: true`) and never spawns processes or exits the host.
- 🔒 **Self-dependency removed** (`"al-fca": "^2.0.0"` pulled a second,
  foreign copy of the library into every install).
- 🔒 **Hardcoded ImgBB key removed.** Received photos are no longer silently
  re-uploaded to third-party image hosts. `uploadImageToImgbb` is explicit and
  bring-your-own-key; `photoUrlProxy` opts back into hosted URLs.
- 🔒 **`getUID` no longer forwards profile links to third-party resolver
  services** and no longer rotates user-agents; it resolves IDs locally with
  the user's own session.
- 🔒 **Deprecated `request` replaced** by a maintained internal transport
  (`src/transport/http-client.js`, `tough-cookie` + `form-data`): npm audit
  goes from 12 findings (2 critical, 4 high) to **0**. Unused dependencies
  removed (`bluebird`, `duplexify`, `totp-generator`, `yumi-json-bigint`,
  `undici`); `npmlog` 1.x → 7.x.

### Memory & lifecycle

- ♻️ Bounded FIFO maps for E2EE message/sender correlation (previously
  unbounded global Maps that grew forever).
- ♻️ MQTT reconnect: bounded attempts (default 5), exponential backoff with
  jitter, cancelled by `stopListening()`, no resurrection after stop; the
  `/t_ms` sync timeout uses the same path instead of an unbounded loop.
- ♻️ `stopListening`/`stopListeningAsync` always resolve (previously hung when
  no client existed) and now also disconnect the E2EE bridge.
- ♻️ E2EE media server: `closeMediaServer()`, byte-capped cache (128 MB),
  wired into disconnect; E2EE reconnect capped at 5 attempts.
- ♻️ Logger no longer overrides `console.log` process-wide, no longer installs
  a SIGINT handler at require time; `pause()/resume()` now actually work.

### Correctness

- 🐛 Malformed MQTT deltas (broken `prng`/`mercuryJSON`, missing `threadKey`/
  `cid`) crashed the whole process; they now emit `parse_error` events.
- 🐛 `utils.CustomError` was referenced by 4 modules but never defined —
  their validation paths threw `TypeError`.
- 🐛 `sendMessage`: MQTT ack timeouts no longer trigger a duplicate HTTP
  re-send (`err.code = MQTT_ACK_TIMEOUT` surfaces instead).
- 🐛 `sendMessageMqtt`: 32-bit `<<` overflow on otid fixed; non-stream
  attachments no longer crash; object-form mentions supported; per-instance
  `request_id`.
- 🐛 `refreshFb_dtsg` wrote `ctx.jazoest` which nothing read; now updates
  `ctx.ttstamp` so the refresh takes effect.
- 🐛 `logout()` now stops MQTT + E2EE before invalidating the session.
- 🐛 `login()` with no credentials no longer hangs; appstate cookie expiry
  accepts ISO strings; cookie URLs use https.
- 🐛 MQTT CONNECT could be silently lost when written before the WebSocket
  handshake completed — writes are now buffered until open.
- 🐛 `httpPost` exported a function named `httpGet`; `stopListenMqtt` and the
  emitter teardown are now one implementation.

### Performance

- ⚡ `makeDefaults` runs once per login (previously ~120×, once per API
  module, each re-scanning the login HTML); one shared `__req` counter instead
  of 120 counters restarting at 1.
- ⚡ Single consolidated config loader (was three duplicated blocks).
- 📊 Benchmarks and resource behaviour recorded in FINAL_REPORT.md.

### Added

- 🧪 Test suite rebuilt on `node:test`: **61 tests** — HTTP transport
  integration, fake MQTT broker lifecycle (connect/sync/stop/bounded
  reconnect/leak cycles), delta-parsing crash regressions, E2EE map/media/
  mapper tests (synthetic protobuf round-trip), security source guarantees,
  `npm pack` install probe.
- 📚 `AUDIT.md`, `API_COMPATIBILITY.md`, `ARCHITECTURE.md`, `SECURITY.md`,
  `TESTING.md`, `TROUBLESHOOTING.md`, `INTEGRATION_TESTING.md`.
- ⚙️ New options: `photoUrlProxy`, `autoUpdateCheck`, `reconnectMaxAttempts`,
  `reconnectBaseDelayMs`, `mqttTmsTimeoutMs`, `imgbbApiKey`.

## [Unreleased]

### Added
- ✨ Professional `src/logger.js` (drop-in npmlog replacement): `DEBUG/INFO/SUCCESS/WARN/ERROR/EVENT/E2EE/NETWORK` levels, `[AL-FCA] [HH:MM:SS] [LEVEL]` format, `AL_FCA_LOG_LEVEL` env + silent mode, stderr output
- 🧪 Logger test suite (`test/logger.test.js`)
- 📄 MIT `LICENSE`, `config.example.json`, GitHub Actions CI (`npm ci` + test + pack dry-run on Node 18/20/22)

### Changed
- 🧹 Rebrand completed across README, E2EE guide, CHANGELOG, MQTT banner, and update checker
- 📁 `assest/` renamed to `assets/` (README, `e2eebot.js` updated)
- 📦 npm tarball slimmed (sourcemaps, TS sources, and `config.json` excluded): 505 kB → 265 kB
- 🔇 `src/logger.js` excluded from the `api[name]` dynamic loader (it exports an object, not a factory)

### Fixed
- 🐛 Login crash guard: dynamic `src/` loader no longer calls non-factory modules as functions
- 🔒 `config.json`, `cookie.txt`, `e2ee_device.json`, `appstate.json`, and logs no longer shippable/committable (`.npmignore` + `.gitignore`)

### Removed
- 📡 Remote image-key refresh (`index.js` no longer fetches keys from the old `ST-Handlers` repo at runtime); the hardcoded fallback keys are now the only source, so installs never phone home to third-party repos

## [1.3.0] - 2026-09-20

### Changed
- 🔐 E2EE backend replaced: the native messagix/koffi binary stack is gone; E2EE is now powered by the vendored FB-Messenger-E2EE implementation (Signal Protocol + Noise, pure JavaScript)
- 🗑️ Removed `e2ee.js`, `lib/`, `build/`, `e2eebot_new.js` and the `koffi` dependency
- 📦 Added `@signalapp/libsignal-client` and `protobufjs` dependencies; E2EE bundle ships prebuilt in `e2ee/vendor/fbme/`
- ⚙️ `setOptions` now accepts `enableE2EE`, `e2eeMemoryOnly`, `e2eeDevicePath`, `e2eeDeviceData`, `e2eeMediaCdnHost` (fixes "Unrecognized option: enableE2EE")
- 🤖 `e2eebot.js` rewritten on the public AL-FCA api (fixes "Do not know how to serialize a BigInt"); new `!image`, `!s` (image echo), `!typing` (10s indicator) and `!seen` commands with auto-seen on incoming E2EE messages
- ✉️ Encrypted E2EE reactions implemented (DM + group sender-key fanout); routine prekey-sync notice demoted to debug log
- ⌨️ E2EE typing travels over the normal thread channel (typing state is thread metadata, not message content)
- 🔁 Media upload tries all media_conn hosts with fallback and reports the per-host failure reason (DNS/TLS/connect)

### Added
- 📁 New `e2ee/` integration layer (bridge, events, media-decode, vendored bundle) — existing `require('../e2ee')` call sites untouched
- 🧪 Test suite: `npm test` (30 tests: JID detection, event mapping, media transport decode, typing strip, no-binary guards)
- 📖 New `E2EE_GUIDE.md` with architecture, support matrix and troubleshooting
- ➕ New additive event `e2ee_message_revoke` for encrypted revokes

### Fixed
- `ENOENT ... .al-fca-e2ee/device.json` on first E2EE connect (device directory is created automatically)
- E2EE media upload `invalid content-length header` (manual Content-Length removed; undici sets it for Buffer bodies)
- `api.getE2EEDeviceData` and `api.connectE2EE` now work without the native client
- E2EE `setMessageReaction` error handler crash (`require('../../utils'.log` → `npmlog`)

### Removed
- `e2eeMemoryOnly` behavior: the new backend always persists the device file (a one-time warning is logged); old messagix device files are incompatible — re-register once
- Encrypted group media (unsupported by the underlying implementation; raises `E2EEMediaError`)

## [1.0.5] - 2025-01-13

### Added
- 🔄 Comprehensive update system that properly syncs all files
- 📂 Automatic file tree comparison between local and GitHub
- ➕ Smart file addition for new files in updates
- ♻️ Automatic modification detection and update
- 🗑️ Automatic deletion of removed files from old versions
- 🎯 No backup folder creation - cleaner updates

### Changed
- Improved update mechanism to handle version jumps (e.g., 1.0.3 → 1.0.6)
- Enhanced file synchronization to ensure no missing files
- Better error handling during updates
- Auto-restart after successful update

### Fixed
- Missing files when updating across multiple versions
- Outdated files not being properly replaced
- Orphaned files from old versions not being cleaned up

## [1.0.4] - 2025-01-13

### Added
- 🔄 Automatic update checking on package initialization
- ⚡ Non-blocking update process - doesn't interrupt user's bot startup
- 🎯 Update check runs once per session to avoid redundant checks
- 💡 Silent error handling for update checks

### Changed
- Update checker now integrated directly into login flow
- Improved user experience with seamless auto-updates

## [1.0.3] - 2025-01-13

### Added
- 🎨 Enhanced MQTT connection logging with visual indicators
- 🔄 Auto-reconnect status display
- 📊 Connection region display
- ⚡ Automatic update checking and installation
- 💾 Automatic backup creation before updates
- 🎯 Better error messages and debugging
- 📋 Changelog tracking
- 🌟 Branding: "Maintained & Enhanced by ST | Sheikh Tamim"

### Changed
- Improved console output with colors and formatting
- Better connection status messages
- Enhanced stability and error handling

### Fixed
- MQTT reconnection reliability
- Connection timeout handling
- Error message clarity

---

**Maintained & Enhanced by Alamin**  
GitHub: https://github.com/alaminnna/al-fca  
NPM: https://www.npmjs.com/package/al-fca
