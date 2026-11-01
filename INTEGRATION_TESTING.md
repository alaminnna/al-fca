# Real-World Integration Testing Procedure

> **Read this before any live test.** Automated tests (test/) never touch
> Facebook. This document describes the *manual* procedure for validating the
> library against the real service — using only accounts you own and
> operations you are authorized to perform.

## Ground rules (non-negotiable)

1. **Authorized accounts only.** Use a test account that you own or administer.
   Never drive automation against other people's accounts without their consent.
2. **No unsolicited messaging.** Send only to threads you control (a group you
   created, your own "Saved"/notes thread, a second account you own).
3. **No stealth/evasion features** — AL-FCA contains none by design, and none
   may be added for testing (no proxy rotation, no fingerprint spoofing, no
   CAPTCHA bypass, no ban circumvention).
4. **Stop immediately** on any unexpected login challenge (checkpoint,
   2FA prompt, device-verification email). A challenge during a *cookie*
   login means the session was flagged — stop, don't fight it.
5. **Prefer Meta's official Messenger Platform API** for any production
   integration. AL-FCA is an unofficial user-session automation library; use
   it for personal bots on accounts you own.

## Phase A — environment verification (no login)

```bash
node --version            # >= 18 required (engines field)
npm ci                    # reproducible install from package-lock.json
npm test                  # 61 tests, no network access needed
npm audit --omit=dev      # expect: found 0 vulnerabilities
node -e "console.log(typeof require('@alaminnna/al-fca'))"   # 'function'
```

## Phase B — credential isolation

1. Put the appstate in a file **outside** the git working tree, or confirm
   `.gitignore` covers it (`.gitignore` ignores `appstate.json`, `config.json`,
   `cookie.txt`, `.al-fca-e2ee/`).
2. `chmod 600 appstate.json` — cookie files must not be world-readable.
3. `git status --porcelain` must not list any credential file.
4. Never paste appstate contents into chat, tickets, or logs. Error messages in
   AL-FCA do not print cookies; if you ever see one that does, that is a bug —
   file it, don't work around it.

## Phase C — smoke login (non-destructive)

```js
const login = require("@alaminnna/al-fca");
const fs = require("fs");

login({ appState: JSON.parse(fs.readFileSync(process.env.APPSTATE_FILE, "utf8")) }, {
  selfListen: true,          // do NOT react to your own messages
  listenEvents: false,
  autoReconnect: true,
  online: false,             // do not broadcast presence
  autoMarkRead: false,       // do not mark anything read
  autoMarkDelivery: false,
  logLevel: "info",
})
  .then((api) => {
    console.log("logged in as", api.getCurrentUserID());
    // Do nothing else. Close cleanly.
    return api.logout();     // or api.stopListeningAsync()
  })
  .then(() => console.log("smoke test OK"))
  .catch((e) => { console.error("smoke test failed:", e.message); process.exit(1); });
```

Expected: `logged in as <your id>`, no exceptions. If this fails with
"Your cookiestate is not valid" the appstate is expired — regenerate it from a
browser you control (export cookies after a normal login).

## Phase D — listener validation (messages only to yourself)

1. Start listening (`api.listenMqtt(cb)` with a callback that just logs event
   types).
2. From the **same account** (phone app), send one message to yourself / a
   group of which the test account is the only bot participant.
3. Verify: exactly one `message` event per send, correct `threadID`,
   `senderID`, `body`; no duplicate delivery after an idle minute.
4. Send a photo: verify the attachment object (type `photo`) — note the URL is
   a Facebook CDN URL; AL-FCA does **not** re-upload it anywhere (see
   `photoUrlProxy` in API_COMPATIBILITY.md).
5. Kill your network for ~15 s: verify the WARN reconnect logs (backoff), then
   recovery; or a `stop_listen` error after `reconnectMaxAttempts` exhausted.
6. Call `api.stopListeningAsync()`; verify the process can exit and no socket
   keeps the loop alive (`process._getActiveHandles()` inspection optional).

## Phase E — send validation

1. Send one text message to your own notes/Saved thread via `api.sendMessage`.
2. Verify single delivery in the app. **Double delivery means a bug** — the
   ack-timeout re-send fix should prevent it; report it.
3. Send with an attachment (one small PNG via `fs.createReadStream`).
4. Send with a mention (both `{id: tag}` object form and array form).
5. Do **not** bulk-send, do not send to strangers, do not test rate limits.

## Phase F — E2EE (only if you accept the risk model)

E2EE requires a device-key handshake (`enableE2EE: true`). During validation:

1. Confirm the device file was created at `./.al-fca-e2ee/device.json` with
   mode 0600 and is gitignored.
2. `e2ee_connected` → `e2ee_ready` → `e2ee_fully_ready` events must arrive.
3. Send an E2EE message between two of your own devices/apps; verify
   decryption on the receiving side and that the message renders as encrypted
   for anyone else.
4. Record sanitized logs only (no JIDs beyond your own test accounts).

## Recording results

Log template (sanitized — replace IDs/handles):

```
date, node version, package version
A: env checks         PASS/FAIL
B: credential isolation PASS/FAIL (git status clean, perms 600)
C: smoke login        PASS/FAIL
D: listener           events ok / duplicates? / reconnect behaviour
E: send               single delivery / attachment / mentions
F: e2ee               handshake / round-trip / (skipped?)
issues: <free text>
```

If any step fails, stop, capture the sanitized log, and file an issue at
https://github.com/alaminnna/al-fca/issues — do not attempt workarounds that
involve bypassing challenges or rate limits.
