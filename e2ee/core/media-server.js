"use strict";

/* Local HTTP cache that serves decrypted E2EE attachments to bot code as
 * http://127.0.0.1:<port>/e2ee/<id> URLs. Entries expire after 10 minutes;
 * the total buffered bytes are capped (oldest entries are evicted first) so
 * large media cannot accumulate without bound. */

var http   = require("http");
var crypto = require("crypto");

var ENTRY_TTL_MS = 10 * 60 * 1000;
var MAX_CACHE_BYTES_DEFAULT = 128 * 1024 * 1024; // 128 MB of decrypted media

var _mediaCache  = new Map(); // id → { buffer, mimeType, expiry, bytes }
var _mediaServer = null;
var _mediaPort   = null;
var _cacheBytes  = 0;

function _cleanExpired() {
    var now = Date.now();
    _mediaCache.forEach(function (entry, id) {
        if (entry.expiry < now) {
            _cacheBytes -= entry.bytes;
            _mediaCache.delete(id);
        }
    });
}

function _evictToLimit(maxBytes) {
    while (_cacheBytes > maxBytes && _mediaCache.size > 0) {
        var oldestId = _mediaCache.keys().next().value;
        var oldest = _mediaCache.get(oldestId);
        _cacheBytes -= oldest.bytes;
        _mediaCache.delete(oldestId);
    }
}

function _startMediaServer() {
    if (_mediaServer && _mediaPort) return Promise.resolve(_mediaPort);
    return new Promise(function (resolve, reject) {
        var s = http.createServer(function (req, res) {
            var id    = req.url.replace(/^\/e2ee\//, "").split("?")[0];
            var entry = _mediaCache.get(id);
            if (!entry) { res.writeHead(404); return res.end("Not found"); }
            res.writeHead(200, {
                "Content-Type"  : entry.mimeType || "application/octet-stream",
                "Content-Length": entry.buffer.length,
                "Cache-Control" : "no-cache"
            });
            res.end(entry.buffer);
        });
        s.listen(0, "127.0.0.1", function () {
            _mediaPort   = s.address().port;
            _mediaServer = s;
            resolve(_mediaPort);
        });
        s.on("error", reject);
    });
}

async function storeMedia(buffer, mimeType, options) {
    var port = await _startMediaServer();
    _cleanExpired();
    var maxBytes = options && Number(options.maxCacheBytes) > 0
        ? Number(options.maxCacheBytes) : MAX_CACHE_BYTES_DEFAULT;

    var buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    var id = crypto.randomBytes(10).toString("hex");
    var entry = {
        buffer   : buf,
        mimeType : mimeType || "application/octet-stream",
        expiry   : Date.now() + ENTRY_TTL_MS,
        bytes    : buf.length
    };
    _mediaCache.set(id, entry);
    _cacheBytes += entry.bytes;
    _evictToLimit(maxBytes);
    return "http://127.0.0.1:" + _mediaPort + "/e2ee/" + id;
}

/** Stop the local media server and drop all cached media. Idempotent. */
function closeMediaServer() {
    return new Promise(function (resolve) {
        var finish = function () {
            _mediaCache.clear();
            _cacheBytes = 0;
            _mediaServer = null;
            _mediaPort = null;
            resolve();
        };
        if (!_mediaServer) return finish();
        var s = _mediaServer;
        s.close(function () { finish(); });
        // Do not wait for keep-alive sockets
        try { s.closeAllConnections(); } catch (_) { }
    });
}

/** Introspection for tests. */
function mediaServerState() {
    return { running: !!_mediaServer, port: _mediaPort, entries: _mediaCache.size, bytes: _cacheBytes };
}

module.exports = {
    storeMedia: storeMedia,
    closeMediaServer: closeMediaServer,
    mediaServerState: mediaServerState
};
