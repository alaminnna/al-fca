"use strict";

/*
 * Resolves a Facebook profile URL to its numeric user ID.
 *
 * SECURITY: this is done with the user's own authenticated session against
 * facebook.com only. Earlier versions forwarded profile links to third-party
 * resolver services and rotated user-agents; both behaviours were removed.
 */

const utils = require("../../utils");
const log = require("../core/logger");

function extractIdentifier(rawLink) {
    const link = String(rawLink || "").trim();
    if (/facebook\.com|fb\.me|fb\.com/i.test(link)) {
        // profile.php?id=123
        const idParam = link.match(/[?&]id=(\d+)/);
        if (idParam) return { type: "id", value: idParam[1] };
        // /profile.php style with fbid path segment
        const parts = link.split("/").filter(Boolean);
        // parts[0] may be the scheme — find the segment after the domain
        const domainIdx = parts.findIndex((p) => /facebook\.com|fb\.me|fb\.com/i.test(p));
        const slug = domainIdx >= 0 && parts[domainIdx + 1] ? parts[domainIdx + 1] : parts[parts.length - 1];
        if (slug && /^\d+$/.test(slug)) return { type: "id", value: slug };
        if (slug && !/^(profile\.php|pages|groups|people)$/i.test(slug)) {
            return { type: "username", value: slug };
        }
    }
    // Bare username
    if (/^[A-Za-z0-9.\-]{3,}$/.test(link) && !/^\d+$/.test(link)) {
        return { type: "username", value: link };
    }
    if (/^\d{5,}$/.test(link)) return { type: "id", value: link };
    return null;
}

function scrapeIdFromHtml(html) {
    const patterns = [
        /"userID":"(\d+)"/,
        /"entity_id":"(\d+)"/,
        /"userID":"?(\d+)"?/,
        /content="fb:\/\/profile\/(\d+)"/,
        /owner_id=(\d+)/,
        /"profile_id":(\d+)/,
        /fb:\/\/profile\/(\d+)/,
    ];
    for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) return m[1];
    }
    return null;
}

module.exports = function (defaultFuncs, api, ctx) {
    return function getUID(link, callback) {
        let resolveFunc = function () { };
        let rejectFunc = function () { };
        const returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });

        if (!callback) {
            callback = function (err, uid) {
                if (err) return rejectFunc(err);
                resolveFunc(uid);
            };
        }

        const finish = (err, uid) => {
            if (err) log.error("getUID", err && err.message ? err.message : err);
            callback(err, uid);
        };

        const ident = extractIdentifier(link);
        if (!ident) {
            finish(new Error("Invalid link. The link should be a Facebook profile link or username."));
            return returnPromise;
        }

        if (ident.type === "id") {
            finish(null, ident.value);
            return returnPromise;
        }

        // Resolve a username locally with the logged-in session.
        defaultFuncs
            .get("https://www.facebook.com/" + encodeURIComponent(ident.value), ctx.jar, null, ctx.globalOptions)
            .then(function (res) {
                const uid = scrapeIdFromHtml(res.body);
                if (!uid) {
                    throw new Error("Could not resolve a numeric ID for '" + ident.value + "' from the profile page.");
                }
                finish(null, uid);
            })
            .catch(function (err) {
                finish(err);
            });

        return returnPromise;
    };
};
