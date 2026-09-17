'use strict';

// Turbo Designs Bot v5.9.3 – merged launcher
// 1) Runtime-Kompatibilität für discord.js 14.27 / Modal FileUpload
// 2) Konsolidierte Advanced Tools unter einem Slash-Command (/tools)
// 3) Bestehender Selling-/Community-Bot
require('./compat-fix.js');
require('./turbo-tools.js');
module.exports = require('./selling-entry.js');
