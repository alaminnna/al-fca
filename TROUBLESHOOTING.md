# Troubleshooting

## Login & appstate

**"Your cookiestate is not valid!"**
The appstate has no usable `c_user`/`i_user` cookie. Export a fresh appstate
from a browser session you control. Note: `expirationDate` may be epoch
seconds or an ISO string — both are handled since 2.0.1.

**"Appstate is dead, change it!"**
Facebook served a checkpoint/block page for your cookies. The session is
flagged; log in manually in a browser, complete any checks, export a new
appstate. Do not try to automate around checkpoints.

**Login promise never resolves / nothing happens**
Since 2.0.1 this means validation failed fast — you get a rejection:
`login: no credentials given…`. Pass `{ appState }` or `{ email, password }`.
If a Promise-based call truly never settles, file a bug with the sanitized log.

**Email/password login ignores my options**
Credentials logins force `forceLogin: true` and keep logs quiet on that path
only; appState logins honor your options as given.

## Listening / MQTT

**`stop_listen` error event: "reconnect attempts exhausted"**
The connection could not be re-established within
`reconnectMaxAttempts` (default 5, exponential backoff). Check connectivity,
then call `api.listenMqtt(cb)` again to re-listen. Tune with
`reconnectMaxAttempts` / `reconnectBaseDelayMs` (ms).

**"t_ms sync response timeout"**
Connected, but Facebook never sent the sync-queue response. Treated as a
transport failure (same backoff path). Persistent occurrences usually mean the
session is rate-limited or the sequence ID is stale — re-login with a fresh
appstate.

**`parse_error` events**
Malformed/unexpected payloads are reported through the listener callback as
`{ error, detail, res, type: "parse_error" }` instead of crashing the process
(2.0.1 behaviour change — before, these killed the host). If you see many,
capture `detail` and open an issue.

**Duplicate message events after reconnecting**
Should not happen since 2.0.1 (bounded reconnect + stop guard). If it does,
note the `lastSeqId` handling: on a fresh listen `ctx.syncToken` is reset and
Facebook replays recent deltas — that replay is expected once, not per cycle.

**My bot reacts to its own messages**
Set `selfListen: true` explicitly to *allow* seeing your own messages; default
is `false`. Events from yourself are filtered by `senderID`.

## Sending

**`MQTT client not available — call api.listenMqtt() before sending`**
MQTT-based sends require an active listener connection (HTTP fallback exists
only inside `sendMessage`). Start listening first.

**`sendMessage` rejects with `MQTT_ACK_TIMEOUT`**
The `/ls_resp` acknowledgement didn't arrive within 15 s. The message may
still have been delivered — deliberately **no automatic retry** (it used to
cause double-sends). Check delivery in the app; retry manually if truly
absent.

**"Disallowed props: …"**
`sendMessage` accepts: `body`, `attachment`, `url`, `sticker`, `emoji`,
`emojiSize`, `mentions`, `location`, `replyToMessage`,
`forwardAttachmentIds`.

**Mentions not rendering**
Both forms are supported since 2.0.1: classic object `{ "<uid>": "@tag" }` and
array `[{ id, tag, fromIndex }]`. The tag must literally appear in `body`.

**Attachment upload says "should be a readable stream"**
Pass `fs.createReadStream(path)`, a `Buffer`, or a `PassThrough` — not a URL
string and not a plain object.

## Accounts: multiple instances

Two accounts in one process are supported (each `login()` returns an
independent `api`/`ctx`). Since 2.0.1 per-instance state (MQTT handles,
sequence IDs, E2EE bridges) is isolated; do not share `ctx` objects and do not
rely on `global.mqttClient` (removed).

## E2EE

**"e2eeMemoryOnly is not supported…"**
The current backend always persists device keys at `./.al-fca-e2ee/device.json`
(mode 0600) or `e2eeDevicePath`. The warning is informational.

**E2EE never becomes fully ready**
Handshake failures are wrapped in `E2EESessionError` (Noise handshake timeout /
login failure). Verify the device file is not corrupt (delete it to re-derive),
and that `fb_dtsg` was available at login (see `getFreshDtsg`).

**Decrypted media URLs stop working**
Cache entries expire after 10 minutes and the cache is byte-capped. Re-fetch
via `api.resolveE2EEAttachment(att)` or copy the buffer out immediately.

## Logging

`logLevel` strings: `silent`, `error`, `warn`, `info` (default), `debug`/
`verbose`, `silly`. Env override: `AL_FCA_LOG_LEVEL`. The library writes to
**stderr** and no longer takes over `console.log` — pipe stdout/stderr
separately if you need machine-readable output.

## Migration from 2.0.0 (auto-update users)

The auto-update system was removed for security (it ran `npm install` and
killed your process without consent). Update explicitly:

```bash
npm install al-fca@latest
```

Optional, notify-only reminder: `login(appState, { autoUpdateCheck: true })`.
