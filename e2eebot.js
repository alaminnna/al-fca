#!/usr/bin/env node
"use strict";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AL-FCA E2EE Test Bot (FB-Messenger-E2EE powered)
 * ═══════════════════════════════════════════════════════════════════════════
 *  Uses the PUBLIC AL-FCA api — no native bridge, no lib/ import.
 *
 *  1. Put your cookies in ./appstate.json (preferred) or ./cookie.txt (JSON)
 *  2. Run:  node e2eebot.js
 *  3. Send an encrypted (default-on) chat from Messenger — commands:
 *     !ping  !info  !echo <text>  !react  !image  !s  !typing  !seen  !help
 *
 *  !s works on a REPLY to an image: the bot downloads that encrypted image
 *  and sends it back to you (image echo).
 *
 *  Replies go through api.sendMessage() on the E2EE thread JID, which the
 *  library auto-routes through the encrypted transport.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const login = require("./index.js");

const PREFIX = "!";

// ── Load appState ────────────────────────────────────────────────────────────
function loadAppState() {
    const appstatePath = path.join(__dirname, "appstate.json");
    const cookiePath = path.join(__dirname, "cookie.txt");

    if (fs.existsSync(appstatePath)) {
        const data = JSON.parse(fs.readFileSync(appstatePath, "utf8"));
        if (!Array.isArray(data)) throw new Error("appstate.json must be a JSON array of cookies");
        console.log(`[COOKIES] ✓ Loaded ${data.length} cookies from appstate.json`);
        return data;
    }

    if (fs.existsSync(cookiePath)) {
        const data = JSON.parse(fs.readFileSync(cookiePath, "utf8").trim());
        if (!Array.isArray(data) || data.length === 0) throw new Error("cookie.txt must be a JSON cookie array");
        console.log(`[COOKIES] ✓ Loaded ${data.length} cookies from cookie.txt`);
        return data;
    }

    throw new Error("No appstate.json or cookie.txt found next to e2eebot.js");
}

// ── Command handlers (replies are encrypted automatically on E2EE threads) ──
let api = null;

const replyImageAttachmentsByMessageId = new Map();

function cacheE2EEAttachments(event) {
    if (event && event.messageID && Array.isArray(event.attachments) && event.attachments.length) {
        replyImageAttachmentsByMessageId.set(String(event.messageID), event.attachments);
        if (replyImageAttachmentsByMessageId.size > 200) {
            const oldest = replyImageAttachmentsByMessageId.keys().next().value;
            replyImageAttachmentsByMessageId.delete(oldest);
        }
    }
}

function e2eeMediaType(att) {
    const t = (att && att.type) || "image";
    if (t === "photo") return "image";
    if (t === "file") return "document";
    if (t === "sticker") return "image";
    return t;
}

function handleResendImage(event) {
    const replyTo = event.messageReply && event.messageReply.messageID
        ? String(event.messageReply.messageID)
        : null;
    console.log("   !s replyTo:", replyTo || "(no reply reference on this message)");
    if (!replyTo) {
        api.sendMessage("❌ !s kono image-er reply-e dite hobe.", event.threadID);
        return;
    }
    const atts = replyImageAttachmentsByMessageId.get(replyTo) || [];
    const att = atts.find(a => a && a.directPath && a.mediaKey) || null;
    console.log("   !s cached attachments for", replyTo + ":", atts.length);
    if (!att) {
        api.sendMessage("❌ Oi message-er image paini (hoyto bot restart hoyeche, abar image pathan).", event.threadID);
        return;
    }

    console.log("   !s downloading:", att.directPath);
    api.downloadE2EEMedia({
        directPath: att.directPath,
        mediaKey: att.mediaKey,
        mediaSha256: att.mediaSha256,
        mediaEncSha256: att.mediaEncSha256 || undefined,
        mediaType: e2eeMediaType(att),
        mimeType: att.mimeType
    }).then((res) => {
        const { Readable } = require("stream");
        const stream = Readable.from(res.data);
        stream.path = "echo" + (att.mimeType === "image/png" ? ".png" : ".jpg");
        if (att.mimeType) stream.mimeType = att.mimeType;
        api.sendMessage({ body: "↩️ E2EE image echo", attachment: stream }, event.threadID, (sendErr) => {
            if (sendErr) console.error("❌ [send]", sendErr && sendErr.message ? sendErr.message : sendErr);
            else console.log("✓ [send] Echo image sent (encrypted)");
        });
    }).catch((e) => {
        console.error("❌ [!s download]", e && e.message ? e.message : e);
        api.sendMessage("❌ Image download failed: " + (e && e.message ? e.message : e), event.threadID);
    });
}

function buildReply(cmd, args, event) {
    switch (cmd) {
        case "ping":
            return "🏓 Pong! E2EE bot is alive (encrypted).";
        case "info":
            return "ℹ️ Message Info:\n" +
                `├─ Message ID: ${event.messageID || "N/A"}\n` +
                `├─ Sender: ${event.senderID}\n` +
                `├─ Thread: ${event.threadID}\n` +
                `├─ Type: ${event.isGroup ? "👥 GROUP (E2EE)" : "👤 DM (E2EE)"}\n` +
                `└─ Time: ${new Date(event.timestamp || Date.now()).toLocaleString()}`;
        case "echo":
            return "🔊 Echo: " + (args.join(" ") || "(nothing to echo)");
        case "react":
            if (!event.messageID) return "❌ No messageID on this event.";
            api.setMessageReaction("❤️", event.messageID, () => {}, true);
            return null; // reaction sent, no reply message
        case "help":
        default:
            return "📋 E2EE Bot Commands:\n" +
                "├─ !ping  - Test bot response\n" +
                "├─ !info  - Show message info\n" +
                "├─ !echo <text> - Echo message\n" +
                "├─ !react - React ❤️ to your message\n" +
                "├─ !image - Send an encrypted photo\n" +
                "├─ !s - Resend the image you replied to\n" +
                "├─ !typing - Show typing for 10s\n" +
                "├─ !seen - Mark thread as read\n" +
                "└─ !help  - Show this help\n\n" +
                "🔐 All replies are end-to-end encrypted.";
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
try {
    const appState = loadAppState();

    login(
        { appState },
        {
            enableE2EE: true,      // 🔐 route E2EE JIDs through the encrypted transport
            listenEvents: true,
            autoMarkRead: true,
            selfListen: false
        },
        (err, _api) => {
            if (err) {
                console.error("❌ [login]", err && err.message ? err.message : err);
                process.exit(1);
            }
            api = _api;

            console.log("✅ [login] Logged in as", api.getCurrentUserID());

            api.listenMqtt((listenErr, event) => {
                if (listenErr) return console.error("❌ [listen]", listenErr && listenErr.message ? listenErr.message : listenErr);
                if (!event || typeof event !== "object") return;

                // E2EE lifecycle events (surfaced through the same listener)
                if (event.type === "e2ee_connected") {
                    console.log("🔐 [e2ee] Encrypted stream connected");
                    return;
                }
                if (event.type === "e2ee_fully_ready") {
                    console.log("🔐 [e2ee] Fully ready — device keys active");
                    return;
                }
                if (event.type === "e2ee_disconnected") {
                    console.log("⚠️ [e2ee] Disconnected — auto-reconnecting");
                    return;
                }

                if (event.type !== "e2ee_message") return;

                // Encrypted incoming message (fields printed selectively —
                // no JSON.stringify, so no BigInt serialization issues)
                console.log("─".repeat(55));
                console.log("🔐 [e2eeMessage] from", event.senderID, "in", event.threadID);
                console.log("   body:", event.body || "(no text)");
                if (event.messageReply && event.messageReply.messageID) {
                    console.log("   replyTo:", event.messageReply.messageID);
                }
                if (event.attachments && event.attachments.length) {
                    console.log("   attachments:", event.attachments.map(a => a.type).join(", "));
                }
                cacheE2EEAttachments(event);
                api.markAsRead(event.threadID, (readErr) => {
                    if (readErr) console.error("❌ [auto-seen]", readErr && readErr.message ? readErr.message : readErr);
                });

                const body = (event.body || "").trim();
                if (!body.startsWith(PREFIX)) return;

                const args = body.slice(PREFIX.length).trim().split(/\s+/);
                const cmd = (args.shift() || "").toLowerCase();
                console.log("   command:", cmd);

                if (cmd === "s") {
                    handleResendImage(event);
                    return;
                }

                if (cmd === "typing") {
                    api.sendTypingIndicator(true, event.threadID, () => {});
                    console.log("   typing on for 10s");
                    setTimeout(() => {
                        api.sendTypingIndicator(false, event.threadID, () => {});
                        console.log("   typing off");
                    }, 10000);
                    return;
                }

                if (cmd === "seen") {
                    api.markAsRead(event.threadID, (seenErr) => {
                        if (seenErr) console.error("❌ [seen]", seenErr && seenErr.message ? seenErr.message : seenErr);
                        else console.log("✓ [seen] thread marked as read");
                    });
                    return;
                }

                // !image — send an encrypted photo (assets/e2eeconnect.png)
                if (cmd === "image") {
                    try {
                        const imgPath = path.join(__dirname, "assets", "e2eeconnect.png");
                        if (!fs.existsSync(imgPath)) {
                            console.error("❌ [image] file not found:", imgPath);
                            return;
                        }
                        api.sendMessage(
                            { body: "🖼️ Encrypted image", attachment: fs.createReadStream(imgPath) },
                            event.threadID,
                            (imgErr) => {
                                if (imgErr) console.error("❌ [send]", imgErr && imgErr.message ? imgErr.message : imgErr);
                                else console.log("✓ [send] Encrypted image sent");
                            }
                        );
                    } catch (e) {
                        console.error("❌ [image]", e && e.message ? e.message : e);
                    }
                    return;
                }

                try {
                    const reply = buildReply(cmd, args, event);
                    if (!reply) return;
                    api.sendMessage(reply, event.threadID, (sendErr) => {
                        if (sendErr) console.error("❌ [send]", sendErr && sendErr.message ? sendErr.message : sendErr);
                        else console.log("✓ [send] Encrypted reply sent");
                    });
                } catch (e) {
                    console.error("❌ [handler]", e && e.message ? e.message : e);
                }
            });

            // Device key material persists at .al-fca-e2ee/device.json —
            // keep that file to stay the same registered E2EE device.
            api.getE2EEDeviceData((devErr) => {
                if (devErr) console.error("❌ [e2ee-device]", devErr && devErr.message ? devErr.message : devErr);
            });
        }
    );
} catch (e) {
    console.error("❌ [setup]", e && e.message ? e.message : e);
    process.exit(1);
}
