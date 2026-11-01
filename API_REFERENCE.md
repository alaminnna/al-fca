# API Reference

Only behaviour that has been verified (by the offline test suite or direct code
review) is documented here. Verification levels are defined in
[API_COMPATIBILITY.md](API_COMPATIBILITY.md). For the full 97-method inventory
with per-method status, see that file.

## login(loginData, options?, callback?)

**Tested (offline load path).**

```js
const login = require("al-fca");

// Recommended: appState (cookies)
login({ appState: require("./appstate.json") }, {
  selfListen: false,        // see options table below
  listenEvents: true,
  autoReconnect: true,
}, (err, api) => { /* ... */ });

// Promise form (omit the callback)
const api = await login({ appState });

// Email/password (forces forceLogin; credentials go only to facebook.com)
await login({ email: "...", password: "..." });
```

| Param | Notes |
|---|---|
| `loginData.appState` | Array of cookies as exported by browser extensions. Epoch or ISO `expirationDate` both accepted (2.0.1 fix). |
| `loginData.email` / `password` | Interactive path; 2FA checkpoint returns `{ error: "login-approval", continue(code) }`. |
| `options` | See table. |
| `callback` | `(error, api)`; omit for a Promise. |

**Errors:** missing credentials → immediate rejection (2.0.1 fix: no more
silent hang). Invalid cookies → "Your cookiestate is not valid!".

### Options

| Option | Default | Meaning |
|---|---|---|
| `selfListen` | `false` | Receive your own messages. |
| `listenEvents` | `true` | Non-message deltas (reactions, unsends, thread events). |
| `autoReconnect` | `true` | Bounded reconnect (see `reconnectMaxAttempts`). |
| `reconnectMaxAttempts` | `5` | Attempts before a `stop_listen` error event. |
| `reconnectBaseDelayMs` | `2000` | Backoff base (2^n × base, cap 30 s, ±jitter). |
| `mqttTmsTimeoutMs` | `5000` | Sync-queue response timeout. |
| `autoMarkDelivery` / `autoMarkRead` | `false` | Ack/read receipts for received messages. |
| `online` / `updatePresence` | `false` | Presence broadcasting. |
| `emitReady` | `false` | Emit `{type:"ready"}` after sync queue creation. |
| `forceLogin` | `false` | "This was me" checkpoint auto-confirm (password logins force this). |
| `logLevel` | `"info"` | `silent|error|warn|info|debug|verbose|silly` (env: `AL_FCA_LOG_LEVEL`). |
| `userAgent` | Safari-ish UA | Sent on all requests. |
| `proxy` | — | URL string → `https-proxy-agent` (HTTP + WebSocket). |
| `enableE2EE` | `false` | Attach the E2EE bridge; `api.connectE2EE()` then available. |
| `e2eeDevicePath` | `./.al-fca-e2ee/device.json` | E2EE key persistence (mode 0600). `e2eeMemoryOnly` is NOT supported (warns). |
| `photoUrlProxy` | `false` | Opt-in hosted-URL rewriting of received photos (uses `imgbbApiKey`). |
| `autoUpdateCheck` | `false` | One notify-only registry check. |

## api.sendMessage(msg, threadID, callback?, replyToMessage?)

**Code-reviewed.** MQTT path with `/ls_resp` ack correlation (15 s), HTTP
fallback for transport failures, E2EE routing for `@`-JIDs.

```js
await api.sendMessage("hello", threadID);           // → { threadID, messageID }
await api.sendMessage({ body: "hi", mentions: { "1000": "@Name" } }, threadID);
await api.sendMessage({ body: "see pic", attachment: fs.createReadStream("a.png") }, threadID);
await api.sendMessage("reply", threadID, null, messageID);
```

- Allowed `msg` keys: `body`, `attachment`, `url`, `sticker`, `emoji`,
  `emojiSize`, `mentions`, `location`, `replyToMessage`, `forwardAttachmentIds`.
- Mentions: object (`{ "<uid>": "@tag" }`) or array (`{id, tag, fromIndex}`).
- **`MQTT_ACK_TIMEOUT`**: rejects with `err.code === 'MQTT_ACK_TIMEOUT'` — the
  message may have been delivered; the library never double-sends.
- With a callback, no Promise result is guaranteed (legacy pattern).

## api.listenMqtt(callback?) / api.listen

**Tested (fake broker).** Returns a `MessageEmitter` (also an `EventEmitter`).

```js
const stop = api.listenMqtt((error, event) => {
  if (error) return;              // {type:"parse_error"|"stop_listen"|...}
  switch (event.type) {
    case "message": /* event.body, event.threadID, event.attachments, event.mentions */ break;
    case "message_reply": case "message_unsend": case "message_reaction":
    case "typ": case "presence": case "change_thread_image":
    case "e2ee_message": /* + e2ee_* family */ break;
  }
});
await stop.stopListeningAsync();   // always resolves; tears down MQTT + E2EE
```

Event shapes match facebook-chat-api conventions (`threadID`, `messageID`,
`senderID`, `args`, `body`, `attachments`, `mentions`, `isGroup`,
`participantIDs`, `timestamp`). `parse_error` events carry `{error, detail,
res}` — report repeated occurrences.

## api.sendTypingIndicator(isTyping, threadID, callback?)

**Code-reviewed.** Publishes `/ls_req` typing state; requires a live listener.

## E2EE methods

```js
await api.connectE2EE();                    // → after e2ee_fully_ready event
const data = await api.getE2EEDeviceData(); // persistent device keys (JSON)
await api.sendMessage("hi", "61568577897207.0@msgr");   // JID → encrypted send
const media = await api.downloadE2EEMedia({ directPath, mediaKey, mediaSha256, mediaType, mimeType });
const url = await api.resolveE2EEAttachment(attachment); // loopback URL (10 min TTL)
```

Events: `e2ee_connected`, `e2ee_ready`, `e2ee_fully_ready`, `e2ee_message`,
`e2ee_message_edit`, `e2ee_message_reaction`, `e2ee_message_revoke`,
`e2ee_receipt`, `e2ee_disconnected`, `e2ee_device_data_changed`.

## Session & lifecycle

| Method | Notes |
|---|---|
| `api.getAppState()` | Cookie snapshot; persist it yourself (file perms 600, keep out of git). |
| `api.setOptions(opts)` | Runtime option updates. |
| `api.getFreshDtsg()` | Re-extract `fb_dtsg` (call roughly every 48 h). |
| `api.refreshFb_dtsg()` | Same via mobile endpoint; 2.0.1 fix: now actually takes effect. |
| `api.logout(callback?)` | Stops MQTT/E2EE, then invalidates the session server-side. |
| `api.stopListeningAsync()` | Deterministic shutdown of listener + E2EE. |
| `api.httpGet(url, form?, cb?, notAPI?)` / `api.httpPost(...)` | Raw session-authenticated requests. |

## Errors

- Validation failures throw/reject with `Error` or `utils.CustomError`
  (`{error, ...detail}`).
- HTTP 5xx are retried up to 5 times (random 0–5 s delay) inside
  `parseAndCheckLogin`, then surfaced as
  `{ error: "Request retry failed...", statusCode, res }`.
- `error === 1357001` ("Not logged in") marks `ctx.loggedIn = false`.
