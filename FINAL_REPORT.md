# AL-FCA Final Report — Audit, Refactor & Quality Engineering

> Date: 2026-11-01 · Base: `acde405` (`@alaminnna/al-fca@2.0.1`) · Result: `720db05`+ (`@alaminnna/al-fca@2.1.0`)
> Companion documents: `AUDIT.md` (discovery & defect inventory), `API_COMPATIBILITY.md` (per-method verification),
> `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `TROUBLESHOOTING.md`, `INTEGRATION_TESTING.md`.

## 1. Original architecture

AL-FCA is an unofficial Facebook Messenger automation library: `login()` loads an
appState (cookie) session, `buildAPI()` scrapes `fb_dtsg`/`irisSeqID`/MQTT endpoint
from the login HTML and dynamically registers ~110 one-method modules from `src/`,
`listenMqtt()` holds a WebSocket MQTT connection to `edge-chat.facebook.com` for
real-time deltas, sends go over MQTT (`/ls_req`) with an HTTP (`OldMessage`) fallback,
and an optional E2EE stack (vendored `FB-Messenger-E2EE` bundle on
`@signalapp/libsignal-client`) attaches a second WebSocket with Signal/Noise.
HTTP was done through the deprecated `request` library; configuration, logging and
update checking were bolted onto module load with process-global side effects.

## 2. Critical bugs discovered (top 10)

| # | Bug | Impact |
|---|---|---|
| 1 | Auto-update ran `npm install al-fca@…` via `execSync`, rewrote package.json, `process.exit(2)` — **on library load**, against a package identity it never matched | killed consumer apps; arbitrary-package installation risk |
| 2 | Self-dependency `"al-fca": "^2.0.0"` | foreign second copy of the library installed in every consumer |
| 3 | Hardcoded ImgBB key + silent re-upload of **every received photo** to third-party hosts | user-content exfiltration by default |
| 4 | Unguarded `JSON.parse` / property chains in delta handling (`prng`, `mercuryJSON`, `threadKey`, `cid`) | any malformed payload **crashed the host process** |
| 5 | MQTT CONNECT written before the WebSocket handshake completed | first packets could be silently lost; connection stalls |
| 6 | Reconnect storm: error → new connection, no backoff/cap, even after `stopListening()` | hot loop hammering Facebook; socket/client leak |
| 7 | `utils.CustomError` used by 4 modules but never defined | validation paths threw `TypeError` |
| 8 | `sendMessage` double-fallback (wrapper + internal) | **duplicate messages** on MQTT ack timeout |
| 9 | `sendMessageMqtt` otid computed with 32-bit `<<` overflow | garbage/negative offline-threading IDs |
| 10 | `login()` with no credentials: no branch ran | promise never settled, callback never called |

Full inventory with 40+ findings: `AUDIT.md`.

## 3. Memory leaks discovered & fixed

| Leak | Fix | Evidence |
|---|---|---|
| Unbounded global Maps/Sets (`_e2eeMessageMap`, `_e2eeSenderJidMap`, `_e2eeBotSentMsgIds`) | FIFO-bounded maps, cap 5000 (`e2ee/core/bounded-store.js`) | `test/e2ee.test.js` (6000 inserts → ≤5000) and benchmark: 200k sets → size 5000, RSS +11 MB |
| Reconnect loop leaking WebSocket+MqttClient pairs | bounded exponential backoff (2^n, cap 30 s, ±jitter, default 5 attempts), cancelled by stop, per-instance state | `test/mqtt-lifecycle.test.js` (exactly N+1 connect attempts, then `stop_listen`) |
| `stopListeningAsync()` promise never resolved without a client | callback always invoked | test: resolves against a dead port |
| E2EE bridge stayed connected after `stopListening`/`logout` | disconnect wired into both; media server closed | test: bridge disconnect path + media server close |
| Media cache grew with no cap and no shutdown | 128 MB byte cap, 10 min TTL, `closeMediaServer()` | `test/e2ee.test.js` byte-cap + close/idempotency |
| Logger `activeSpinners` unbounded + `console.log` hijack + require-time SIGINT | hijack and SIGINT removed; `pause/resume` functional | `test/security.test.js` source guarantees |
| `ctx.threadTypes` unbounded | documented (bounded by thread count in practice); correlation maps bounded | reviewed |

## 4. Performance problems & improvements (measured)

| Metric | Before | After | Measurement |
|---|---|---|---|
| `makeDefaults` calls per login | ~120 (one per module) | **1** | `test/buildapi.test.js` asserts exactly 1 |
| makeDefaults CPU per login | 0.50 ms (×120 replay) | 0.01 ms (×1) | benchmark, 98 % reduction of that path |
| `__req` counter correctness | 120 counters each restarting at 1 | one process-wide counter | `test/utils.test.js` (__req 1 → 2) |
| Delta parse throughput | — | **468k msg/s** (20k deltas, 42.7 ms) | benchmark `scripts/benchmark.js` |
| Config loading | 3 duplicated `readFileSync` blocks | 1 loader, 1 read per file | code |
| HTTP transport | deprecated `request` (frozen, vulnerable) | internal client, **4,395 req/s** localhost | benchmark |
| E2EE correlation maps | unbounded | O(1) size with FIFO eviction | benchmark |

No premature optimization was applied beyond the above; hot paths
(formatDeltaMessage, parseDelta) were kept synchronous and allocation-light.

## 5. Security problems & fixes

| Problem | Fix |
|---|---|
| 12 npm-audit findings (2 critical: `form-data` in `request`; high: `ws`, `axios`) | replaced `request` with `tough-cookie` + `form-data` + node `http/https`; upgraded `axios`, `ws`, `cheerio`, `npmlog`; **`npm audit` now: 0 vulnerabilities** |
| Hardcoded ImgBB key in source (also burned in git history) | removed; explicit BYO-key API. **Note: the leaked key remains in upstream git history and must be treated as revoked regardless of this fix.** |
| Photos re-uploaded to third parties by default | removed; `photoUrlProxy` opt-in only |
| `getUID` sent profile links to two third-party resolvers + rotated UAs | local resolution via the user's own session; no UA rotation |
| Update check phoned the registry on every load | opt-in, once per process, notify-only |
| `verbose` logging could dump response bodies | kept behind explicit `logLevel: "verbose"`; documented |
| Global `mqttClient` fallback could send via another account's connection | removed; per-instance handles only |
| Login form-building with shared/global state | per-instance ctx; no `global.ditconmemay`/`alfcaUpdateChecked` |

Enforced permanently by `test/security.test.js` (source scans + behavior pins).

## 6. Changes implemented (68 files, +2,993/−1,801)

- New: `src/transport/http-client.js`, `e2ee/core/bounded-store.js`, `test/` (10 files),
  `AUDIT.md`, `API_COMPATIBILITY.md`, `API_REFERENCE.md`, `ARCHITECTURE.md`,
  `SECURITY.md`, `TESTING.md`, `TROUBLESHOOTING.md`, `INTEGRATION_TESTING.md`.
- Rewritten: `checkUpdate.js`, `src/mqtt/listenMqtt.js`, `src/auth/login.js`,
  logger, `index.js` (config/loader/uploader), `utils.js` (transport wiring),
  `getUID`, media server, E2EE bridge lifecycle, 38 modules moved to the logger.
- `package.json`: version 2.1.0, engines ≥18, deps cleaned (14 direct, 0 unused),
  files list fixed, lockfile regenerated.

## 7. Tests created

**61 automated tests** in 10 files (Node built-in `node:test`, zero extra deps):
transport contract (8), utils (10), update-check (6), buildAPI (2), MQTT lifecycle
against an in-process fake broker (4), delta-parsing crash regressions (10),
E2EE core (8), E2EE media protobuf round-trip (2), security source guarantees (8),
plus misc. Also `scripts/compat-install.sh` (npm pack → clean install → require probe).

## 8. Test results

```
ℹ tests 61  ℹ pass 61  ℹ fail 0  ℹ cancelled 0
npm audit --omit=dev → found 0 vulnerabilities
npm pack --dry-run → 274.9 kB, 123 files (no tests/audit docs ship)
compat-install.sh → PASSED (clean install + CommonJS require probe)
node --check → all 103 shipped JS files parse
```

**Not executed:** live Facebook validation (requires authorized credentials;
procedure prepared in `INTEGRATION_TESTING.md`). The E2EE Noise handshake
against `reg-e2ee.facebook.com` is therefore *code-reviewed*, not *verified*.

## 9. Before/after benchmarks

See §4 and `scripts/benchmark.js` (reproducible). Highlights: login-path
makeDefaults overhead −98 %, delta throughput 468k/s, transport 4.4k req/s,
dependency install 178 → 134 packages with zero known vulnerabilities.

## 10. Remaining limitations

1. **Live behavior unverified** — all Facebook-facing request/response shapes
   derive from the original code; endpoint drift is possible at any time
   (inherent to unofficial libraries). Run `INTEGRATION_TESTING.md` with an
   authorized test account before production use.
2. **E2EE handshake unverifiable offline**; `e2eeMemoryOnly` remains
   unsupported by the vendored backend (warns, keys persist at 0600).
3. **`request`-era quirks kept for compatibility**: `markAsRead`-family methods
   resolve with the error object on failure; callback-style APIs that receive a
   callback never settle their returned Promise.
4. **Message ordering** across async forced-fetches is best-effort.
5. The leaked ImgBB key lives in upstream git history (needs history rewrite or
   simply revocation on the provider side).
6. `utils.js` remains a 3,000-line monolith (formatting helpers exported for
   compatibility); further decomposition is possible without breaking the
   public API but was deliberately deferred ("do not rewrite stable modules
   without a measurable reason").

## 11. Breaking changes (all documented)

1. No auto-update (notify-only, opt-in). 2. No silent third-party uploads
(`photoUrlProxy`). 3. `uploadImageToImgbb` requires an API key. 4. `getUID` is
local-only. 5. MQTT failures end in a bounded `stop_listen` event instead of
looping forever. 6. `sendMessage` ack timeouts reject with `MQTT_ACK_TIMEOUT`
instead of re-sending. 7. Globals `ditconmemay` / `alfcaUpdateChecked` /
`mqttClient` reads removed. 8. Dependencies: `request`, `bluebird`, `undici`,
`duplexify`, `totp-generator`, `yumi-json-bigint` no longer installed
transitively. 9. Node ≥ 18 required (engines enforced).

## 12. Recommended next steps

1. **Live validation pass** per `INTEGRATION_TESTING.md` with an owned test
   account (Phases C–F), then a 2.1.0 release publish from a clean CI run.
2. Add a GitHub Actions workflow (`.gitignore` currently excludes `.github/` —
   un-ignore it) running `npm ci && npm test && npm audit --omit=dev` on Node
   18/20/22 plus the compat-install probe.
3. Consider `npm trusted publishing`/provenance for the release pipeline.
4. Track upstream endpoint drift: the `parse_error` events now make drift
   observable — add an issue-template that collects them (sanitized).
5. Long-term: split `utils.js` into `src/util/` modules behind the same
   export surface, and replace `cheerio` token-scraping with targeted regex
   extraction (login path only).
