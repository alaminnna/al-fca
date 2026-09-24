"use strict";

var utils = require("./utils");
var cheerio = require("cheerio");
var log = require("./src/core/logger");
var { checkForFCAUpdate } = require("./checkUpdate");
var login = require("./src/auth/login.js");
const fs = require('fs');
const path = require('path');
const request = require('request');
/*var { getThemeColors } = require("../../func/utils/log.js");
var logger = require("../../func/utils/log.js");
var { cra, cv, cb, co } = getThemeColors();*/
log.maxRecordSize = 100;
var checkVerified = null;
const Boolean_Option = ['online', 'selfListen', 'listenEvents', 'updatePresence', 'forceLogin', 'autoMarkDelivery', 'autoMarkRead', 'listenTyping', 'autoReconnect', 'emitReady', 'enableE2EE', 'e2eeMemoryOnly'];
global.ditconmemay = false;
global.alfcaUpdateChecked = false;

// Auto-check for updates on package load (non-blocking)
if (!global.alfcaUpdateChecked) {
    global.alfcaUpdateChecked = true;
    const { checkForFCAUpdate } = require("./checkUpdate");
    setImmediate(() => {
        checkForFCAUpdate().catch(() => {
            // Silent fail - don't interrupt user's bot
        });
    });
}

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
    //logger.log(`${cra(`[ CONNECT ]`)} Logged in as ${userID}`, "DATABASE");
    try { clearInterval(checkVerified); } catch (_) { }
    const clientID = (Math.random() * 2147483648 | 0).toString(16);
    let mqttEndpoint = `wss://edge-chat.facebook.com/chat?region=pnb`;
    let region = "PNB";

    try {
        const endpointMatch = html.match(/"endpoint":"([^"]+)"/);
        if (endpointMatch && endpointMatch.input && endpointMatch.input.includes("601051028565049")) {
          log.error("login", "Login endpoint error.");
          ditconmemay = true;
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
    let config = { enableTypingIndicator: false, typingDuration: 4000 };
    try {
        // Prefer global root config (project-level), but fallback to fca/config.json if present.
        const rootConfigPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(rootConfigPath)) {
            const rootConfig = JSON.parse(fs.readFileSync(rootConfigPath, 'utf8'));
            if (rootConfig && typeof rootConfig === 'object') {
                if (typeof rootConfig.enableTypingIndicator !== 'undefined') config.enableTypingIndicator = rootConfig.enableTypingIndicator;
                if (typeof rootConfig.typingDuration !== 'undefined') config.typingDuration = rootConfig.typingDuration;
            }
        }

        const fcaConfigPath = path.join(__dirname, 'config.json');
        if (fs.existsSync(fcaConfigPath)) {
            const fcaConfig = JSON.parse(fs.readFileSync(fcaConfigPath, 'utf8'));
            if (fcaConfig && typeof fcaConfig === 'object') {
                if (typeof fcaConfig.enableTypingIndicator !== 'undefined') config.enableTypingIndicator = fcaConfig.enableTypingIndicator;
                if (typeof fcaConfig.typingDuration !== 'undefined') config.typingDuration = fcaConfig.typingDuration;
            }
        }

        if (global.GoatBot && global.GoatBot.config) {
            if (typeof global.GoatBot.config.enableTypingIndicator !== 'undefined') config.enableTypingIndicator = global.GoatBot.config.enableTypingIndicator;
            if (typeof global.GoatBot.config.typingDuration !== 'undefined') config.typingDuration = global.GoatBot.config.typingDuration;
        }
    } catch (e) {
        log.error("config", "Error loading config.json: " + (e && e.message ? e.message : e));
    }

    const refreshFcaConfig = () => {
        try {
            // Defaults first
            const updatedConfig = { enableTypingIndicator: false, typingDuration: 4000 };

            // Layered config sources
            if (fs.existsSync(path.join(process.cwd(), 'config.json'))) {
                const rootConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
                if (rootConfig && typeof rootConfig === 'object') {
                    if (typeof rootConfig.enableTypingIndicator !== 'undefined') updatedConfig.enableTypingIndicator = rootConfig.enableTypingIndicator;
                    if (typeof rootConfig.typingDuration !== 'undefined') updatedConfig.typingDuration = rootConfig.typingDuration;
                }
            }

            if (fs.existsSync(path.join(__dirname, 'config.json'))) {
                const fcaConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
                if (fcaConfig && typeof fcaConfig === 'object') {
                    if (typeof fcaConfig.enableTypingIndicator !== 'undefined') updatedConfig.enableTypingIndicator = fcaConfig.enableTypingIndicator;
                    if (typeof fcaConfig.typingDuration !== 'undefined') updatedConfig.typingDuration = fcaConfig.typingDuration;
                }
            }

            if (global.GoatBot && global.GoatBot.config) {
                if (typeof global.GoatBot.config.enableTypingIndicator !== 'undefined') updatedConfig.enableTypingIndicator = global.GoatBot.config.enableTypingIndicator;
                if (typeof global.GoatBot.config.typingDuration !== 'undefined') updatedConfig.typingDuration = global.GoatBot.config.typingDuration;
            }

            ctx.config = updatedConfig;
            config = updatedConfig;
            if (global.GoatBot) global.GoatBot.config = global.GoatBot.config || {};
            if (global.GoatBot && typeof global.GoatBot.config.enableTypingIndicator !== 'undefined') {
                global.GoatBot.config.enableTypingIndicator = updatedConfig.enableTypingIndicator;
            }
            if (global.GoatBot && typeof global.GoatBot.config.typingDuration !== 'undefined') {
                global.GoatBot.config.typingDuration = updatedConfig.typingDuration;
            }
        } catch (e) {
            log.error("config", "Failed to refresh fca config: " + (e && e.message ? e.message : e));
        }
    };

    // Initial config load
    refreshFcaConfig();

    // Accessible runtime API for config reload
    ctx.refreshFcaConfig = refreshFcaConfig;
    if (global.GoatBot) {
        global.GoatBot.refreshFcaConfig = refreshFcaConfig;
    }

    // ─── E2EE options from root config.json ────────────────────────────────────
    try {
        const _e2eeRootPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(_e2eeRootPath)) {
            const _rootCfg = JSON.parse(fs.readFileSync(_e2eeRootPath, 'utf8'));
            const _e2eeCfg = (_rootCfg && _rootCfg.e2ee) ? _rootCfg.e2ee : {};
            if (_e2eeCfg.enable === true) globalOptions.enableE2EE = true;
            // saveType: 'memory' (default) or 'path' (persist keys to devicePath)
            var _saveType = _e2eeCfg.saveType || (typeof _e2eeCfg.memoryOnly !== 'undefined' ? (_e2eeCfg.memoryOnly ? 'memory' : 'path') : 'memory');
            globalOptions.e2eeMemoryOnly = (_saveType !== 'path');
            if (_saveType === 'path' && _e2eeCfg.devicePath) globalOptions.e2eeDevicePath = _e2eeCfg.devicePath;
            if (_e2eeCfg.deviceData) globalOptions.e2eeDeviceData = _e2eeCfg.deviceData;
        }
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

    // ─── Silent image upload system (ImgBB + ImageKit) ───────────────────────
    // Upload keys are hardcoded fallbacks; there is no remote key refresh,
    // so installs never phone home to third-party repos at runtime.
    let _imgKeys = {
        imgbb:'3e198e6ffe205d1c7968a92fd92177c9',
        ik_pub: null,
        ik_priv: null
    };

    async function uploadImageToImgbb(image, expiration = 600) {
        const formData = {};
        if (Buffer.isBuffer(image)) {
            formData.image = image.toString('base64');
        } else if (typeof image === 'string') {
            const dataUriMatch = image.match(/^data:image\/[a-zA-Z]+;base64,(.+)$/);
            if (dataUriMatch) {
                formData.image = dataUriMatch[1];
            } else {
                formData.image = image.trim();
            }
        } else {
            throw new Error('Unsupported image type for ImgBB upload');
        }

        return new Promise((resolve, reject) => {
            request.post(
                {
                    url: 'https://api.imgbb.com/1/upload',
                    qs: { expiration, key: _imgKeys.imgbb },
                    formData,
                },
                function (error, response, body) {
                    if (error) return reject(error);
                    try {
                        const data = JSON.parse(body);
                        if (!data || !data.success) return reject(data || new Error('ImgBB upload failed'));
                        resolve(data);
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });
    }

    async function _uploadToImageKit(image) {
        if (!_imgKeys.ik_pub || !_imgKeys.ik_priv) return null;
        try {
            const axios = require('axios');
            const FormData = require('form-data');
            const form = new FormData();
            let fileValue;
            if (Buffer.isBuffer(image)) {
                fileValue = image.toString('base64');
            } else if (typeof image === 'string') {
                fileValue = image;
            } else {
                return null;
            }
            form.append('file', fileValue);
            form.append('fileName', 'al_fca_' + Date.now() + '.jpg');
            form.append('publicKey', _imgKeys.ik_pub);
            const auth = Buffer.from(_imgKeys.ik_priv + ':').toString('base64');
            const res = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
                headers: Object.assign({ 'Authorization': 'Basic ' + auth }, form.getHeaders())
            });
            if (res.data && res.data.url) return res.data.url;
        } catch (_) { }
        return null;
    }

    // Combined silent upload: tries ImgBB first, then ImageKit; returns URL string or null
    async function _imgUpload(imageUrl) {
        try {
            const result = await uploadImageToImgbb(imageUrl);
            if (result && result.data) {
                return result.data.url || result.data.display_url || (result.data.image && result.data.image.url);
            }
        } catch (_) { }
        try {
            return await _uploadToImageKit(imageUrl);
        } catch (_) { }
        return null;
    }

    api.uploadImageToImgbb = uploadImageToImgbb;
    ctx.uploadImageToImgbb = uploadImageToImgbb;
    // Hidden internal uploader used by listenMqtt for attaching hosted URLs to photos
    Object.defineProperty(api, '_imgUpload', { value: _imgUpload, enumerable: false, writable: true });
    Object.defineProperty(ctx, '_imgUpload', { value: _imgUpload, enumerable: false, writable: true });

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
            console.log("Error getting fresh dtsg:", e);
            return null;
        }
    };
    //if (noMqttData) api.htmlData = noMqttData;
    // Invariant: every src/**/*.js file must export a factory
    // function (defaults, api, ctx); the loader calls it to build api[name].
    // Non-factory helpers (logger.js, login.js) are excluded.
    function loadApiModules(dir) {
        require('fs').readdirSync(dir).forEach(v => {
            const fullPath = require('path').join(dir, v);
            const stat = require('fs').statSync(fullPath);
            if (stat.isDirectory()) {
                loadApiModules(fullPath);
            } else if (v.endsWith('.js') && v !== 'logger.js' && v !== 'login.js') {
                const relPath = require('path').relative(__dirname, fullPath).replace(/\\/g, '/');
                const name = v.replace('.js', '');
                api[name] = require('./' + relPath)(utils.makeDefaults(html, userID, ctx), api, ctx);
            }
        });
    }
    loadApiModules(__dirname + '/src');
    
    // Store original sendMessage as the primary method
    const originalSendMessage = api.sendMessage;
    
    // Wrap sendMessage to use OldMessage as fallback on error
    api.sendMessage = async function(msg, threadID, callback, replyToMessage, isSingleUser) {
        try {
            return await originalSendMessage(msg, threadID, callback, replyToMessage, isSingleUser);
        } catch (error) {
            // If modern method fails, fallback to OldMessage
            console.log('sendMessage failed, using OldMessage fallback:', error.message);
            return api.OldMessage(msg, threadID, callback, replyToMessage, isSingleUser);
        }
    };
    
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
