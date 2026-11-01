# AL-FCA API Compatibility Report

> Generated 2026-11-01 against `@alaminnna/al-fca@2.0.1` (post-audit refactor).
> Every public method is listed with its verification status. **Honesty policy:**
> methods whose behaviour depends on live Facebook responses are marked
> *code-reviewed* — they were reviewed and statically exercised, but no live
> Facebook call was made during this audit (no real credentials were used).
> Nothing on this page is claimed to "work" without the corresponding evidence.

## Verification levels

| Level | Meaning |
|---|---|
| **tested** | Covered by the automated test suite (`test/`) — offline mocks / synthetic data. |
| **code-reviewed** | Logic reviewed, syntax/type checked, exercised where possible offline; live behaviour not verified. |
| **alias** | Same implementation under another name; inherits that method's status. |

## Entry points (tested)

| Export | Status | Notes |
|---|---|---|
| `login(loginData, options, callback?)` | tested (load/offline) | Returns Promise when no callback. Validates missing credentials (throws/rejects with guidance instead of hanging — fixed). Update check only when `options.autoUpdateCheck === true` (notify-only). |
| `login.buildAPI(globalOptions, html, jar)` | tested | Full offline build verified; 97 methods attached. |
| `login.setOptions(target, options)` | tested | Boolean coercion + `logLevel`, `logRecordSize`, `pageID`, `e2ee*`, `userAgent`, `proxy`, new `photoUrlProxy`, `autoUpdateCheck`. |

## Options (login + setOptions)

Booleans: `online`, `selfListen`, `listenEvents`, `updatePresence`, `forceLogin`,
`autoMarkDelivery`, `autoMarkRead`, `listenTyping`, `autoReconnect`, `emitReady`,
`enableE2EE`, `e2eeMemoryOnly`, **`photoUrlProxy`** (new, default off),
**`autoUpdateCheck`** (new, default off).
Values: `logLevel`, `logRecordSize`, `pageID`, `userAgent`, `proxy`,
`e2eeDevicePath`, `e2eeDeviceData`, `e2eeMediaCdnHost`,
`imgbbApiKey` (new, for explicit `uploadImageToImgbb` only),
`reconnectMaxAttempts` (new, default 5), `reconnectBaseDelayMs` (new, default 2000),
`mqttTmsTimeoutMs` (new, default 5000).

## Messaging

| Method | Status | Notes |
|---|---|---|
| `sendMessage(msg, threadID, callback?, replyToMessage?)` | code-reviewed | MQTT with `/ls_resp` ack correlation; HTTP fallback (`OldMessage`) only for transport failures. **Ack timeouts no longer trigger a re-send** (duplicate-message fix). E2EE JIDs route to the bridge. |
| `OldMessage(...)` | code-reviewed | Legacy HTTP sender, unchanged semantics. |
| `sendMessageDM(...)` | alias | → `OldMessage`. |
| `sendMessageMqtt(...)` | code-reviewed | otid overflow fixed; mentions accept object **and** array form; non-stream attachment no longer crashes the process. Returns broker publish ack (not delivery confirmation) — documented limitation. |
| `sendButtons` | code-reviewed | Unchanged. |
| `editMessage` / `editMessageOld` | code-reviewed | editMessage routes E2EE JIDs via bridge map. |
| `deleteMessage` / `unsendMessage` | code-reviewed | unsendMessage routes E2EE via bounded message map. |
| `setMessageReaction` / `setMessageReactionMqtt` / `setPostReaction` | code-reviewed | Reaction E2EE routing via bounded maps. |
| `markAsRead`, `markAsReadAll`, `markAsDelivered`, `markAsSeen` | code-reviewed | Known quirk (unchanged): these **return the error object** instead of rejecting on failure when awaited — documented in TROUBLESHOOTING. |
| `sendTypingIndicator` | code-reviewed | No longer falls back to `global.mqttClient` (cross-account hazard removed). |
| `setActiveStatus` | code-reviewed | Unchanged. |
| `forwardAttachment` | code-reviewed | Unchanged. |

## Listening

| Method | Status | Notes |
|---|---|---|
| `listenMqtt(callback?)` / `listen` | tested (fake broker) | Emits `message`/`error`/`ready`; typed events: `message`, `message_reply`, `message_unsend`, `message_reaction`, `typ`, `presence`, `change_thread_image`, thread admin events, `parse_error` (new), `stop_listen` (new, on final reconnect failure). |
| `MessageEmitter.stopListening(cb?)` | tested | Always invokes callback (even without a live client); disconnects E2EE; prevents further reconnects. |
| `MessageEmitter.stopListeningAsync()` | tested | Cannot hang anymore. |
| `stopListenMqtt(cb?)` | tested (wired) | Delegates to the emitter's teardown. |

## Threads / Users / Media (HTTP-bound)

`getThreadInfo`, `getThreadHistory`, `getThreadList`, `getThreadPictures`,
`getThreadTheme`, `getMessage`, `searchForThread`, `muteThread`, `deleteThread`,
`setTitle`, `changeThreadColor/Emoji/Theme`, `changeArchivedStatus`,
`changeAdminStatus`, `changeGroupImage`, `addUserToGroup`, `removeUserFromGroup`,
`createNewGroup`, `getUserInfo`, `getFriendsList`, `friendList`, `getCurrentUserID`,
`getUserID`, `getUID`, `searchFriends`, `suggestFriend`, `follow`, `unfriend`,
`sendFriendRequest`, `handleFriendRequest`, `handleMessageRequest`,
`changeBlockedStatus(+Mqtt)`, `changeName/Bio/Username/Nickname/Cover/Avatar(V2)/Avt`,
`setProfileLock`, `removeSuspiciousAccount`, `getAvatarUser`, `uploadAttachment`,
`resolvePhotoUrl`, `getEmojiUrl`, `searchStickers`, `metaTheme`, `threadColors`,
`storyManager`, `note`, `createPost`, `createCommentPost`, `createPoll`,
`setStoryReaction`, `setStorySeen`, `shareContact`, `shareLink`,
`getThreadHistoryDeprecated`, `getThreadInfoDeprecated`, `getThreadListDeprecated`

**Status: code-reviewed.** These are thin form-posters over the transport layer;
they all run through the same rewritten `utils.get/post/postFormData` and
`parseAndCheckLogin`. The transport itself is integration-tested. Known
duplicate implementations kept for compatibility: `changeAvt` ≈ `changeAvatar` ≈
`changeAvatarV2`; `getUID` ≈ `getUserID`; `getThreadList` ≈ `friendList` family.

## Utilities / infra

| Method | Status | Notes |
|---|---|---|
| `getAppState()` | tested (jar contract) | Cookie jar snapshot for re-login. |
| `postFormData(url, body)` | tested (transport) | Multipart upload path integration-tested. |
| `getFreshDtsg()` | code-reviewed | |
| `refreshFb_dtsg(obj?, cb?)` | code-reviewed | Now also updates `ctx.ttstamp` (jazoest refresh previously had no effect). `utils.CustomError` fixed. |
| `httpGet` / `httpPost` | tested (transport) | `notAPI` flag preserved. |
| `getAccess(authCode?, cb?)` | code-reviewed | 2FA reauth token flow; unchanged. |
| `getRegion()` | tested | |
| `addExternalModule(obj)` | code-reviewed | |
| `uploadImageToImgbb(image, {apiKey, expiration})` | code-reviewed | **Signature changed**: no hardcoded key; requires caller's `apiKey` (or `globalOptions.imgbbApiKey`). |
| `logout(cb?)` | code-reviewed | Now tears down MQTT + E2EE first. |

## E2EE surface (tested with synthetic data)

`connectE2EE(cb?)`, `getE2EEBridge()`, `getE2EEDeviceData(cb?)`,
`downloadE2EEMedia(opts)`, `resolveE2EEAttachment(att)`, `sendTypingE2EE(jid, isTyping)`.

Events: `e2ee_connected`, `e2ee_ready`, `e2ee_fully_ready`,
`e2ee_message`, `e2ee_message_edit`, `e2ee_message_reaction`,
`e2ee_message_revoke`, `e2ee_receipt`, `e2ee_disconnected`,
`e2ee_device_data_changed`.

Mappers (`e2ee/core/bridge.js::_mappers`), JID detection, bounded correlation
maps, media cache server and the protobuf media decoder are **tested**. The
Noise/Signal handshake itself (inside the vendored `FB-Messenger-E2EE` bundle)
is **not verifiable offline** — it requires a real account handshake against
`reg-e2ee.facebook.com`; treat E2EE as code-reviewed until live validation
(see `INTEGRATION_TESTING.md`).

## Deliberate behaviour changes (breaking, documented)

1. **No auto-update.** The library never installs packages, rewrites
   package.json or exits the process. `checkForFCAUpdate()` is notify-only and
   opt-in (`autoUpdateCheck: true`).
2. **No silent third-party uploads.** Received photos are never re-uploaded to
   image hosts; `photoUrlProxy: true` + your own `imgbbApiKey` enables it
   explicitly.
3. **`uploadImageToImgbb` requires your API key.**
4. **`getUID` resolves locally** (no third-party resolver services, no UA rotation).
5. **MQTT failures no longer loop forever**: bounded attempts (5) with
   exponential backoff + jitter, then a `stop_listen` error event. Tune with
   `reconnectMaxAttempts` / `reconnectBaseDelayMs`.
6. **`sendMessage` ack timeouts throw** (`err.code === 'MQTT_ACK_TIMEOUT'`)
   instead of silently re-sending via HTTP.
7. **Globals removed**: `global.ditconmemay`, `global.alfcaUpdateChecked`,
   `global.mqttClient` fallback reads. `global.GoatBot` coupling is retained
   read-only for compatibility but is no longer written at runtime by the core.
8. Dependencies replaced: `request`/`bluebird`/`undici`/`duplexify`/
   `totp-generator`/`yumi-json-bigint` removed; `form-data` + `tough-cookie`
   added. If you relied on `request` being present transitively, add it to
   your own project.

## Not implemented / known limitations

- `e2eeMemoryOnly: true` is **not supported** by the current E2EE backend —
  device keys always persist to disk (0600). The library logs a warning when
  the option is set.
- `sendMessageMqtt` returns the broker publish ack, not a delivery receipt.
- Message ordering across async forced-fetches is best-effort (inherent to the
  delta stream).
- `markAsRead`-family methods return errors as values on failure (legacy
  behaviour, kept for compatibility).
