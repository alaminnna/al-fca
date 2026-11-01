"use strict";

var utils = require("./utils");
var cheerio = require("cheerio");
var log = require("./src/core/logger");
var { checkForFCAUpdate } = require("./checkUpdate");
var login = require("./src/auth/login.js");
const fs = require('fs');
const path = require('path');
const httpClient = require('./src/transport/http-client');
/*var { getThemeColors } = require("../../func/utils/log.js");
var logger = require("../../func/utils/log.js");
var { cra, cv, cb, co } = getThemeColors();*/
log.maxRecordSize = 100;
var checkVerified = null;
const Boolean_Option = ['online', 'selfListen', 'listenEvents', 'updatePresence', 'forceLogin', 'autoMarkDelivery', 'autoMarkRead', 'listenTyping', 'autoReconnect', 'emitReady', 'enableE2EE', 'e2eeMemoryOnly', 'autoUpdateCheck', 'photoUrlProxy'];

function setOptions(globalOptions, options) {
    Object.keys(options).map(function (key) {
        switch (Boolean_Option.includes(key)) {
            case true: {
                globalOptions[key] = Boolean(options[key]);
                break;
            }
            case false: {
                switch (key) {
                    case 'pauseLog': {
                        if (options.pauseLog) log.pause();
                        else log.resume();
                        break;
                    }
                    case 'logLevel': {
                        log.level = options.logLevel;
                        globalOptions.logLevel = options.logLevel;
                        break;
                    }
                    case 'logRecordSize': {
                        log.maxRecordSize = options.logRecordSize;
                        globalOptions.logRecordSize = options.logRecordSize;
                        break;
                    }
                    case 'pageID': {
                        globalOptions.pageID = options.pageID.toString();
                        break;
                    }
                    case 'e2eeDevicePath': {
                        globalOptions.e2eeDevicePath = options.e2eeDevicePath;
                        break;
                    }
                    case 'e2eeDeviceData': {
                        globalOptions.e2eeDeviceData = options.e2eeDeviceData;
                        break;
                    }
                    case 'e2eeMediaCdnHost': {
                        globalOptions.e2eeMediaCdnHost = options.e2eeMediaCdnHost;
                        break;
                    }
                    case 'userAgent': {
                        globalOptions.userAgent = (options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
                        break;
                    }
                    case 'proxy': {
                        if (typeof options.proxy != "string") {
                            delete globalOptions.proxy;
                            utils.setProxy();
                        } else {
                            globalOptions.proxy = options.proxy;
                            utils.setProxy(globalOptions.proxy);
                        }
                        break;
                    }
                    default: {
                        log.warn("setOptions", "Unrecognized option given to setOptions: " + key);
                        break;
                    }
                }
                break;
            }
        }
    });
}

function buildAPI(globalOptions, html, jar) {
    let fb_dtsg = null;
    let irisSeqID = null;
    function extractFromHTML() {
        try {
            const $ = cheerio.load(html);
            $('script').each((i, script) => {
                if (!fb_dtsg) {
                    const scriptText = $(script).html() || '';
                    const patterns = [
                        /\["DTSGInitialData",\[\],{"token":"([^"]+)"}]/,
                        /\["DTSGInitData",\[\],{"token":"([^"]+)"/,
                        /"token":"([^"]+)"/,
                        /{\\"token\\":\\"([^\\]+)\\"/,
                        /,\{"token":"([^"]+)"\},\d+\]/,
                        /"async_get_token":"([^"]+)"/,
                        /"dtsg":\{"token":"([^"]+)"/,
                        /DTSGInitialData[^>]+>([^<]+)/
                    ];
                    for (const pattern of patterns) {
                        const match = scriptText.match(pattern);
                        if (match && match[1]) {
                            try {
                                const possibleJson = match[1].replace(/\\"/g, '"');
                                const parsed = JSON.parse(possibleJson);
                                fb_dtsg = parsed.token || parsed;
                            } catch {
                                fb_dtsg = match[1];
                            }
                            if (fb_dtsg) break;
                        }
                    }
                }
            });
            if (!fb_dtsg) {
                const dtsgInput = $('input[name="fb_dtsg"]').val();
                if (dtsgInput) fb_dtsg = dtsgInput;
            }
            const seqMatches = html.match(/irisSeqID":"([^"]+)"/);
            if (seqMatches && seqMatches[1]) {
                irisSeqID = seqMatches[1];
            }
            try {
                const jsonMatches = html.match(/\{"dtsg":({[^}]+})/);
                if (jsonMatches && jsonMatches[1]) {
                    const dtsgData = JSON.parse(jsonMatches[1]);
                    if (dtsgData.token) fb_dtsg = dtsgData.token;
                }
            } catch { }
            if (fb_dtsg) {
                log.debug("login", "Found fb_dtsg!");
            }
        } catch (e) {
            log.error("login", "Error finding fb_dtsg: " + (e && e.message ? e.message : e));
        }
    }
    extractFromHTML();
    var userID;
    var cookies = jar.getCookies("https://www.facebook.com");
    var userCookie = cookies.find(cookie => cookie.cookieString().startsWith("c_user="));
    var tiktikCookie = cookies.find(cookie => cookie.cookieString().startsWith("i_user="));
    if (!userCookie && !tiktikCookie) {
        log.error("Error! Your cookiestate is not valid!");
        throw new Error("Your cookiestate is not valid! Use a fresh appstate and try again.");
    }
    if (html.includes("/checkpoint/block/?next")) {
        log.error('error', "Appstate is dead rechange it!", 'error');
        throw new Error("Appstate is dead, change it!");
    }
    userID = (tiktikCookie || userCookie).cookieString().split("=")[1];
    const clientID = (Math.random() * 2147483648 | 0).toString(16);
    let mqttEndpoint = `wss://edge-chat.facebook.com/chat?region=pnb`;
    let region = "PNB";

    try {
        const endpointMatch = html.match(/"endpoint":"([^"]+)"/);
        if (endpointMatch && endpointMatch.input && endpointMatch.input.includes("601051028565049")) {
          log.error("login", "Login endpoint error.");
        }
        if (endpointMatch) {
            let ep = endpointMatch[1].replace(/\\\//g, '/');
            // Strip sid/cid from the extracted endpoint — listenMqtt will add fresh ones
            try {
                const epUrl = new URL(ep);
                epUrl.searchParams.delete('sid');
                epUrl.searchParams.delete('cid');
                region = epUrl.searchParams.get('region')?.toUpperCase() || "PNB";
                mqttEndpoint = epUrl.toString();
            } catch (_) {
                mqttEndpoint = ep.replace(/[?&]sid=[^&]*/g, '').replace(/[?&]cid=[^&]*/g, '');
                region = (mqttEndpoint.match(/region=([^&]+)/) || [])[1]?.toUpperCase() || "PNB";
            }
        }
    } catch (e) {
        log.warn("mqtt", "Using default MQTT endpoint");
    }
    log.info('Logging in...');
    var ctx = {
        userID: userID,
        jar: jar,
        clientID: clientID,
        globalOptions: globalOptions,
        loggedIn: true,
        access_token: 'NONE',
        clientMutationId: 0,
        mqttClient: undefined,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint: mqttEndpoint,
        region: region,
        firstListen: true,
        fb_dtsg: fb_dtsg,
        req_ID: 0,
        callback_Task: {},
        wsReqNumber: 0,
        wsTaskNumber: 0,
        reqCallbacks: {},
        threadTypes: {} // Store thread type (dm/group) for each thread
    };
    // ─── Config loading (single source, layered) ─────────────────────────────
    // Precedence: defaults < process.cwd()/config.json < <pkg>/config.json < global.GoatBot.config
    const CONFIG_DEFAULTS = Object.freeze({ enableTypingIndicator: false, typingDuration: 4000, e2eeTypingDuration: 3000 });

    function readConfigFile(p) {
        try {
            if (!fs.existsSync(p)) return null;
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (e) {
            log.error("config", "Error loading " + p + ": " + (e && e.message ? e.message : e));
            return null;
        }
    }

    function loadFcaConfig() {
        const cfg = Object.assign({}, CONFIG_DEFAULTS);
        for (const p of [path.join(process.cwd(), 'config.json'), path.join(__dirname, 'config.json')]) {
            const fileCfg = readConfigFile(p);
            if (fileCfg) {
                for (const key of Object.keys(CONFIG_DEFAULTS)) {
                    if (typeof fileCfg[key] !== 'undefined') cfg[key] = fileCfg[key];
                }
            }
        }
        if (global.GoatBot && global.GoatBot.config) {
            for (const key of Object.keys(CONFIG_DEFAULTS)) {
                if (typeof global.GoatBot.config[key] !== 'undefined') cfg[key] = global.GoatBot.config[key];
            }
        }
        return cfg;
    }

    let config = loadFcaConfig();

    const refreshFcaConfig = () => {
        config = loadFcaConfig();
        ctx.config = config;
        return config;
    };

    // Accessible runtime API for config reload
    ctx.refreshFcaConfig = refreshFcaConfig;
    if (global.GoatBot) {
        global.GoatBot.refreshFcaConfig = refreshFcaConfig;
    }

    // ─── E2EE options from root config.json ────────────────────────────────────
    try {
        const _rootCfg = readConfigFile(path.join(process.cwd(), 'config.json'));
        const _e2eeCfg = (_rootCfg && _rootCfg.e2ee) ? _rootCfg.e2ee : {};
        if (_e2eeCfg.enable === true) globalOptions.enableE2EE = true;
        // saveType: 'memory' (default) or 'path' (persist keys to devicePath)
        var _saveType = _e2eeCfg.saveType || (typeof _e2eeCfg.memoryOnly !== 'undefined' ? (_e2eeCfg.memoryOnly ? 'memory' : 'path') : 'memory');
        globalOptions.e2eeMemoryOnly = (_saveType !== 'path');
        if (_saveType === 'path' && _e2eeCfg.devicePath) globalOptions.e2eeDevicePath = _e2eeCfg.devicePath;
        if (_e2eeCfg.deviceData) globalOptions.e2eeDeviceData = _e2eeCfg.deviceData;
    } catch (_) {}

    ctx.config = config;
    var api = {
        setOptions: setOptions.bind(null, globalOptions),
        getAppState: () => utils.getAppState(jar),
        postFormData: (url, body) => utils.makeDefaults(html, userID, ctx).postFormData(url, ctx.jar, body)
    };
    var defaultFuncs = utils.makeDefaults(html, userID, ctx);
    api.postFormData = function (url, body) {
        return defaultFuncs.postFormData(url, ctx.jar, body);
    };

    // ─── Explicit image upload utility (bring your own key) ──────────────────
    // SECURITY: no hardcoded API keys ship with the library and no automatic
    // re-uploading of user content to third-party hosts happens anywhere.
    // This is a plain utility a caller may invoke deliberately, with their
    // own ImgBB API key, to host an image and get a URL back.
    async function uploadImageToImgbb(image, options) {
        options = options || {};
        const apiKey = options.apiKey || (ctx.globalOptions && ctx.globalOptions.imgbbApiKey);
        if (!apiKey) throw new Error('uploadImageToImgbb requires your own ImgBB apiKey (options.apiKey or globalOptions.imgbbApiKey)');
        const expiration = Number.isFinite(options.expiration) ? options.expiration : 600;

        const formData = {};
        if (Buffer.isBuffer(image)) {
            formData.image = image.toString('base64');
        } else if (typeof image === 'string') {
            const dataUriMatch = image.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
            formData.image = dataUriMatch ? dataUriMatch[1] : image.trim();
        } else {
            throw new Error('Unsupported image type for ImgBB upload (expected Buffer or string)');
        }

        return new Promise((resolve, reject) => {
            httpClient.request(
                {
                    url: 'https://api.imgbb.com/1/upload',
                    method: 'POST',
                    qs: { expiration, key: apiKey },
                    formData,
                },
            ).then(function (res) {
                try {
                    const data = JSON.parse(res.body);
                    if (!data || !data.success) return reject(data || new Error('ImgBB upload failed'));
                    resolve(data);
                } catch (err) {
                    reject(err);
                }
            }).catch(reject);
        });
    }

    api.uploadImageToImgbb = uploadImageToImgbb;
    ctx.uploadImageToImgbb = uploadImageToImgbb;

    api.getFreshDtsg = async function () {
        try {
            const res = await defaultFuncs.get('https://www.facebook.com/', jar, null, globalOptions);
            const $ = cheerio.load(res.body);
            let newDtsg;
            const patterns = [
                /\["DTSGInitialData",\[\],{"token":"([^"]+)"}]/,
                /\["DTSGInitData",\[\],{"token":"([^"]+)"/,
                /"token":"([^"]+)"/,
                /name="fb_dtsg" value="([^"]+)"/
            ];

            $('script').each((i, script) => {
                if (!newDtsg) {
                    const scriptText = $(script).html() || '';
                    for (const pattern of patterns) {
                        const match = scriptText.match(pattern);
                        if (match && match[1]) {
                            newDtsg = match[1];
                            break;
                        }
                    }
                }
            });

            if (!newDtsg) {
                newDtsg = $('input[name="fb_dtsg"]').val();
            }

            return newDtsg;
        } catch (e) {
            log.error("getFreshDtsg", e);
            return null;
        }
    };
    //if (noMqttData) api.htmlData = noMqttData;
    // Invariant: every src/**/*.js file must export a factory
    // function (defaults, api, ctx); the loader calls it to build api[name].
    // Non-factory helpers (logger.js, login.js, transport/http-client.js) are
    // excluded — they are infrastructure, not api methods.
    // All modules share ONE makeDefaults instance: __req then increments per
    // request process-wide (previously every module got its own counter that
    // restarted at 1, and the login HTML was re-scanned ~120 times).
    function loadApiModules(dir) {
        fs.readdirSync(dir).forEach(v => {
            const fullPath = path.join(dir, v);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                loadApiModules(fullPath);
            } else if (v.endsWith('.js') && v !== 'logger.js' && v !== 'login.js' && v !== 'http-client.js') {
                const relPath = path.relative(__dirname, fullPath).replace(/\\/g, '/');
                const name = v.replace('.js', '');
                api[name] = require('./' + relPath)(defaultFuncs, api, ctx);
            }
        });
    }
    loadApiModules(__dirname + '/src');
    
    // Store original sendMessage as the primary method
    // NOTE: no error-triggered re-send wrapper here. sendMessage itself falls
    // back to OldMessage once for transport-level failures; wrapping it again
    // caused duplicate messages when an MQTT ack timed out after delivery.

    // Provide explicit method for DM sending using OldMessage
    api.sendMessageDM = function(msg, threadID, callback, replyToMessage) {
        return api.OldMessage(msg, threadID, callback, replyToMessage, true);
    };
    
    api.listen = api.listenMqtt;

    // ─── E2EE: patch API + expose connectE2EE / getE2EEDeviceData ───────────────
    if (globalOptions.enableE2EE) {
        try {
            var _e2ee = require('./e2ee');
            _e2ee.patchApiForE2EE(api, ctx);

            // api.connectE2EE(callback?) – start the E2EE client
            api.connectE2EE = function (callback) {
                var bridge = _e2ee.createBridge(ctx);
                api._e2eeBridge = bridge;
                return bridge.connect(callback);
            };

            // api.getE2EEBridge() – return the live bridge instance
            api.getE2EEBridge = function () {
                return ctx._e2eeBridge || null;
            };

            // api.getE2EEDeviceData(callback?) – fetch persistent device keys
            api.getE2EEDeviceData = function (callback) {
                var resolve, reject;
                var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
                if (ctx._e2eeDeviceData) {
                    if (typeof callback === 'function') callback(null, ctx._e2eeDeviceData);
                    resolve(ctx._e2eeDeviceData);
                    return promise;
                }
                _e2ee.createBridge(ctx).getDeviceData()
                    .then(function (d) {
                        ctx._e2eeDeviceData = d;
                        if (typeof callback === 'function') callback(null, d);
                        resolve(d);
                    })
                    .catch(function (e) {
                        if (typeof callback === 'function') callback(e);
                        reject(e);
                    });
                return promise;
            };
        } catch (_patchErr) {
            log.warn('E2EE', 'Failed to initialise E2EE:', _patchErr && _patchErr.message ? _patchErr.message : _patchErr);
        }
    }

    return {
        ctx,
        defaultFuncs,
        api
    };
}


module.exports = login;
module.exports.buildAPI = buildAPI;
module.exports.setOptions = setOptions;
