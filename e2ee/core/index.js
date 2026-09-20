"use strict";

/*
 * E2EE module entry. Same public exports as the retired native (koffi/messagix)
 * e2ee.js, now backed by the vendored FB-Messenger-E2EE implementation:
 *   isE2EEChatJid(value)               – "@..."-JID detection
 *   storeMedia(buffer, mime)           – local decrypted-media cache URL
 *   createBridge(ctx)                  – E2EE client bridge (see bridge.js)
 *   patchApiForE2EE(api, ctx)          – shared api helpers
 */

var { storeMedia } = require("./media-server");
var {
  isE2EEChatJid,
  createBridge,
  patchApiForE2EE
} = require("./bridge");

module.exports = {
  isE2EEChatJid  : isE2EEChatJid,
  storeMedia     : storeMedia,
  createBridge   : createBridge,
  patchApiForE2EE: patchApiForE2EE
};
