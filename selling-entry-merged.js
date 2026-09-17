'use strict';

// Turbo Designs Bot v5.9.1 – merged launcher
// Lädt die Advanced-Erweiterungen VOR dem aktuellen v5.9.0 Selling-Bot.
// Dadurch werden Command-Registrierung und Interaction-Handler erweitert,
// ohne die bestehenden Selling-/Community-Funktionen zu überschreiben.
require('./advanced-features.js');
module.exports = require('./selling-entry.js');
