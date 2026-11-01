# Architecture

## Module map

```
index.js                        login() + buildAPI() + setOptions()
  ├── src/auth/login.js         login orchestration (appState / credentials / 2FA)
  ├── checkUpdate.js            notify-only update check (opt-in)
  ├── utils.js                  HTTP helpers (via src/transport/http-client),
  │                             cookie jars, format* (delta/message/thread),
  │                             makeDefaults, parseAndCheckLogin, IDs
  ├── src/transport/http-client.js   maintained HTTP layer (tough-cookie +
  │                                  form-data + node http/https), request-
  │                                  compatible response contract
  ├── src/core/logger.js        leveled logger (stderr, spinner, no globals)
  ├── src/mqtt/listenMqtt.js    MQTT transport + delta dispatch
  │                             (bounded reconnect, per-instance state)
  ├── src/<group>/<method>.js   one file per API method; each exports
  │                             (defaultFuncs, api, ctx) => fn
  │                             groups: auth, core, http, media, messaging,
  │                             mqtt, threads, users
  └── e2ee/                     optional E2EE stack
       ├── core/bridge.js       session lifecycle + event mapping (bounded
       │                        correlation maps)
       ├── core/media-server.js loopback HTTP cache for decrypted media
       ├── core/bounded-store.js FIFO-bounded Map
       ├── core/device-migrate.js, errors.js
       └── fme/                 shim over vendored FB-Messenger-E2EE bundle
            (api-shim, fme-client, events, media-decode, proto/)
            vendor/fbme/dist/index.cjs (Signal/Noise client, libsignal-client)
```

## Key invariants

1. **Factory convention** — every `src/**/*.js` (except `core/logger.js`,
   `auth/login.js`, `transport/http-client.js`) exports
   `(defaultFuncs, api, ctx) => fn`; `buildAPI` loads them all and registers
   `api[<filename>]`. This is asserted by `test/buildapi.test.js`.
2. **One makeDefaults per login** — the shared instance owns the process-wide
   `__req` counter; modules must not create their own.
3. **One connection owner per ctx** — `ctx.mqttClient` is the single handle;
   `global.mqttClient` was removed (cross-account hazard). Opening a second
   listener force-closes the first (with a warning).
4. **Bounded state** — every per-message cache is FIFO-bounded
   (`e2ee/core/bounded-store.js`, cap 5000); thread-type hints live in
   `ctx.threadTypes` (bounded by thread count in practice).
5. **Reconnect policy** — exponential backoff (2 s × 2^n, capped 30 s, ±50 %
   jitter), bounded by `reconnectMaxAttempts` (default 5); a successful
   connect resets the chain; `stopListening()` cancels everything and is
   always acknowledged.
6. **No global side effects at require time** — no `console.log` hijack, no
   SIGINT handlers, no timers, no network. Enforced by tests.
7. **Request/response contract** — `http-client` returns
   `{statusCode, headers, body(string), request:{uri, headers, formData, method}}`;
   GET follows redirects, other methods surface them (login flows read
   `headers.location`).

## Data flow (send a message)

```
api.sendMessage(msg, threadID)
  → isE2EE JID? → e2ee bridge.sendMessage/sendMedia (Signal protocol)
  → else sendViaMqtt:
      publish /ls_req (qos 1) with request_id
      await matching /ls_resp (timeout 15 s → err.code=MQTT_ACK_TIMEOUT,
      NO automatic re-send)
  → on transport failure only: api.OldMessage (HTTP mercury send)
```

## Data flow (receive a delta)

```
WebSocket → createMqttPatchStream (clears FB's illegal flag bits)
  → mqtt client 'message' → /t_ms deltas → parseDelta
      → formatDeltaMessage / formatDeltaEvent (utils.js)
      → globalCallback → consumer's listen callback / emitter
  malformed payloads → {type:"parse_error"} events, never crashes
```

## Concurrency & ordering

- Delta batches are processed sequentially in arrival order.
- Async enrichments (forced-fetch of replied-to messages, photo URL
  resolution) complete out of band; the enriched event is emitted when ready —
  ordering across those events is best-effort (platform limitation).
- HTTP calls have a 60 s socket timeout; MQTT connect timeout 12 s; /t_ms
  sync timeout 5 s (configurable).
