"use strict";

/*
 * Minimal read-only view of the AL-FCA session that FB-Messenger-E2EE needs.
 * Deliberately narrow: exposes only what ClientController.connectE2EE(),
 * fetchCAT() and ICDC registration touch. Never hands out cookies or raw jar.
 */

function createApiShim(api, ctx) {
  return {
    get fb_dtsg() { return ctx.fb_dtsg; },
    getAppState: function () { return api.getAppState(); },
    httpPost: function (url, body) { return api.httpPost(url, body); },
    getCurrentUserID: function () { return api.getCurrentUserID(); }
  };
}

module.exports = {
  createApiShim: createApiShim
};
