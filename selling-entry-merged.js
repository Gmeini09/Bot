'use strict';

// Turbo Designs Bot v5.9.4 – merged launcher
// 1) Runtime-Kompatibilität für discord.js 14.27 / Modal FileUpload
// 2) Ausführliche GitHub→Discord Changelogs statt generischem "files added"
// 3) Konsolidierte Advanced Tools unter /tools
// 4) Bestehender Selling-/Community-Bot
require('./compat-fix.js');
require('./changelog-enhancer.js');
require('./turbo-tools.js');
module.exports = require('./selling-entry.js');
