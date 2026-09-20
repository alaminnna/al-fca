"use strict";

// Login flow lives here (moved out of index.js).
// buildAPI/setOptions still live in index.js and are pulled lazily at
// call time to avoid a require cycle — same deferred-require pattern
// used in src/messaging/*.
var utils = require("../../utils");
var cheerio = require("cheerio");
var log = require("../core/logger");
var { checkForFCAUpdate } = require("../../checkUpdate");

function getIndex() {
    return require("../../index.js");
}

function makeLogin(jar, email, password, loginOptions, callback, prCallback) {
    return async function (res) {
        try {
            const html = res.body;
            const $ = cheerio.load(html);
            let arr = [];
            $("#login_form input").each((i, v) => arr.push({ val: $(v).val(), name: $(v).attr("name") }));
            arr = arr.filter(v => v.val && v.val.length);
            let form = utils.arrToForm(arr);
            form.lsd = utils.getFrom(html, "[\"LSD\",[],{\"token\":\"", "\"}");
            form.lgndim = Buffer.from(JSON.stringify({ w: 1440, h: 900, aw: 1440, ah: 834, c: 24 })).toString('base64');
            form.email = email;
            form.pass = password;
            form.default_persistent = '0';
            form.lgnrnd = utils.getFrom(html, "name=\"lgnrnd\" value=\"", "\"");
            form.locale = 'en_US';
            form.timezone = '240';
            form.lgnjs = Math.floor(Date.now() / 1000);
            const willBeCookies = html.split("\"_js_");
            willBeCookies.slice(1).forEach(val => {
                const cookieData = JSON.parse("[\"" + utils.getFrom(val, "", "]") + "]");
                jar.setCookie(utils.formatCookie(cookieData, "facebook"), "https://www.facebook.com");
            });
            log.info("Logging in...");
            const loginRes = await utils.post(
                "https://www.facebook.com/login/device-based/regular/login/?login_attempt=1&lwv=110",
                jar,
                form,
                loginOptions
            );
            await utils.saveCookies(jar)(loginRes);
            const headers = loginRes.headers;
            if (!headers.location) throw new Error("Wrong username/password.");
            if (headers.location.includes('https://www.facebook.com/checkpoint/')) {
                log.info("login", "You have login approvals turned on.");
                const checkpointRes = await utils.get(headers.location, jar, null, loginOptions);
                await utils.saveCookies(jar)(checkpointRes);
                const checkpointHtml = checkpointRes.body;
                const $ = cheerio.load(checkpointHtml);
                let checkpointForm = [];
                $("form input").each((i, v) => checkpointForm.push({ val: $(v).val(), name: $(v).attr("name") }));
                checkpointForm = checkpointForm.filter(v => v.val && v.val.length);
                const form = utils.arrToForm(checkpointForm);
                if (checkpointHtml.includes("checkpoint/?next")) {
                    return new Promise((resolve, reject) => {
                        const submit2FA = async (code) => {
                            try {
                                form.approvals_code = code;
                                form['submit[Continue]'] = $("#checkpointSubmitButton").html();
                                const approvalRes = await utils.post(
                                    "https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php",
                                    jar,
                                    form,
                                    loginOptions
                                );
                                await utils.saveCookies(jar)(approvalRes);
                                const approvalError = $("#approvals_code").parent().attr("data-xui-error");
                                if (approvalError) throw new Error("Invalid 2FA code.");
                                form.name_action_selected = 'dont_save';
                                const finalRes = await utils.post(
                                    "https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php",
                                    jar,
                                    form,
                                    loginOptions
                                );
                                await utils.saveCookies(jar)(finalRes);
                                const appState = utils.getAppState(jar);
                                resolve(await loginHelper(appState, email, password, loginOptions, callback));
                            } catch (error) {
                                reject(error);
                            }
                        };
                        throw {
                            error: 'login-approval',
                            continue: submit2FA
                        };
                    });
                }
                if (!loginOptions.forceLogin) throw new Error("Couldn't login. Facebook might have blocked this account.");
                form['submit[This was me]'] = checkpointHtml.includes("Suspicious Login Attempt") ? "This was me" : "This Is Okay";
                await utils.post("https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php", jar, form, loginOptions);
                form.name_action_selected = 'save_device';
                const reviewRes = await utils.post("https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2Fhome.php", jar, form, loginOptions);
                const appState = utils.getAppState(jar);
                return await loginHelper(appState, email, password, loginOptions, callback);
            }
            await utils.get('https://www.facebook.com/', jar, null, loginOptions);
            return await utils.saveCookies(jar);
        } catch (error) {
            callback(error);
        }
    };
}


function loginHelper(appState, email, password, globalOptions, callback, prCallback) {
    let mainPromise = null;
    const jar = utils.getJar();
    if (appState) {
        try {
            appState = JSON.parse(appState);
        } catch (e) {
            try {
                appState = appState;
            } catch (e) {
                return callback(new Error("Failed to parse appState"));
            }
        }

        try {
            appState.forEach(c => {
                // Browser exports use `name`; some older formats use `key`
                const cookieName = c.key || c.name;
                if (!cookieName || !c.value) return;
                const domain = c.domain || '.facebook.com';
                const expires = c.expirationDate
                    ? new Date(c.expirationDate * 1000).toUTCString()
                    : (c.expires || '');
                const str = `${cookieName}=${c.value}; expires=${expires}; domain=${domain}; path=${c.path || '/'};`;
                const url = 'http://' + domain.replace(/^\./, 'www.');
                try { jar.setCookie(str, url); } catch (_) { }
            });

            mainPromise = utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true })
                .then(utils.saveCookies(jar));
        } catch (e) {
            return callback(new Error('Failed to load appState: ' + e.message));
        }
    } else {
        mainPromise = utils
            .get("https://www.facebook.com/", null, null, globalOptions, { noRef: true })
            .then(utils.saveCookies(jar))
            .then(makeLogin(jar, email, password, globalOptions, callback, prCallback))
            .then(() => utils.get('https://www.facebook.com/', jar, null, globalOptions).then(utils.saveCookies(jar)));
    }

    function handleRedirect(res) {
        const reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
        const redirect = reg.exec(res.body);
        if (redirect && redirect[1]) {
            return utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
        }
        return res;
    }

    let ctx, api;
    mainPromise = mainPromise
        .then(handleRedirect)
        .then(res => {
            const mobileAgentRegex = /MPageLoadClientMetrics/gs;
            if (!mobileAgentRegex.test(res.body)) {
                globalOptions.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
                return utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true }).then(utils.saveCookies(jar));
            }
            return res;
        })
        .then(handleRedirect)
        .then(res => {
            const html = res.body;
            const Obj = getIndex().buildAPI(globalOptions, html, jar);
            ctx = Obj.ctx;
            api = Obj.api;
            return res;
        });

    if (globalOptions.pageID) {
        mainPromise = mainPromise
            .then(() => utils.get(`https://www.facebook.com/${globalOptions.pageID}/messages/?section=messages&subsection=inbox`, jar, null, globalOptions))
            .then(resData => {
                let url = utils.getFrom(resData.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");').split('\\').join('');
                url = url.substring(0, url.length - 1);
                return utils.get('https://www.facebook.com' + url, jar, null, globalOptions);
            });
    }

    mainPromise
        .then(async () => {
            log.info('Login successful');
            callback(null, api);
        })
        .catch(e => {
            callback(e);
        });
}


function login(loginData, options, callback) {
    // Check for updates (non-blocking, only once per session)
    if (!global.alfcaUpdateChecked) {
        global.alfcaUpdateChecked = true;
        checkForFCAUpdate().catch(err => {
            // Silently ignore update check errors to not block login
        });
    }

    if (utils.getType(options) === 'Function' || utils.getType(options) === 'AsyncFunction') {
        callback = options;
        options = {};
    }

    var globalOptions = {
        selfListen: false,
        listenEvents: true,
        listenTyping: false,
        updatePresence: false,
        forceLogin: false,
        autoMarkDelivery: false,
        autoMarkRead: false,
        autoReconnect: true,
        logRecordSize: 100,
        online: false,
        emitReady: false,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    };

    var prCallback = null;
    if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
        var rejectFunc = null;
        var resolveFunc = null;
        var returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });
        prCallback = function (error, api) {
            if (error) return rejectFunc(error);
            return resolveFunc(api);
        };
        callback = prCallback;
    }

    if (loginData.email && loginData.password) {
        getIndex().setOptions(globalOptions, {
            logLevel: "silent",
            forceLogin: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        });
        loginHelper(loginData.appState, loginData.email, loginData.password, globalOptions, callback, prCallback);
    } else if (loginData.appState) {
        getIndex().setOptions(globalOptions, options);
        return loginHelper(loginData.appState, loginData.email, loginData.password, globalOptions, callback, prCallback);
    }
    return returnPromise;
}

module.exports = login;
