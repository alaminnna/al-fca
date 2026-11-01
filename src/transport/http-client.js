"use strict";

/*
 * Minimal, maintained HTTP transport for AL-FCA.
 *
 * Replaces the deprecated `request` library (frozen since 2020, with
 * unfixable vulnerabilities in its bundled form-data/qs/tough-cookie/uuid).
 *
 * Response contract (matches what `request` used to give this codebase):
 *   {
 *     statusCode: number,
 *     headers:    object (raw, lowercase keys from Node),
 *     body:       string (gzip/deflate/br decoded, utf8),
 *     request:    { uri: {protocol, hostname, pathname}, headers, formData }
 *   }
 *
 * Redirect policy (also matches `request` defaults): GET/HEAD follow 3xx
 * (up to 10); other methods return the redirect response untouched — login
 * flows depend on reading `headers.location` from POST responses.
 */

var http = require("http");
var https = require("https");
var zlib = require("zlib");
var querystring = require("querystring");
var FormData = require("form-data");
var toughCookie = require("tough-cookie");

var REDIRECT_LIMIT = 10;
var DEFAULT_TIMEOUT_MS = 60000;

// ── Cookie jar (tough-cookie with the surface utils.js expects) ──────────────

function CompatJar(cookieJar) {
    this._jar = cookieJar || new toughCookie.CookieJar(null, { looseMode: true });
}

CompatJar.prototype.setCookie = function (strOrCookie, url, cb) {
    const done = typeof cb === "function" ? cb : function () { };
    try {
        const str = strOrCookie && strOrCookie.constructor && strOrCookie.constructor.name === "Cookie"
            ? strOrCookie.toString()
            : String(strOrCookie);
        this._jar.setCookieSync(str, url, { http: true, ignoreError: true });
        done(null);
    } catch (e) {
        done(e);
    }
    return this;
};

CompatJar.prototype.getCookies = function (url) {
    try {
        return this._jar.getCookiesSync(url, { http: true });
    } catch (_) {
        return [];
    }
};

CompatJar.prototype.getCookieString = function (url) {
    try {
        return this._jar.getCookieStringSync(url, { http: true });
    } catch (_) {
        return "";
    }
};

function jar() {
    return new CompatJar();
}

// ── Proxy (kept out of the hot path; set via setProxy) ───────────────────────

var _proxyAgent = null;

function setProxy(url) {
    if (!url) {
        _proxyAgent = null;
        return;
    }
    var { HttpsProxyAgent } = require("https-proxy-agent");
    _proxyAgent = new HttpsProxyAgent(url);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUrl(url, qs) {
    var u = new URL(url);
    if (qs && typeof qs === "object") {
        var flat = {};
        for (var k in qs) {
            if (Object.prototype.hasOwnProperty.call(qs, k) && qs[k] !== undefined) {
                flat[k] = typeof qs[k] === "object" ? JSON.stringify(qs[k]) : qs[k];
            }
        }
        var encoded = querystring.stringify(flat);
        if (encoded) {
            u.search = u.search ? u.search.replace(/^\?/, "") + "&" + encoded : encoded;
        }
    }
    return u;
}

function decodeBody(res, buffers) {
    var buf = Buffer.concat(buffers);
    var encoding = (res.headers["content-encoding"] || "").toLowerCase();
    try {
        if (encoding === "gzip" || encoding === "x-gzip") buf = zlib.gunzipSync(buf);
        else if (encoding === "deflate") buf = zlib.inflateSync(buf);
        else if (encoding === "br") buf = zlib.brotliDecompressSync(buf);
    } catch (_) {
        // Malformed/truncated encoding — fall back to the raw bytes.
    }
    return buf.toString("utf8");
}

function collect(res, cb) {
    var buffers = [];
    res.on("data", function (c) { buffers.push(c); });
    res.on("end", function () { cb(null, decodeBody(res, buffers)); });
    res.on("error", function (e) { cb(e); });
}

/**
 * Single request attempt. `jarHeader` is the Cookie header value to send.
 */
function attempt(params, cb) {
    var url = params.url;
    var method = params.method || "GET";
    var headers = params.headers || {};
    var timeoutMs = params.timeout || DEFAULT_TIMEOUT_MS;
    var isHttps = url.protocol === "https:";

    var options = {
        method: method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: headers
    };
    if (isHttps && _proxyAgent) options.agent = _proxyAgent;

    var bodyPayload = null;
    if (params.multipart) {
        // params.multipart is a ready form-data instance
        var formHeaders = params.multipart.getHeaders();
        for (var hk in formHeaders) {
            if (!(hk in headers)) headers[hk] = formHeaders[hk];
        }
        bodyPayload = params.multipart;
    } else if (params.formBody != null) {
        bodyPayload = params.formBody;
        if (!headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
    }

    function computeLength(done) {
        if (bodyPayload == null) return done(null);
        if (typeof bodyPayload === "string") {
            headers["Content-Length"] = Buffer.byteLength(bodyPayload);
            return done(null);
        }
        // form-data: getLength is async and does NOT consume stream parts.
        bodyPayload.getLength(function (err, length) {
            if (!err && length != null) headers["Content-Length"] = length;
            // else: chunked transfer-encoding (streams of unknown length)
            done(null);
        });
    }

    computeLength(function () {
        var req = (isHttps ? https : http).request(options, function (res) {
            collect(res, function (err, body) {
                if (err) {
                    res.destroy();
                    return cb(err);
                }
                cb(null, res, body);
            });
        });

        req.setTimeout(timeoutMs, function () {
            req.destroy(new Error("Request timed out after " + timeoutMs + "ms"));
        });
        req.on("error", function (e) { cb(e); });

        if (bodyPayload == null) {
            req.end();
        } else if (typeof bodyPayload === "string") {
            req.write(bodyPayload);
            req.end();
        } else {
            // form-data ends the request when the (possibly streamed) form
            // finishes — do NOT call req.end() here.
            bodyPayload.pipe(req);
        }
    });
}

/**
 * Promise request. Options (mirroring the old `request` usage):
 * { url, method, qs, form, formData, headers, jar, timeout }
 * `form`  — flat object → urlencoded body
 * `formData` — object; values may be strings/numbers/streams or
 *              { value, options: { filename, contentType } } → multipart
 */
function httpRequest(options) {
    return new Promise(function (resolve, reject) {
        try {
            var method = (options.method || "GET").toUpperCase();
            var redirectsLeft = REDIRECT_LIMIT;
            var jarHeader = options.jar ? options.jar.getCookieString(String(options.url)) : "";

            var currentUrl = buildUrl(options.url, method === "GET" ? options.qs : null);
            var lastUrl = String(options.url);

            function run() {
                var headers = {};
                for (var hk in (options.headers || {})) {
                    if (Object.prototype.hasOwnProperty.call(options.headers, hk)) headers[hk] = options.headers[hk];
                }
                if (jarHeader) headers["Cookie"] = jarHeader;

                var params = {
                    url: currentUrl,
                    method: method,
                    headers: headers,
                    timeout: options.timeout
                };

                if (method !== "GET" && method !== "HEAD") {
                    if (options.formData) {
                        var form = new FormData();
                        for (var key in options.formData) {
                            if (!Object.prototype.hasOwnProperty.call(options.formData, key)) continue;
                            var val = options.formData[key];
                            if (val && typeof val === "object" && !Buffer.isBuffer(val) &&
                                typeof val.pipe !== "function" && "value" in val) {
                                form.append(key, val.value, val.options || {});
                            } else if (Buffer.isBuffer(val) || (val && typeof val.pipe === "function")) {
                                form.append(key, val, { filename: "upload.bin" });
                            } else {
                                form.append(key, String(val));
                            }
                        }
                        params.multipart = form;
                        params.formData = options.formData;
                    } else if (options.form) {
                        params.formBody = querystring.stringify(options.form);
                        params.formData = options.form;
                    }
                }

                attempt(params, function (err, res, body) {
                    if (err) return reject(err);

                    var isRedirect = res.statusCode >= 300 && res.statusCode < 400 && res.headers.location;
                    if (isRedirect && (method === "GET" || method === "HEAD") && redirectsLeft > 0) {
                        redirectsLeft--;
                        try {
                            currentUrl = new URL(res.headers.location, currentUrl);
                        } catch (e) {
                            return reject(e);
                        }
                        // Cookie may have been updated by Set-Cookie on the redirect
                        if (options.jar) jarHeader = options.jar.getCookieString(currentUrl.toString());
                        delete headers.Host;
                        return run();
                    }

                    // Persist Set-Cookie headers into the jar (like `request` did
                    // when a jar was attached per-request).
                    if (options.jar && res.headers["set-cookie"]) {
                        res.headers["set-cookie"].forEach(function (c) {
                            try { options.jar.setCookie(c, currentUrl.toString()); } catch (_) { }
                        });
                    }

                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: body,
                        request: {
                            uri: {
                                protocol: currentUrl.protocol,
                                hostname: currentUrl.hostname,
                                pathname: currentUrl.pathname
                            },
                            headers: headers,
                            formData: params.formData || null,
                            method: method,
                            href: lastUrl
                        }
                    });
                });
            }

            run();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    jar: jar,
    request: httpRequest,
    setProxy: setProxy,
    CompatJar: CompatJar
};
