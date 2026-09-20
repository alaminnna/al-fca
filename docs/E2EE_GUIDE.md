# AL-FCA E2EE Guide

End-to-End Encrypted Messenger chats in AL-FCA, powered by
[FB-Messenger-E2EE](https://github.com/HerokeyVN/FB-Messenger-E2EE)
(Signal Protocol + Noise transport + WA-binary framing, pure JavaScript —
no native binary download required).

> **"E2EE" here means Facebook Messenger's end-to-end encrypted conversation
> protocol** (the encrypted counterpart of normal Messenger chats), not a
> generic encryption library.

---

## 1. Installation

```bash
npm install al-fca
```

A normal `npm install` is enough. The only cryptography dependency is the
official `@signalapp/libsignal-client` (Signal's own audited addon, with
prebuilt binaries for Windows / Linux / macOS) plus pure-JS `protobufjs` and
`ws`. There is no custom Go/native binary anymore.

Node.js **18+** is required (Node 22 recommended).

## 2. How it fits together

```
                    AL-FCA (this package)
                       |
          +------------+-------------+
          |                          |
     Normal Chat                 E2EE Chat
  (existing FCA/MQTT        (e2ee/ integration layer)
   implementation)                   |
                        FB-Messenger-E2EE (vendored build
                        in e2ee/vendor/fbme/)
                                     |
              +----------------------+----------------------+
              |                      |                      |
        Signal Protocol           Noise XX           Messenger E2EE
     (sessions, prekeys,      (encrypted WebSocket   (WA-binary nodes,
      sender keys)             transport)             protobuf payloads)
```

- **Normal threads** (bare numeric thread IDs) use the existing FCA
  HTTP/MQTT implementation — unchanged.
- **E2EE threads** (JIDs containing `@`, e.g. `61568577897207.0@msgr` for DMs
  or `…@g.us` for groups) are routed automatically through the encrypted
  transport. Legacy colon JIDs (`61568577897207:69@msgr`) also route.
- The rest of AL-FCA never touches Signal/Noise/protobuf internals; the
  adapter in `e2ee/` encapsulates everything.

The `FB-Messenger-E2EE/` source checkout in this repo is a **development-only
reference**. Runtime code uses the prebuilt bundle in `e2ee/vendor/fbme/`, so
that folder can be deleted without breaking anything. To rebuild the bundle
from source: `npm run build:e2ee` (requires the source folder + network).

## 3. Configuration

Enable E2EE in login options or `config.json`:

```javascript
login({ appState }, {
    enableE2EE: true,
    e2eeDevicePath: "./.al-fca-e2ee/device.json",  // optional; this is the default
    e2eeMediaCdnHost: "https://mmeg.facebook.com", // optional; default shown
    listenEvents: true
}, callback);
```

`config.json` equivalent:

```json
{
    "e2ee": {
        "enable": true,
        "devicePath": "./.al-fca-e2ee/device.json"
    }
}
```

| Option | Default | Meaning |
|---|---|---|
| `enableE2EE` | `false` (unless `config.json` enables it) | Route `@`-JIDs through the encrypted transport |
| `e2eeDevicePath` / `e2ee.devicePath` | `./.al-fca-e2ee/device.json` | Where device identity + Signal sessions persist (file mode 0600) |
| `e2eeDeviceData` / `e2ee.deviceData` | — | Previously exported device JSON to seed a fresh path (object or JSON string) |
| `e2eeMediaCdnHost` | `https://mmeg.facebook.com` | Host prepended to relative E2EE media `directPath`s for download |
| `e2eeMemoryOnly` | ignored | The new backend always persists the device file (a warning is logged). Memory-only mode is **not supported** — see §9 |

## 4. Authentication & lifecycle

E2EE reuses your normal AL-FCA login — **no second login happens**. The adapter
injects the already-authenticated `api` into the E2EE client for CAT bootstrap
and cookie material only.

```javascript
login({ appState }, { enableE2EE: true }, (err, api) => {
    if (err) return console.error(err);

    // Option A: let listenMqtt connect E2EE automatically
    api.listenMqtt((err, event) => { /* e2ee_* events arrive here */ });

    // Option B: connect manually (e.g. send-only bots)
    api.connectE2EE(() => console.log("encrypted stream ready"));
});
```

With `listenMqtt`, the bridge connects automatically and reconnects (5 s delay)
if the encrypted stream drops. `api.getE2EEBridge()` returns the live bridge;
`api.getE2EEDeviceData(cb)` returns the persisted device JSON
(`noise_key_priv`, `identity_key_priv`, `registration_id`, `pre_keys`,
`sessions`, `sender_keys`, …).

## 5. Sending E2EE messages

Just send to the E2EE thread JID (the `threadID` of received `e2ee_message`
events) — routing is automatic:

```javascript
// Encrypted DM (auto-detected: threadID contains "@")
api.sendMessage("hello (encrypted)", "61568577897207.0@msgr");

// With reply + attachment
api.sendMessage(
    { body: "see this", attachment: fs.createReadStream("./photo.jpg") },
    "61568577897207.0@msgr"
);

// Explicit helpers (same result)
api.setMessageReaction("❤️", messageID);
api.editMessage("new text", messageID);
api.unsendMessage(messageID);
api.sendTypingE2EE("61568577897207.0@msgr", true);
```

Group E2EE threads (`…@g.us`) support text, reactions, edits, revokes and
typing. **Encrypted group media is not supported by the underlying
implementation** (it throws a clear `E2EEMediaError`).

## 6. Receiving E2EE messages

Encrypted events arrive through the same `listenMqtt` callback, shaped exactly
like before (`isE2EE: true`):

```javascript
api.listenMqtt((err, event) => {
    if (event.type === "e2ee_message") {
        console.log(event.body, event.threadID, event.attachments);
        api.sendMessage("got it: " + event.body, event.threadID); // encrypted reply
    }
    if (event.type === "e2ee_message_reaction") console.log(event.reaction);
    if (event.type === "e2ee_message_edit") console.log(event.body);
});
```

Event reference: `e2ee_message`, `e2ee_message_edit`, `e2ee_message_reaction`,
`e2ee_message_revoke` (new, additive), `e2ee_receipt`, `e2ee_connected`,
`e2ee_ready`, `e2ee_fully_ready`, `e2ee_device_data_changed`,
`e2ee_disconnected`. Decryption failures are delivered as _errors_ tagged
`E2EE_DECRYPTION` — never as fake plaintext.

## 7. Encrypted media

Received E2EE attachments carry `directPath` + `mediaKey` + hashes. Resolve
them to a local URL before use:

```javascript
if (event.type === "e2ee_message" && event.attachments.length) {
    const att = await api.resolveE2EEAttachment(event.attachments[0]);
    console.log(att.url); // http://127.0.0.1:<port>/e2ee/<id> (decrypted, 10-min TTL)
}
```

Lower-level: `api.downloadE2EEMedia({ directPath, mediaKey, mediaSha256,
mediaEncSha256, mediaType, mimeType })` returns `{ data, mimeType, fileSize }`.

Note: received media URLs from the protocol are relative CDN paths, so the
configured `e2eeMediaCdnHost` is prepended (absolute URLs pass through
unchanged). If downloads fail in your region, override the host.

## 8. Devices, sessions, storage

- Identity, sessions, prekeys, signed prekeys and group sender keys persist in
  the device JSON file (mode 0600). **Keep it to stay the same registered
  device**; deleting it registers a fresh device (new Noise key, new Signal
  identity, new `facebook_uuid`) and drops existing sessions.
- Prekey replenishment is automatic.
- Custom stores: point `e2eeDevicePath` anywhere writable, or seed
  `e2eeDeviceData`.
- Errors are typed: `E2EEInitializationError`, `E2EESessionError`,
  `E2EEEncryptionError`, `E2EEDecryptionError`, `E2EEMediaError` — context is
  included, but private keys/session secrets/plaintext are never logged.

## 9. Support matrix

| Feature | Status | Notes |
|---|---|---|
| Normal Messenger send/receive | ✅ SUPPORTED | Unchanged FCA/MQTT path |
| E2EE DM text / reply | ✅ SUPPORTED | Auto-routed by JID |
| E2EE group text | ✅ SUPPORTED | Sender-key fanout + retry receipts |
| E2EE reactions / edits / revokes / receipts | ✅ SUPPORTED | Same event shapes as before |
| E2EE typing indicators | ✅ SUPPORTED | `api.sendTypingE2EE` / auto in `sendMessage` |
| E2EE image/video/audio/document send (DM) | ✅ SUPPORTED | Per-device encrypted fanout |
| E2EE media receive + decrypt | ✅ SUPPORTED | Via `resolveE2EEAttachment` / `downloadE2EEMedia` |
| E2EE stickers | ⚠️ PARTIALLY | Sent as encrypted images (webp frames); identical on the wire |
| E2EE group media | ❌ NOT SUPPORTED | Underlying implementation throws `E2EEMediaError` |
| `e2eeMemoryOnly` (ephemeral keys) | ❌ NOT SUPPORTED | New backend always persists the device file (warns once) |
| Text-message @mentions over E2EE | ⚠️ PARTIALLY | Not surfaced by the protocol decoder; media captions keep mentions |
| Old messagix device files | ❌ NOT SUPPORTED | Schema differs; re-register once (new device file) |
| Windows / Linux / macOS | ✅ SUPPORTED | No custom native binary; Signal addon has prebuilds |

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `ENOENT ... .al-fca-e2ee/device.json` | Fixed in v1.3.0 — the adapter now creates the directory. Update. |
| `Unrecognized option: enableE2EE` | Fixed in v1.3.0 — `setOptions` now accepts E2EE flags. Update. |
| `Do not know how to serialize a BigInt` | Retired with the native bridge (v1.3.0). The old `e2eebot.js` stringified native-bridge events; the new bot and bridge emit plain values only. |
| `E2EE is disabled…` | Set `enableE2EE: true` in login options or `e2ee.enable` in config. |
| `E2EE Noise handshake failed` | Session expired or network blocked; re-login and retry. Never delete the device file as a first resort. |
| `E2EE media download failed: HTTP …` | Try overriding `e2eeMediaCdnHost`. |
| `Media upload failed: all hosts unreachable (h1 (…), …)` | The reason per host is shown: DNS failure → check DNS/firewall; TLS failure → check clock/proxy; connection timeout → ISP may block the upload CDN. If you use a proxy for Facebook traffic, note the upload uses direct `fetch` (proxy env vars are not applied). |
| `E2EEMediaError: Unsupported E2EE mediaType` | Only image/video/audio/voice/file/document/sticker are supported. |

## 11. Test bot

```bash
node e2eebot.js   # needs appstate.json or cookie.txt next to it
```

Commands: `!ping` `!info` `!echo <text>` `!react` `!image` `!s` `!typing` `!seen` `!help`. Replies to
`e2ee_message` events are automatically encrypted. `!s` must be sent as a
**reply** to an image — the bot downloads that encrypted image and sends it
back. `!typing` shows the typing indicator for 10 s; `!seen` marks the thread
read (incoming E2EE messages are auto-marked read too).

## 12. Security notes

- Real cryptography only: Signal Protocol + Noise from the vendored
  implementation. No custom ciphers, no insecure fallbacks, no silent
  downgrade to plaintext — if E2EE fails, the send/receive fails loudly.
- Never commit `.al-fca-e2ee/device.json`, `appstate.json`, or `cookie.txt`.
- The `FB-Messenger-E2EE/` source folder in this repo is a development
  reference; runtime uses `e2ee/vendor/fbme/`. The vendored bundle's license
  is AGPL-3.0-or-later (see `FB-Messenger-E2EE/LICENSE`); AL-FCA's own code
  remains MIT.
