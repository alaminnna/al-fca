"use strict";
var utils = require("../../utils");
var log = require("../core/logger");
var mqtt = require('mqtt');
var WebSocket = require('ws');
var Transform = require('stream').Transform;
var EventEmitter = require('events');
var e2eeBridge = require("../../e2ee");

// ─── ANSI colour helpers ───────────────────────────────────────────────────────
var C = {
    reset:   '\x1b[0m',
    bold:   '\x1b[1m',
    dim:     '\x1b[2m',
    bCyan:   '\x1b[96m',
    bGreen:  '\x1b[92m',
    bWhite:  '\x1b[97m',
    bYellow: '\x1b[93m',
    bMagenta:'\x1b[95m',
    bBlue:   '\x1b[94m',
    bRed:    '\x1b[91m',
    cyan:    '\x1b[36m'
};

var TTY = !!(process.stdout && process.stdout.isTTY);

function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (_) { return fallback; }
}

// ─── MQTT connecting spinner (TTY only) ────────────────────────────────────────
var _mqttSpinner = null;

function startMqttSpinner(region) {
    if (!TTY) return;
    var frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    var fi = 0;
    var regionStr = region ? (' ' + C.dim + C.bCyan + '[' + region.toUpperCase() + ']' + C.reset) : '';
    process.stdout.write('\n');
    _mqttSpinner = setInterval(function () {
        var frame = frames[fi++ % frames.length];
        process.stdout.write(
            '\r  ' +
            C.bold + C.bCyan + frame + C.reset + '  ' +
            C.cyan + 'AL-FCA' + C.reset + ' ' +
            C.dim + 'connecting to MQTT' + C.reset +
            regionStr +
            C.dim + ' ...' + C.reset +
            '   '
        );
    }, 80);
}

function stopMqttSpinner() {
    if (_mqttSpinner) {
        clearInterval(_mqttSpinner);
        _mqttSpinner = null;
    }
    if (TTY) process.stdout.write('\r\x1b[2K');
}

function printMqttBanner(region, autoReconnect) {
    stopMqttSpinner();
    if (!TTY) {
        log.info("listenMqtt", "MQTT connected" + (region ? " (region " + region.toUpperCase() + ")" : "") +
            ", auto-reconnect " + (autoReconnect ? "on" : "off"));
        return;
    }

    var titleClr  = C.bold + C.bGreen;
    var labelClr  = C.bold + C.bWhite;
    var valClr    = C.bYellow;
    var accentClr = C.bold + C.bMagenta;
    var urlClr    = C.bBlue;
    var dimClr    = C.dim + C.bCyan;
    var rst       = C.reset;

    var regionVal = (region || '').toUpperCase();
    var reconnTxt = autoReconnect ? 'Enabled (backoff)' : 'Disabled';
    var reconnClr = autoReconnect ? C.bGreen : C.bRed;
    var reconnVal = reconnClr + reconnTxt + rst;

    var inner = 44;
    try {
        var cols = process.stdout && process.stdout.columns;
        if (cols && cols < inner + 6) inner = Math.max(30, cols - 6);
    } catch (_) {}

    function visLen(s) {
        return String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
    }
    function padVis(s, w) {
        var n = w - visLen(s);
        return s + (n > 0 ? new Array(n + 1).join(' ') : '');
    }
    function row(left, right) {
        var l = '  ' + left;
        var content = right == null ? l : l + right;
        return dimClr + '│' + rst + padVis(content, inner) + dimClr + '│' + rst;
    }

    var top = dimClr + '╭' + new Array(inner + 1).join('─') + '╮' + rst;
    var bot = dimClr + '╰' + new Array(inner + 1).join('─') + '╯' + rst;
    var blank = row('');

    var rows = [
        top,
        row(titleClr + '✅  AL-FCA MQTT Connected' + rst),
        blank,
        row(padVis('  ' + labelClr + '📍  Region' + rst, 24), valClr + regionVal + rst),
        row(padVis('  ' + labelClr + '🔄  Auto-reconnect' + rst, 24), reconnVal),
        row(urlClr + '🌐  github.com/alaminnna/al-fca' + rst),
        blank,
        row(accentClr + '💎  Author  Alamin' + rst),
        bot
    ];

    process.stdout.write('\n');
    rows.forEach(function (line) {
        log.info(line);
    });
    process.stdout.write('\n');
}

/**
 * Facebook sends non-standard MQTT packets where PUBACK/SUBACK have
 * non-zero reserved flag bits (e.g. 0x4F instead of 0x40).
 * mqtt-packet strictly rejects these. This transform stream patches
 * the first byte of each MQTT frame to clear the lower nibble (flags),
 * keeping only the packet type (upper nibble).
 */
function createMqttPatchStream() {
    var buf = null;

    // Walk frame by frame. For types that must have flags=0 per the MQTT spec
    // (CONNACK=2, PUBACK=4, SUBACK=9, UNSUBACK=11, PINGRESP=13), clear the
    // lower nibble that Facebook sets to non-zero values.
    var stream = new Transform({
        transform: function (chunk, encoding, callback) {
            if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, encoding);

            // Prepend any leftover bytes from the previous chunk
            var out;
            if (buf) {
                out = Buffer.concat([buf, chunk]);
                buf = null;
            } else {
                out = Buffer.from(chunk);
            }

            var i = 0;
            while (i < out.length) {
                var b = out[i];
                var type = (b >> 4) & 0x0F;
                var flags = b & 0x0F;
                // Types that MUST have flags=0:
                if (flags !== 0 && (type === 4 || type === 9 || type === 11 || type === 13 || type === 2)) {
                    out[i] = (b & 0xF0); // clear lower nibble
                }
                // Skip past this frame: read the varint length
                i++;
                var multiplier = 1;
                var frameLen = 0;
                var lenOk = false;
                while (i < out.length) {
                    var lb = out[i++];
                    frameLen += (lb & 0x7F) * multiplier;
                    multiplier *= 128;
                    if ((lb & 0x80) === 0) { lenOk = true; break; }
                    if (multiplier > 128 * 128 * 128) break; // malformed
                }
                if (!lenOk) {
                    // Incomplete frame — save remainder for next chunk
                    buf = out.slice(i - 1);
                    out = out.slice(0, i - 1);
                    break;
                }
                i += frameLen;
            }

            callback(null, out);
        },
        flush: function (callback) {
            if (buf && buf.length > 0) callback(null, buf);
            else callback();
            buf = null;
        }
    });
    return stream;
}

var identity = function () { };

var topics = [
    "/legacy_web",
    "/webrtc",
    "/rtc_multi",
    "/onevc",
    "/br_sr",
    "/sr_res",
    "/t_ms",
    "/thread_typing",
    "/orca_typing_notifications",
    "/notify_disconnect",
    "/orca_presence",
    "/inbox",
    "/mercury",
    "/messaging_events",
    "/orca_message_notifications",
    "/pp",
    "/webrtc_response",
    "/ls_resp"
];

function sanitizeHeaderValue(value) {
    if (value === null || value === undefined) return "";
    var str = String(value);
    if (str.trim().startsWith("[") && str.trim().endsWith("]")) {
        try {
            var parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return "";
        } catch (_) { }
    }
    str = str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F\r\n\[\]]/g, "").trim();
    return str;
}

// Reconnect policy: bounded attempts, exponential backoff with jitter.
var RECONNECT_BASE_DELAY_MS = 2000;
var RECONNECT_MAX_DELAY_MS = 30000;
var RECONNECT_MAX_ATTEMPTS_DEFAULT = 5;

/**
 * attachImageUrlToAttachment — OPT-IN.
 *
 * AL-FCA never re-uploads received user content to third-party hosts by
 * default. When the bot owner explicitly enables `photoUrlProxy` (and
 * provides their own ImgBB key via globalOptions.imgbbApiKey), received
 * photo attachments get a `imgUrl` property from their own account.
 */
function attachImageUrlToAttachment(api, attachment, globalOptions) {
    if (!globalOptions || globalOptions.photoUrlProxy !== true) return;
    if (!attachment || attachment.type !== "photo" || !attachment.url) return;
    if (api && typeof api.uploadImageToImgbb === "function") {
        api.uploadImageToImgbb(attachment.url).then(function (res) {
            var url = res && res.data ? (res.data.url || res.data.display_url || (res.data.image && res.data.image.url)) : null;
            if (url) attachment.imgUrl = url;
        }).catch(function () { });
    }
}

function parseDelta(defaultFuncs, api, ctx, globalCallback, v) {
    if (v.delta.class == "NewMessage") {
        if (ctx.globalOptions.pageID && ctx.globalOptions.pageID != v.queue) return;

        (function resolveAttachmentUrl(i) {
            if (i == (v.delta.attachments || []).length) {
                var fmtMsg;
                try {
                    fmtMsg = utils.formatDeltaMessage(v);
                    var threadKey = v.delta.messageMetadata.threadKey || {};
                    var otherUserFbId = threadKey.otherUserFbId;
                    var threadFbId = threadKey.threadFbId;
                    fmtMsg.isSingleUser = !!otherUserFbId && !threadFbId;
                    fmtMsg.isGroup = !!threadFbId;
                    if (!ctx.threadTypes) ctx.threadTypes = {};
                    ctx.threadTypes[fmtMsg.threadID] = fmtMsg.isSingleUser ? 'dm' : 'group';
                    if (fmtMsg.attachments && Array.isArray(fmtMsg.attachments)) {
                        fmtMsg.attachments.forEach(function (att) { attachImageUrlToAttachment(api, att, ctx.globalOptions); });
                    }
                } catch (err) {
                    return globalCallback({ error: "Problem parsing message object.", detail: err, res: v, type: "parse_error" });
                }
                if (fmtMsg && ctx.globalOptions.autoMarkDelivery) {
                    markDelivery(ctx, api, fmtMsg.threadID, fmtMsg.messageID);
                }
                return !ctx.globalOptions.selfListen &&
                    (fmtMsg.senderID === ctx.i_userID || fmtMsg.senderID === ctx.userID) ?
                    undefined :
                    (function () { globalCallback(null, fmtMsg); })();
            } else {
                if (v.delta.attachments[i] && v.delta.attachments[i].mercury && v.delta.attachments[i].mercury.attach_type == "photo") {
                    api.resolvePhotoUrl(v.delta.attachments[i].fbid, function (err, url) {
                        if (!err && v.delta.attachments[i].mercury.metadata) v.delta.attachments[i].mercury.metadata.url = url;
                        return resolveAttachmentUrl(i + 1);
                    });
                } else {
                    return resolveAttachmentUrl(i + 1);
                }
            }
        })(0);
    }

    if (v.delta.class == "ClientPayload") {
        var clientPayload;
        try {
            clientPayload = utils.decodeClientPayload(v.delta.payload);
        } catch (err) {
            return globalCallback({ error: "Problem parsing ClientPayload.", detail: err, type: "parse_error" });
        }
        if (clientPayload && clientPayload.deltas) {
            for (var i in clientPayload.deltas) {
                var delta = clientPayload.deltas[i];
                if (delta.deltaMessageReaction && !!ctx.globalOptions.listenEvents) {
                    (function () {
                        var tk = delta.deltaMessageReaction.threadKey || {};
                        globalCallback(null, {
                            type: "message_reaction",
                            threadID: String(tk.threadFbId || tk.otherUserFbId || ""),
                            messageID: delta.deltaMessageReaction.messageId,
                            reaction: delta.deltaMessageReaction.reaction,
                            senderID: delta.deltaMessageReaction.senderId.toString(),
                            userID: delta.deltaMessageReaction.userId.toString()
                        });
                    })();
                } else if (delta.deltaRecallMessageData && !!ctx.globalOptions.listenEvents) {
                    (function () {
                        var tk = delta.deltaRecallMessageData.threadKey || {};
                        globalCallback(null, {
                            type: "message_unsend",
                            threadID: String(tk.threadFbId || tk.otherUserFbId || ""),
                            messageID: delta.deltaRecallMessageData.messageID,
                            senderID: delta.deltaRecallMessageData.senderID.toString(),
                            deletionTimestamp: delta.deltaRecallMessageData.deletionTimestamp,
                            timestamp: delta.deltaRecallMessageData.timestamp
                        });
                    })();
                } else if (delta.deltaMessageReply) {
                    var mdata = safeJsonParse(
                        delta.deltaMessageReply.message &&
                        delta.deltaMessageReply.message.data ?
                        delta.deltaMessageReply.message.data.prng : undefined, []);
                    var m_id = mdata.map(function (u) { return u.i; });
                    var m_offset = mdata.map(function (u) { return u.o; });
                    var m_length = mdata.map(function (u) { return u.l; });
                    var mentions = {};
                    for (var j = 0; j < m_id.length; j++) mentions[m_id[j]] = (delta.deltaMessageReply.message.body || "").substring(m_offset[j], m_offset[j] + m_length[j]);

                    var replyMetadata = (delta.deltaMessageReply.message && delta.deltaMessageReply.message.messageMetadata) || {};
                    var replyThreadKey = replyMetadata.threadKey || {};
                    var replyCid = replyMetadata.cid || {};

                    var callbackToReturn = {
                        type: "message_reply",
                        threadID: String(replyThreadKey.threadFbId || replyThreadKey.otherUserFbId || ""),
                        messageID: replyMetadata.messageId,
                        senderID: replyMetadata.actorFbId ? replyMetadata.actorFbId.toString() : "",
                        attachments: (delta.deltaMessageReply.message.attachments || []).map(function (att) {
                            var mercury = safeJsonParse(att.mercuryJSON, null);
                            if (mercury) Object.assign(att, mercury);
                            return att;
                        }).map(function (att) {
                            var x;
                            try { x = utils._formatAttachment(att); }
                            catch (ex) { x = att; x.error = ex; x.type = "unknown"; }
                            return x;
                        }),
                        args: (delta.deltaMessageReply.message.body || "").trim().split(/\s+/),
                        body: (delta.deltaMessageReply.message.body || ""),
                        isGroup: !!replyThreadKey.threadFbId,
                        mentions: mentions,
                        timestamp: replyMetadata.timestamp,
                        participantIDs: (replyCid.canonicalParticipantFbids || delta.deltaMessageReply.message.participants || []).map(function (e) { return e.toString(); })
                    };

                    if (callbackToReturn.attachments && Array.isArray(callbackToReturn.attachments)) {
                        callbackToReturn.attachments.forEach(function (att) { attachImageUrlToAttachment(api, att, ctx.globalOptions); });
                    }

                    if (delta.deltaMessageReply.repliedToMessage) {
                        mdata = safeJsonParse(
                            delta.deltaMessageReply.repliedToMessage.data ?
                            delta.deltaMessageReply.repliedToMessage.data.prng : undefined, []);
                        m_id = mdata.map(function (u) { return u.i; });
                        m_offset = mdata.map(function (u) { return u.o; });
                        m_length = mdata.map(function (u) { return u.l; });
                        var rmentions = {};
                        for (var k = 0; k < m_id.length; k++) rmentions[m_id[k]] = (delta.deltaMessageReply.repliedToMessage.body || "").substring(m_offset[k], m_offset[k] + m_length[k]);

                        var rtMetadata = delta.deltaMessageReply.repliedToMessage.messageMetadata || {};
                        var rtThreadKey = rtMetadata.threadKey || {};
                        callbackToReturn.messageReply = {
                            threadID: String(rtThreadKey.threadFbId || rtThreadKey.otherUserFbId || ""),
                            messageID: rtMetadata.messageId,
                            senderID: rtMetadata.actorFbId ? rtMetadata.actorFbId.toString() : "",
                            attachments: (delta.deltaMessageReply.repliedToMessage.attachments || []).map(function (att) {
                                var mercury = safeJsonParse(att.mercuryJSON, null);
                                if (mercury) Object.assign(att, mercury);
                                return att;
                            }).map(function (att) {
                                var x;
                                try { x = utils._formatAttachment(att); }
                                catch (ex) { x = att; x.error = ex; x.type = "unknown"; }
                                attachImageUrlToAttachment(api, x, ctx.globalOptions);
                                return x;
                            }),
                            args: (delta.deltaMessageReply.repliedToMessage.body || "").trim().split(/\s+/),
                            body: delta.deltaMessageReply.repliedToMessage.body || "",
                            isGroup: !!rtThreadKey.threadFbId,
                            mentions: rmentions,
                            timestamp: rtMetadata.timestamp
                        };
                    } else if (delta.deltaMessageReply.replyToMessageId) {
                        return defaultFuncs
                            .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, {
                                "av": ctx.globalOptions.pageID,
                                "queries": JSON.stringify({
                                    "o0": {
                                        "doc_id": "2848441488556444",
                                        "query_params": {
                                            "thread_and_message_id": {
                                                "thread_id": callbackToReturn.threadID,
                                                "message_id": delta.deltaMessageReply.replyToMessageId.id,
                                            }
                                        }
                                    }
                                })
                            })
                            .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
                            .then(function (resData) {
                                if (resData[resData.length - 1].error_results > 0) throw resData[0].o0.errors;
                                if (resData[resData.length - 1].successful_results === 0) throw { error: "forcedFetch: there was no successful_results", res: resData };
                                var fetchData = resData[0].o0.data.message;
                                var mobj = {};
                                for (var n in fetchData.message.ranges) mobj[fetchData.message.ranges[n].entity.id] = (fetchData.message.text || "").substr(fetchData.message.ranges[n].offset, fetchData.message.ranges[n].length);
                                callbackToReturn.messageReply = {
                                    threadID: callbackToReturn.threadID,
                                    messageID: fetchData.message_id,
                                    senderID: fetchData.message_sender.id.toString(),
                                    attachments: fetchData.message.blob_attachment.map(function (att) {
                                        var x;
                                        try { x = utils._formatAttachment({ blob_attachment: att }); }
                                        catch (ex) { x = att; x.error = ex; x.type = "unknown"; }
                                        attachImageUrlToAttachment(api, x, ctx.globalOptions);
                                        return x;
                                    }),
                                    args: (fetchData.message.text || "").trim().split(/\s+/) || [],
                                    body: fetchData.message.text || "",
                                    isGroup: callbackToReturn.isGroup,
                                    mentions: mobj,
                                    timestamp: parseInt(fetchData.timestamp_precise)
                                };
                            })
                            .catch(function (err) { log.error("forcedFetch", err); })
                            .finally(function () {
                                if (ctx.globalOptions.autoMarkDelivery) markDelivery(ctx, api, callbackToReturn.threadID, callbackToReturn.messageID);
                                !ctx.globalOptions.selfListen && callbackToReturn.senderID === ctx.userID ? undefined : (function () { globalCallback(null, callbackToReturn); })();
                            });
                    } else {
                        callbackToReturn.delta = delta;
                    }

                    if (ctx.globalOptions.autoMarkDelivery) markDelivery(ctx, api, callbackToReturn.threadID, callbackToReturn.messageID);
                    return !ctx.globalOptions.selfListen && callbackToReturn.senderID === ctx.userID ? undefined : (function () { globalCallback(null, callbackToReturn); })();
                }
            }
            return;
        }
    }

    if (v.delta.class !== "NewMessage" && !ctx.globalOptions.listenEvents) return;

    switch (v.delta.class) {
        case "JoinableMode": {
            var fmtMsg;
            try { fmtMsg = utils.formatDeltaEvent(v.delta); }
            catch (err) {
                return globalCallback({ error: "Problem parsing message object.", detail: err, res: v.delta, type: "parse_error" });
            }
            return globalCallback(null, fmtMsg);
        }
        case "AdminTextMessage": {
            switch (v.delta.type) {
                case 'confirm_friend_request':
                case 'shared_album_delete':
                case 'shared_album_addition':
                case 'pin_messages_v2':
                case 'unpin_messages_v2':
                case "change_thread_theme":
                case "change_thread_nickname":
                case "change_thread_icon":
                case "change_thread_quick_reaction":
                case "change_thread_admins":
                case "group_poll":
                case "joinable_group_link_mode_change":
                case "magic_words":
                case "change_thread_approval_mode":
                case "messenger_call_log":
                case "participant_joined_group_call": {
                    var fmtMsg2;
                    try { fmtMsg2 = utils.formatDeltaEvent(v.delta); }
                    catch (err) {
                        return globalCallback({ error: "Problem parsing message object.", detail: err, res: v.delta, type: "parse_error" });
                    }
                    return (function () { globalCallback(null, fmtMsg2); })();
                }
                default: return;
            }
        }
        case "ForcedFetch": {
            if (!v.delta.threadKey) return;
            var mid = v.delta.messageId;
            var tid = v.delta.threadKey.threadFbId;
            if (mid && tid) {
                var fetchForm = {
                    "av": ctx.globalOptions.pageID,
                    "queries": JSON.stringify({
                        "o0": {
                            "doc_id": "2848441488556444",
                            "query_params": {
                                "thread_and_message_id": {
                                    "thread_id": tid.toString(),
                                    "message_id": mid
                                }
                            }
                        }
                    })
                };
                defaultFuncs
                    .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, fetchForm)
                    .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
                    .then(function (resData) {
                        if (resData[resData.length - 1].error_results > 0) throw resData[0].o0.errors;
                        if (resData[resData.length - 1].successful_results === 0) throw { error: "forcedFetch: there was no successful_results", res: resData };
                        var fetchData = resData[0].o0.data.message;
                        if (utils.getType(fetchData) == "Object") {
                            switch (fetchData.__typename) {
                                case "ThreadImageMessage":
                                    (!ctx.globalOptions.selfListen && fetchData.message_sender.id.toString() === ctx.userID) ||
                                        !ctx.loggedIn ? undefined : (function () {
                                            globalCallback(null, {
                                                type: "change_thread_image",
                                                threadID: utils.formatID(tid.toString()),
                                                snippet: fetchData.snippet,
                                                timestamp: fetchData.timestamp_precise,
                                                author: fetchData.message_sender.id,
                                                image: {
                                                    attachmentID: fetchData.image_with_metadata && fetchData.image_with_metadata.legacy_attachment_id,
                                                    width: fetchData.image_with_metadata && fetchData.image_with_metadata.original_dimensions.x,
                                                    height: fetchData.image_with_metadata && fetchData.image_with_metadata.original_dimensions.y,
                                                    url: fetchData.image_with_metadata && fetchData.image_with_metadata.preview.uri
                                                }
                                            });
                                        })();
                                    break;
                                case "UserMessage":
                                    globalCallback(null, {
                                        type: "message",
                                        senderID: utils.formatID(fetchData.message_sender.id),
                                        body: fetchData.message.text || "",
                                        threadID: utils.formatID(tid.toString()),
                                        messageID: fetchData.message_id,
                                        attachments: [{
                                            type: "share",
                                            ID: fetchData.extensible_attachment.legacy_attachment_id,
                                            url: fetchData.extensible_attachment.story_attachment.url,
                                            title: fetchData.extensible_attachment.story_attachment.title_with_entities.text,
                                            description: fetchData.extensible_attachment.story_attachment.description.text,
                                            source: fetchData.extensible_attachment.story_attachment.source,
                                            image: ((fetchData.extensible_attachment.story_attachment.media || {}).image || {}).uri,
                                            width: ((fetchData.extensible_attachment.story_attachment.media || {}).image || {}).width,
                                            height: ((fetchData.extensible_attachment.story_attachment.media || {}).image || {}).height,
                                            playable: (fetchData.extensible_attachment.story_attachment.media || {}).is_playable || false,
                                            duration: (fetchData.extensible_attachment.story_attachment.media || {}).playable_duration_in_ms || 0,
                                            subattachments: fetchData.extensible_attachment.subattachments,
                                            properties: fetchData.extensible_attachment.story_attachment.properties,
                                        }],
                                        mentions: {},
                                        timestamp: parseInt(fetchData.timestamp_precise),
                                        isGroup: (fetchData.message_sender.id != tid.toString())
                                    });
                                    break;
                            }
                        } else log.error("forcedFetch", fetchData);
                    })
                    .catch(function (err) { log.error("forcedFetch", err); });
            }
            break;
        }
        case "ThreadName":
        case "ParticipantsAddedToGroupThread":
        case "ParticipantLeftGroupThread": {
            var formattedEvent;
            try { formattedEvent = utils.formatDeltaEvent(v.delta); }
            catch (err) {
                return globalCallback({ error: "Problem parsing message object.", detail: err, res: v.delta, type: "parse_error" });
            }
            return (!ctx.globalOptions.selfListen && formattedEvent.author.toString() === ctx.userID) || !ctx.loggedIn ? undefined : (function () { globalCallback(null, formattedEvent); })();
        }
    }
}

function markDelivery(ctx, api, threadID, messageID) {
    if (threadID && messageID) {
        api.markAsDelivered(threadID, messageID, function (err) {
            if (err) log.error("markAsDelivered", err);
            else if (ctx.globalOptions.autoMarkRead) {
                api.markAsRead(threadID, function (err) {
                    if (err) log.error("markAsDelivered", err);
                });
            }
        });
    }
}

/**
 * Opens the MQTT connection. `runtime` is the per-listen-session state owned
 * by the factory below: { isStopped(), scheduleReconnect(reason), seqInFlight }.
 */
function listenMqtt(defaultFuncs, api, ctx, globalCallback, runtime) {
    var chatOn = ctx.globalOptions.online;
    var foreground = false;
    var sessionID = Math.floor(Math.random() * 9007199254740991) + 1;
    var GUID = utils.getGUID();

    var username = {
        u: ctx.userID,
        s: sessionID,
        chat_on: chatOn,
        fg: foreground,
        d: GUID,
        ct: 'websocket',
        aid: '219994525426954',
        aids: null,
        mqtt_sid: '',
        cp: 3,
        ecp: 10,
        st: [],
        pm: [],
        dc: '',
        no_auto_fg: true,
        gas: null,
        pack: [],
        p: null,
        php_override: ""
    };

    var cookies = ctx.jar.getCookies("https://www.facebook.com").join("; ");
    var host;
    if (ctx.mqttEndpoint) {
        // Ensure no duplicate sid/cid — strip any existing ones then append fresh
        var baseEndpoint = ctx.mqttEndpoint
            .replace(/[?&]sid=[^&]*/g, '')
            .replace(/[?&]cid=[^&]*/g, '');
        // Re-attach the ? if it was stripped along with the first param
        if (baseEndpoint.indexOf('?') === -1 && ctx.mqttEndpoint.indexOf('?') !== -1) {
            baseEndpoint = baseEndpoint.replace(/&/, '?');
        }
        var sep = baseEndpoint.indexOf('?') === -1 ? '?' : '&';
        host = baseEndpoint + sep + "sid=" + sessionID + "&cid=" + GUID;
    } else if (ctx.region) {
        host = "wss://edge-chat.facebook.com/chat?region=" + ctx.region.toLowerCase() + "&sid=" + sessionID + "&cid=" + GUID;
    } else {
        host = "wss://edge-chat.facebook.com/chat?sid=" + sessionID + "&cid=" + GUID;
    }

    var ua = ctx.globalOptions.userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";

    var wsHeaders = {
        Cookie: sanitizeHeaderValue(cookies),
        Origin: "https://www.facebook.com",
        "User-Agent": sanitizeHeaderValue(ua),
        Referer: "https://www.facebook.com/",
        Host: "edge-chat.facebook.com",
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache"
    };

    if (ctx.region) wsHeaders["X-MSGR-Region"] = sanitizeHeaderValue(ctx.region);

    var wsOptions = {
        headers: wsHeaders,
        origin: "https://www.facebook.com",
        protocolVersion: 13,
        binaryType: "arraybuffer"
    };

    if (typeof ctx.globalOptions.proxy !== "undefined") {
        var { HttpsProxyAgent } = require('https-proxy-agent');
        wsOptions.agent = new HttpsProxyAgent(ctx.globalOptions.proxy);
    }

    var mqttOptions = {
        clientId: "mqttwsclient",
        protocolId: "MQIsdp",
        protocolVersion: 3,
        username: JSON.stringify(username),
        clean: true,
        keepalive: 30,
        reschedulePings: true,
        reconnectPeriod: 0, // reconnect is managed here (bounded + backoff)
        connectTimeout: 12000
    };

    // Use MqttClient with a proper Duplex:
    //   Write side: mqtt → duplex.write → (buffered until ws open) → wsStream → WebSocket
    //   Read side:  WebSocket msg → wsStream readable → patcher (fix FB header bits) → duplex.push → mqtt reads
    // Writes issued before the WebSocket handshake completes are buffered and
    // flushed on 'open' — ws's createWebSocketStream does NOT buffer them, and
    // mqtt.js sends CONNECT synchronously, before the handshake finishes.
    function buildStream() {
        var Duplex = require('stream').Duplex;
        var ws = new WebSocket(host, wsOptions);
        ws.on('error', function () { }); // suppressed; surfaced via the duplex below

        var wsStream = WebSocket.createWebSocketStream(ws, { objectMode: false });
        var patcher = createMqttPatchStream();

        // Wire: wsStream readable → patcher → push into duplex
        wsStream.pipe(patcher);

        var pendingWrites = [];
        var isOpen = false;

        ws.on('open', function () {
            isOpen = true;
            var item;
            while ((item = pendingWrites.shift())) {
                wsStream.write(item.chunk, item.enc, item.cb);
            }
        });

        var duplex = new Duplex({
            read: function () { },
            write: function (chunk, enc, cb) {
                if (isOpen) wsStream.write(chunk, enc, cb);
                else pendingWrites.push({ chunk: chunk, enc: enc, cb: cb });
            },
            final: function (cb) {
                wsStream.end(cb);
            },
            destroy: function (err, cb) {
                pendingWrites = [];
                try { wsStream.destroy(err); } catch (_) { }
                try { ws.close(); } catch (_) { }
                try { ws.terminate(); } catch (_) { }
                cb(err);
            }
        });

        patcher.on('data', function (data) {
            if (!duplex.destroyed) duplex.push(data);
        });
        patcher.on('end', function () {
            if (!duplex.destroyed) duplex.push(null);
        });
        patcher.on('error', function (e) {
            if (!duplex.destroyed) duplex.destroy(e);
        });
        wsStream.on('error', function (e) {
            if (!duplex.destroyed) duplex.destroy(e);
        });
        wsStream.on('close', function () {
            if (!duplex.destroyed) duplex.destroy();
        });

        return duplex;
    }

    startMqttSpinner(ctx.region);

    ctx.mqttClient = new mqtt.MqttClient(buildStream, mqttOptions);
    var mqttClient = ctx.mqttClient;

    var tmsTimeoutMs = Number(ctx.globalOptions.mqttTmsTimeoutMs) > 0 ? Number(ctx.globalOptions.mqttTmsTimeoutMs) : 5000;
    var tmsTimer = null;

    function teardownClient() {
        if (tmsTimer) { clearTimeout(tmsTimer); tmsTimer = null; }
        try { mqttClient.end(true); } catch (_) { }
        if (ctx.mqttClient === mqttClient) ctx.mqttClient = undefined;
    }

    function handleTransportFailure(reason) {
        stopMqttSpinner();
        teardownClient();
        if (runtime.isStopped()) return; // never resurrect a stopped listener
        if (runtime.scheduleReconnect(reason)) {
            log.warn("listenMqtt", "connection problem (" + (reason && reason.message ? reason.message : reason) + "), reconnect scheduled");
        } else {
            globalCallback({ type: "stop_listen", error: "Connection lost: reconnect attempts exhausted (" + (reason && reason.message ? reason.message : reason) + ")" }, null);
        }
    }

    mqttClient.on('error', function (err) {
        log.error("listenMqtt", err);
        handleTransportFailure(err);
    });

    mqttClient.on('connect', function () {
        runtime.onConnected();
        topics.forEach(function (topic) {
            try { mqttClient.subscribe(topic); } catch (_) { }
        });

        printMqttBanner(ctx.region, ctx.globalOptions.autoReconnect);

        var topic;
        var queue = {
            sync_api_version: 10,
            max_deltas_able_to_process: 1000,
            delta_batch_size: 500,
            encoding: "JSON",
            entity_fbid: ctx.userID,
        };

        if (ctx.syncToken) {
            topic = "/messenger_sync_get_diffs";
            queue.last_seq_id = ctx.lastSeqId;
            queue.sync_token = ctx.syncToken;
        } else {
            topic = "/messenger_sync_create_queue";
            queue.initial_titan_sequence_id = ctx.lastSeqId;
            queue.device_params = null;
        }

        mqttClient.publish(topic, JSON.stringify(queue), { qos: 1, retain: false });

        // If the sync-queue response (/t_ms) never arrives, treat it as a
        // transport failure and go through the bounded reconnect path.
        tmsTimer = setTimeout(function () {
            tmsTimer = null;
            handleTransportFailure(new Error("t_ms sync response timeout (" + tmsTimeoutMs + "ms)"));
        }, tmsTimeoutMs);

        ctx.tmsWait = function () {
            if (tmsTimer) { clearTimeout(tmsTimer); tmsTimer = null; }
            if (ctx.globalOptions.emitReady) globalCallback({ type: "ready", error: null });
            delete ctx.tmsWait;

            // ── E2EE bridge init ──────────────────────────────────────────────
            ctx._globalCallback = globalCallback;
            if (ctx.globalOptions.enableE2EE === true) {
                var bridge = e2eeBridge.createBridge(ctx);
                bridge.connect(globalCallback).catch(function (err) {
                    log.error("listenMqtt", "E2EE bridge connect error:", err && err.message ? err.message : err);
                });
            }
            // ── end E2EE bridge init ──────────────────────────────────────────
        };
    });

    mqttClient.on('message', function (topic, message) {
        var jsonMessage = safeJsonParse(message.toString(), null);
        if (jsonMessage === null) {
            return log.error("listenMqtt", "Unparseable MQTT message on " + topic);
        }

        if (topic === "/t_ms") {
            if (ctx.tmsWait && typeof ctx.tmsWait === "function") ctx.tmsWait();

            if (jsonMessage.firstDeltaSeqId && jsonMessage.syncToken) {
                ctx.lastSeqId = jsonMessage.firstDeltaSeqId;
                ctx.syncToken = jsonMessage.syncToken;
            }

            if (jsonMessage.lastIssuedSeqId) ctx.lastSeqId = parseInt(jsonMessage.lastIssuedSeqId);

            var deltas = Array.isArray(jsonMessage.deltas) ? jsonMessage.deltas : [];
            for (var i = 0; i < deltas.length; i++) {
                parseDelta(defaultFuncs, api, ctx, globalCallback, { "delta": deltas[i] });
            }
        } else if (topic === "/thread_typing" || topic === "/orca_typing_notifications") {
            var typ = {
                type: "typ",
                isTyping: !!jsonMessage.state,
                from: jsonMessage.sender_fbid && jsonMessage.sender_fbid.toString(),
                threadID: utils.formatID((jsonMessage.thread || jsonMessage.sender_fbid || "").toString())
            };
            (function () { globalCallback(null, typ); })();
        } else if (topic === "/orca_presence") {
            if (!ctx.globalOptions.updatePresence) {
                var list = Array.isArray(jsonMessage.list) ? jsonMessage.list : [];
                for (var j = 0; j < list.length; j++) {
                    var data = list[j];
                    var presence = {
                        type: "presence",
                        userID: data["u"].toString(),
                        timestamp: data["l"] * 1000,
                        statuses: data["p"]
                    };
                    (function () { globalCallback(null, presence); })();
                }
            }
        }
    });
}

module.exports = function (defaultFuncs, api, ctx) {
    var globalCallback = identity;
    var form = null;
    // Reconnect policy knobs (per API instance)
    var maxAttempts = Number(ctx.globalOptions.reconnectMaxAttempts) > 0
        ? Number(ctx.globalOptions.reconnectMaxAttempts)
        : RECONNECT_MAX_ATTEMPTS_DEFAULT;
    var baseDelay = Number(ctx.globalOptions.reconnectBaseDelayMs) > 0
        ? Number(ctx.globalOptions.reconnectBaseDelayMs)
        : RECONNECT_BASE_DELAY_MS;

    var session = {
        stopped: false,       // stopListening() called — no further reconnects
        attempts: 0,          // consecutive failed attempts
        reconnectTimer: null,
        seqInFlight: false
    };

    function isStopped() { return session.stopped; }

    // Returns true if a reconnect was scheduled, false when attempts are
    // exhausted (or autoReconnect is off).
    function scheduleReconnect(reason) {
        if (session.stopped) return false;
        if (session.reconnectTimer) return true; // already scheduled
        if (ctx.globalOptions.autoReconnect === false) return false;
        if (session.attempts >= maxAttempts) {
            log.error("listenMqtt", "Giving up after " + session.attempts + " reconnect attempts. " +
                "Call api.listenMqtt(...) to listen again.");
            return false;
        }
        var delay = Math.min(baseDelay * Math.pow(2, session.attempts), RECONNECT_MAX_DELAY_MS);
        delay = Math.round(delay / 2 + Math.random() * (delay / 2)); // jitter: 50–100% of slot
        session.attempts++;
        log.warn("listenMqtt", "Reconnect attempt " + session.attempts + "/" + maxAttempts + " in " + delay + "ms" +
            (reason ? " (last error: " + (reason.message || reason) + ")" : ""));
        session.reconnectTimer = setTimeout(function () {
            session.reconnectTimer = null;
            if (!session.stopped) getSeqID();
        }, delay);
        return true;
    }

    var runtime = {
        isStopped: isStopped,
        scheduleReconnect: scheduleReconnect,
        onConnected: function () {
            session.attempts = 0; // a successful connect resets the backoff chain
        }
    };

    function getSeqID() {
        if (session.stopped || session.seqInFlight) return;
        session.seqInFlight = true;
        defaultFuncs
            .post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form)
            .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
            .then(function (resData) {
                session.seqInFlight = false;
                if (utils.getType(resData) != "Array") throw { error: "Not logged in", res: resData };
                if (resData && resData[resData.length - 1].error_results > 0) throw resData[0].o0.errors;
                if (resData[resData.length - 1].successful_results === 0) throw { error: "getSeqId: there was no successful_results", res: resData };
                if (resData[0].o0.data.viewer.message_threads.sync_sequence_id) {
                    ctx.lastSeqId = resData[0].o0.data.viewer.message_threads.sync_sequence_id;
                    listenMqtt(defaultFuncs, api, ctx, globalCallback, runtime);
                } else throw { error: "getSeqId: no sync_sequence_id found.", res: resData };
            })
            .catch(function (err) {
                session.seqInFlight = false;
                log.error("getSeqId", err);
                if (utils.getType(err) == "Object" && err.error === "Not logged in") ctx.loggedIn = false;
                if (isStopped()) return;
                // Auth failures are not transient: surface them, don't loop.
                if (utils.getType(err) == "Object" && err.error === "Not logged in") {
                    return globalCallback(err);
                }
                if (!scheduleReconnect(err)) {
                    globalCallback({
                        type: "stop_listen",
                        error: "Connection failed: reconnect attempts exhausted (" + (err && (err.error || err.message) ? (err.error || err.message) : err) + ")",
                        detail: err
                    }, null);
                }
            });
    }

    return function (callback) {
        class MessageEmitter extends EventEmitter {
            stopListening(callback) {
                var done = callback || (function () { });
                session.stopped = true;
                if (session.reconnectTimer) {
                    clearTimeout(session.reconnectTimer);
                    session.reconnectTimer = null;
                }
                globalCallback = identity;
                var client = ctx.mqttClient;
                ctx.mqttClient = undefined;
                if (client && typeof client.end === 'function') {
                    try {
                        client.publish("/browser_close", "{}");
                    } catch (_) { }
                    client.end(false, function (...data) {
                        done(data);
                    });
                } else {
                    // No live connection: still resolve so stopListeningAsync()
                    // cannot hang.
                    done([]);
                }
                // Detach the E2EE bridge session too — it owns its own socket.
                if (ctx._e2eeBridge && typeof ctx._e2eeBridge.disconnect === 'function') {
                    try {
                        var maybe = ctx._e2eeBridge.disconnect();
                        if (maybe && typeof maybe.catch === 'function') maybe.catch(function () { });
                    } catch (_) { }
                }
            }

            async stopListeningAsync() {
                var self = this;
                return new Promise(function (resolve) {
                    self.stopListening(resolve);
                });
            }
        }

        var msgEmitter = new MessageEmitter();
        globalCallback = (callback || function (error, message) {
            if (error) return msgEmitter.emit("error", error);
            msgEmitter.emit("message", message);
        });

        // Refuse to open a second concurrent connection with the same ctx —
        // the previous client would be orphaned and impossible to stop.
        if (ctx.mqttClient && typeof ctx.mqttClient.end === 'function') {
            try { ctx.mqttClient.end(true); } catch (_) { }
            ctx.mqttClient = undefined;
            log.warn("listenMqtt", "A previous MQTT connection was still open; it has been closed before listening again.");
        }

        if (!ctx.firstListen) ctx.lastSeqId = null;
        ctx.syncToken = undefined;

        form = {
            "av": ctx.globalOptions.pageID,
            "queries": JSON.stringify({
                "o0": {
                    "doc_id": "3336396659757871",
                    "query_params": {
                        "limit": 1,
                        "before": null,
                        "tags": ["INBOX"],
                        "includeDeliveryReceipts": false,
                        "includeSeqID": true
                    }
                }
            })
        };

        if (!ctx.firstListen || !ctx.lastSeqId) {
            getSeqID();
        } else {
            listenMqtt(defaultFuncs, api, ctx, globalCallback, runtime);
        }

        api.stopListening = msgEmitter.stopListening.bind(msgEmitter);
        api.stopListeningAsync = msgEmitter.stopListeningAsync.bind(msgEmitter);
        return msgEmitter;
    };
};

// Test-only internals (not part of the public API contract).
module.exports._test = {
    createMqttPatchStream: createMqttPatchStream,
    parseDelta: parseDelta,
    sanitizeHeaderValue: sanitizeHeaderValue
};
