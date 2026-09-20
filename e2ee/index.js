"use strict";

// Entry point kept after the e2ee/ split into core/, fme/ and vendor/.
// Runtime code (index.js, src/*) still requires the package root 'e2ee'.
module.exports = require("./core");
