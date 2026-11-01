# Testing

## Running

```bash
npm test          # node --test --test-force-exit test/*.test.js
```

61 tests, all offline — **no Facebook traffic, no credentials, no external
network** (the update-check test only asserts graceful failure when the
registry is unreachable).

## Suites

| File | What it covers |
|---|---|
| `test/transport.test.js` | HTTP client contract: gzip, GET redirect following, POST redirect surfacing, urlencoded forms, object qs, cookie jar round-trip (send/persist/re-send), multipart stream upload, timeouts, `utils.get/post` integration. |
| `test/utils.test.js` | `getType`, threading/OTID generation (incl. 32-bit overflow regression), `formatID`, `getFrom`, `makeParsable`, `arrToForm`, `formatCookie`, `CustomError` (regression: class was missing), stream detection, shared `__req` counter across requests. |
| `test/checkupdate.test.js` | Update check is notify-only (no exec/exit/package.json mutation — source scanned), correct package identity, semver comparison, version detection, graceful offline behaviour, entry-point surface, no load-time globals. |
| `test/buildapi.test.js` | `buildAPI` offline: ctx fields, endpoint/region extraction, `makeDefaults` runs exactly once (regression: ran ~120×), 28 representative API methods exist, `setOptions` coercion. |
| `test/mqtt-lifecycle.test.js` | Full MQTT lifecycle against an **in-process fake broker** (ws + mqtt-packet): connect → subscribe ×18 → sync-queue create → `/t_ms` handling → typing event delivery → clean `stopListening`; `stopListeningAsync` resolves without a live client; **bounded reconnect** (N attempts then `stop_listen`); repeated connect/stop cycles don't leak sockets/listeners. |
| `test/parsedelta.test.js` | Malformed-payload regressions: broken `prng`, broken `mercuryJSON`, missing `threadKey`/`cid`, unparseable `ClientPayload`, missing message metadata, failing `resolvePhotoUrl` — all emit `parse_error` or degrade instead of crashing. Also MQTT frame patch stream + header sanitization. |
| `test/e2ee.test.js` | Bounded FIFO map eviction, shared map identity, global message maps capped, media server serve/close/idempotency/byte cap, JID detection, legacy event-shape mappers, `patchApiForE2EE` surface. |
| `test/e2ee-media.test.js` | Synthetic protobuf round-trip: build `WAMediaTransport`/`ImageTransport`, decode back to attachment fields (mediaKey, sha256, directPath, dimensions, caption, mentions); malformed payload rejection. |
| `test/security.test.js` | Source-level guarantees: no third-party endpoints in `src/`, no hardcoded upload keys, `getUID` has no third-party resolvers/UA rotation, update check has no exec/exit, logger has no `console.log` hijack or SIGINT hook at require time, MQTT CONNECT buffering, always-resolving stop, bounded E2EE maps. |

Plus `scripts/compat-install.sh`: `npm pack` → install tarball into a clean
project → require probe (CommonJS) → engines check.

## Conventions

- Framework: the Node.js built-in runner (`node:test`) — zero extra deps.
- `--test-force-exit` is used because keep-alive sockets and broker fixtures
  can outlive the tests.
- Every bug fixed during the audit has a regression test (see the `regression`
  tags in test names; traceability table in FINAL_REPORT.md).
- Tests never contact Facebook. If you add a test that would, mock the
  transport or use the fake broker pattern in `test/mqtt-lifecycle.test.js`.
