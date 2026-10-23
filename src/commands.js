'use strict';
// Slash commands as raw API JSON (registered per server on start).
const P = { MANAGE_ROLES: 1n << 28n, ADMIN: 1n << 3n, MANAGE_GUILD: 1n << 5n, MANAGE_CHANNELS: 1n << 4n, KICK: 1n << 1n, BAN: 1n << 2n, MANAGE_MESSAGES: 1n << 13n, MODERATE: 1n << 40n };
const perm = (p) => String(p);
const T = { SUB: 1, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, NUMBER: 10, ATTACHMENT: 11 };
const opt = (type, name, description, extra = {}) => ({ type, name, description, ...extra });
const sub = (name, description, options = []) => ({ type: T.SUB, name, description, options });
const base = (name, description, permission, options = []) => ({ name, description, type: 1, dm_permission: false, default_member_permissions: permission === null ? null : perm(permission), options });

const user = (req = true) => opt(T.USER, 'nutzer', 'Mitglied', { required: req });
const reason = (req = false) => opt(T.STRING, 'grund', 'Grund', { required: req, max_length: 400 });

const COMMANDS = [
  base('setup', 'Postet die Panels in die eingestellten Kanäle und zeigt die Einrichtung', P.ADMIN),
  base('panel', 'Postet ein Panel neu', P.ADMIN, [
    opt(T.STRING, 'art', 'Welches Panel', { required: true, choices: [
      { name: 'Verifizierung', value: 'verify' }, { name: 'Tickets', value: 'tickets' }, { name: 'Shop', value: 'shop' }, { name: 'Mitgliederliste', value: 'memberlist' },
    ] }),
  ]),
  base('config', 'Einstellungen des Bots', P.ADMIN, [
    sub('anzeigen', 'Zeigt alle Einstellungen'),
    sub('name', 'Name, der in Embeds steht', [opt(T.STRING, 'name', 'z. B. XVY Kaiserreich', { required: true, max_length: 60 })]),
    sub('farbe', 'Farbe der Embeds', [opt(T.STRING, 'hex', 'z. B. #c9a227', { required: true, max_length: 9 })]),
    sub('teamrolle', 'Team-Rolle hinzufügen oder entfernen (sieht Tickets und Bestellungen)', [opt(T.ROLE, 'rolle', 'Rolle', { required: true })]),
    sub('mitgliedrolle', 'Rolle nach der Verifizierung', [opt(T.ROLE, 'rolle', 'Rolle', { required: true })]),
    sub('kundenrolle', 'Rolle nach einer gelieferten Bestellung (leer = keine)', [opt(T.ROLE, 'rolle', 'Rolle')]),
    sub('kanal', 'Kanal für ein Panel, die Logs oder die Ticket-Kategorie', [
      opt(T.STRING, 'art', 'Wofür', { required: true, choices: [
        { name: 'Willkommen', value: 'welcomeChannelId' }, { name: 'Verifizieren (Panel)', value: 'verifyChannelId' },
        { name: 'Shop (Panel)', value: 'shopChannelId' }, { name: 'Tickets (Panel)', value: 'supportChannelId' },
        { name: 'Mod-Log', value: 'modLogChannelId' }, { name: 'Ticket-Log', value: 'ticketLogChannelId' },
        { name: 'Kategorie für Tickets', value: 'ticketCategoryId' }, { name: 'Kategorie für Bestellungen', value: 'orderCategoryId' },
        { name: 'Giveaways', value: 'giveawayChannelId' }, { name: 'Feedback / Bewertungen', value: 'feedbackChannelId' },
        { name: 'Mitgliederliste', value: 'memberListChannelId' },
      ] }),
      opt(T.CHANNEL, 'kanal', 'Kanal oder Kategorie', { required: true, channel_types: [0, 4, 5] }),
    ]),
    sub('zahlung', 'Zahlungsinfos, die in jeder Bestellung stehen', [opt(T.STRING, 'text', 'z. B. PayPal: name@mail.at (Freunde & Familie)', { required: true, max_length: 900 })]),
    sub('willkommen', 'Willkommenstext ({user}, {server}, {verify}, {count})', [opt(T.STRING, 'text', 'Text', { required: true, max_length: 900 })]),
    sub('regeln', 'Regeltext im Verifizierungs-Panel (\\n = neue Zeile)', [opt(T.STRING, 'text', 'Regeln', { required: true, max_length: 3500 })]),
    sub('captcha', 'Rechenaufgabe bei der Verifizierung', [opt(T.BOOLEAN, 'an', 'Captcha an oder aus', { required: true })]),
    sub('willkommensbild', 'Bild mit Avatar und Mitgliedsnummer bei der Begrüßung', [opt(T.BOOLEAN, 'an', 'Bild an oder aus', { required: true })]),
    sub('tickets', 'Tickets ohne Antwort automatisch schließen', [
      opt(T.BOOLEAN, 'aktiv', 'An oder aus'),
      opt(T.INTEGER, 'erinnerung_stunden', 'Nach so vielen Stunden ohne Nachricht erinnern (Standard 48)', { min_value: 1, max_value: 720 }),
      opt(T.INTEGER, 'schliessen_stunden', 'So viele Stunden nach der Erinnerung schließen (Standard 24)', { min_value: 1, max_value: 720 }),
    ]),
    sub('automod', 'Automatischer Schutz', [
      opt(T.BOOLEAN, 'aktiv', 'Automod insgesamt an/aus'),
      opt(T.BOOLEAN, 'spam', 'Spam & wiederholte Nachrichten'),
      opt(T.BOOLEAN, 'einladungen', 'Fremde Discord-Einladungen löschen'),
      opt(T.INTEGER, 'max_erwaehnungen', 'Ab so vielen @Erwähnungen in einer Nachricht eingreifen', { min_value: 2, max_value: 50 }),
      opt(T.INTEGER, 'verwarnungen_timeout', 'Ab so vielen Verwarnungen 1 h Timeout (0 = aus)', { min_value: 0, max_value: 20 }),
      opt(T.INTEGER, 'mindestalter_tage', 'Neue Accounts jünger als X Tage kicken (0 = aus)', { min_value: 0, max_value: 365 }),
      opt(T.INTEGER, 'raid_joins', 'So viele Beitritte in 30 s = Raid-Modus', { min_value: 3, max_value: 100 }),
    ]),
  ]),
  base('produkt', 'Shop-Produkte verwalten', P.MANAGE_GUILD, [
    sub('hinzufuegen', 'Neues Produkt', [
      opt(T.STRING, 'name', 'Produktname', { required: true, max_length: 80 }),
      opt(T.STRING, 'preis', 'Preis in Euro, z. B. 9,99', { required: true, max_length: 12 }),
      opt(T.STRING, 'beschreibung', 'Kurze Beschreibung', { max_length: 300 }),
      opt(T.STRING, 'emoji', 'Emoji, z. B. 🔥', { max_length: 64 }),
    ]),
    sub('bearbeiten', 'Produkt ändern', [
      opt(T.STRING, 'produkt', 'Produkt', { required: true, autocomplete: true }),
      opt(T.STRING, 'name', 'Neuer Name', { max_length: 80 }),
      opt(T.STRING, 'preis', 'Neuer Preis', { max_length: 12 }),
      opt(T.STRING, 'beschreibung', 'Neue Beschreibung', { max_length: 300 }),
      opt(T.STRING, 'emoji', 'Neues Emoji', { max_length: 64 }),
      opt(T.BOOLEAN, 'verfuegbar', 'Im Shop bestellbar?'),
    ]),
    sub('entfernen', 'Produkt löschen', [opt(T.STRING, 'produkt', 'Produkt', { required: true, autocomplete: true })]),
    sub('bestand', 'Wie viele verfügbar sind (leer = unbegrenzt) – Wartende werden benachrichtigt', [opt(T.STRING, 'produkt', 'Produkt', { required: true, autocomplete: true }), opt(T.INTEGER, 'anzahl', 'Stückzahl (0 = ausverkauft, leer = unbegrenzt)', { min_value: 0, max_value: 100000 })]),
    sub('bild', 'Produktbild hochladen (leer lassen = Bild entfernen)', [opt(T.STRING, 'produkt', 'Produkt', { required: true, autocomplete: true }), opt(T.ATTACHMENT, 'bild', 'Bild (PNG, JPG, GIF, WebP – max. 8 MB)')]),
    sub('liste', 'Alle Produkte'),
  ]),
  base('ticket', 'Ticket verwalten (im Ticket-Kanal)', P.MANAGE_MESSAGES, [
    sub('hinzufuegen', 'Mitglied zum Ticket hinzufügen', [user()]),
    sub('entfernen', 'Mitglied aus dem Ticket entfernen', [user()]),
    sub('schliessen', 'Ticket schließen', [reason()]),
  ]),
  base('warn', 'Mitglied verwarnen', P.MODERATE, [user(), reason(true)]),
  base('warns', 'Verwarnungen eines Mitglieds', P.MODERATE, [user()]),
  base('unwarn', 'Verwarnung entfernen', P.MODERATE, [user(), opt(T.INTEGER, 'nummer', 'Nummer aus /warns (leer = alle)', { min_value: 1 })]),
  base('timeout', 'Mitglied stummschalten', P.MODERATE, [user(), opt(T.INTEGER, 'minuten', 'Dauer in Minuten (max. 40320 = 28 Tage)', { required: true, min_value: 1, max_value: 40320 }), reason()]),
  base('untimeout', 'Stummschaltung aufheben', P.MODERATE, [user()]),
  base('kick', 'Mitglied kicken', P.KICK, [user(), reason()]),
  base('ban', 'Mitglied bannen', P.BAN, [user(), reason(), opt(T.INTEGER, 'nachrichten_tage', 'Nachrichten der letzten X Tage löschen', { min_value: 0, max_value: 7 })]),
  base('unban', 'Bann aufheben', P.BAN, [opt(T.STRING, 'user_id', 'Discord-ID', { required: true, max_length: 21 }), reason()]),
  base('clear', 'Nachrichten löschen', P.MANAGE_MESSAGES, [opt(T.INTEGER, 'anzahl', '1–100', { required: true, min_value: 1, max_value: 100 }), user(false)]),
  base('lock', 'Kanal sperren', P.MANAGE_CHANNELS, [reason()]),
  base('unlock', 'Kanal entsperren', P.MANAGE_CHANNELS),
  base('slowmode', 'Slowmode setzen', P.MANAGE_CHANNELS, [opt(T.INTEGER, 'sekunden', '0 = aus, max. 21600', { required: true, min_value: 0, max_value: 21600 })]),
  // visible to everyone: Discord cannot gate a command by role, so giveaway.js checks Manage Server, team or the giveaway role
  base('giveaway', 'Giveaways (Team und Rolle „giveaway perms“)', null, [
    sub('start', 'Neues Giveaway starten', [
      opt(T.STRING, 'preis', 'Was gibt es zu gewinnen?', { required: true, max_length: 200 }),
      opt(T.STRING, 'dauer', 'z. B. 30m, 2h, 1d, 1d12h', { required: true, max_length: 12 }),
      opt(T.INTEGER, 'gewinner', 'Anzahl Gewinner (Standard 1)', { min_value: 1, max_value: 20 }),
      opt(T.CHANNEL, 'kanal', 'Kanal (Standard: Giveaway-Kanal)', { channel_types: [0, 5] }),
      opt(T.STRING, 'beschreibung', 'Zusätzlicher Text', { max_length: 500 }),
    ]),
    sub('beenden', 'Giveaway jetzt beenden und Gewinner ziehen', [opt(T.STRING, 'giveaway', 'Giveaway', { required: true, autocomplete: true })]),
    sub('neu-ziehen', 'Neue Gewinner ziehen', [opt(T.STRING, 'giveaway', 'Giveaway', { required: true, autocomplete: true })]),
    sub('liste', 'Alle Giveaways'),
  ]),
  base('rollen', 'Rollen, die sich Mitglieder selbst geben können', P.MANAGE_ROLES, [
    sub('hinzufuegen', 'Rolle wählbar machen', [opt(T.ROLE, 'rolle', 'Bestehende Rolle', { required: true }), opt(T.STRING, 'emoji', 'Emoji für den Button', { max_length: 64 }), opt(T.STRING, 'beschreibung', 'Kurze Erklärung', { max_length: 100 })]),
    sub('entfernen', 'Rolle nicht mehr wählbar', [opt(T.ROLE, 'rolle', 'Rolle', { required: true })]),
    sub('panel', 'Rollen-Panel posten', [opt(T.CHANNEL, 'kanal', 'Kanal (Standard: dieser)', { channel_types: [0, 5] })]),
  ]),
  base('stats', 'Statistik: Bestellungen, Umsatz, Bewertungen, Tickets', P.MODERATE),
  base('rabatt', 'Rabattcodes für den Shop', P.MANAGE_GUILD, [
    sub('erstellen', 'Neuer Rabattcode', [
      opt(T.STRING, 'code', 'z. B. XVY10', { required: true, max_length: 30 }),
      opt(T.STRING, 'rabatt', '10% oder 5 (Euro)', { required: true, max_length: 10 }),
      opt(T.INTEGER, 'tage', 'Gültig für so viele Tage (leer = unbegrenzt)', { min_value: 1, max_value: 365 }),
      opt(T.INTEGER, 'max_nutzungen', 'Insgesamt so oft einlösbar (leer = unbegrenzt)', { min_value: 1, max_value: 10000 }),
    ]),
    sub('loeschen', 'Rabattcode löschen', [opt(T.STRING, 'code', 'Code', { required: true, autocomplete: true })]),
    sub('liste', 'Alle Rabattcodes'),
  ]),
  base('invites', 'Einladungen', null, [
    sub('anzeigen', 'Wie viele Leute jemand eingeladen hat', [user(false)]),
    sub('rangliste', 'Wer hat die meisten eingeladen?'),
  ]),
  base('backup', 'Aktuelle Bot-Daten als Datei (nur Owner/Admins)', P.ADMIN),
  base('rechte', 'Prüft, ob dem Bot Rechte fehlen', P.ADMIN),
  base('raidmode', 'Raid-Modus beenden oder starten', P.MODERATE, [opt(T.BOOLEAN, 'an', 'An oder aus', { required: true })]),
];

module.exports = { COMMANDS, P };
