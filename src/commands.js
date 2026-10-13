'use strict';
// Slash commands as raw API JSON (registered per server on start).
const P = { ADMIN: 1n << 3n, MANAGE_GUILD: 1n << 5n, MANAGE_CHANNELS: 1n << 4n, KICK: 1n << 1n, BAN: 1n << 2n, MANAGE_MESSAGES: 1n << 13n, MODERATE: 1n << 40n };
const perm = (p) => String(p);
const T = { SUB: 1, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, NUMBER: 10 };
const opt = (type, name, description, extra = {}) => ({ type, name, description, ...extra });
const sub = (name, description, options = []) => ({ type: T.SUB, name, description, options });
const base = (name, description, permission, options = []) => ({ name, description, type: 1, dm_permission: false, default_member_permissions: perm(permission), options });

const user = (req = true) => opt(T.USER, 'nutzer', 'Mitglied', { required: req });
const reason = (req = false) => opt(T.STRING, 'grund', 'Grund', { required: req, max_length: 400 });

const COMMANDS = [
  base('setup', 'Legt Rollen, Kanäle und Panels für Verifizierung, Tickets, Shop und Logs an', P.ADMIN),
  base('panel', 'Postet ein Panel neu', P.ADMIN, [
    opt(T.STRING, 'art', 'Welches Panel', { required: true, choices: [
      { name: 'Verifizierung', value: 'verify' }, { name: 'Tickets', value: 'tickets' }, { name: 'Shop', value: 'shop' },
    ] }),
  ]),
  base('config', 'Einstellungen des Bots', P.ADMIN, [
    sub('anzeigen', 'Zeigt alle Einstellungen'),
    sub('name', 'Name, der in Embeds steht', [opt(T.STRING, 'name', 'z. B. XVY Imperium', { required: true, max_length: 60 })]),
    sub('farbe', 'Farbe der Embeds', [opt(T.STRING, 'hex', 'z. B. #c9a227', { required: true, max_length: 9 })]),
    sub('teamrolle', 'Rolle, die Tickets und Bestellungen sieht', [opt(T.ROLE, 'rolle', 'Team-Rolle', { required: true })]),
    sub('mitgliedrolle', 'Rolle nach der Verifizierung', [opt(T.ROLE, 'rolle', 'Mitglied-Rolle', { required: true })]),
    sub('zahlung', 'Zahlungsinfos, die in jeder Bestellung stehen', [opt(T.STRING, 'text', 'z. B. PayPal: name@mail.at (Freunde & Familie)', { required: true, max_length: 900 })]),
    sub('willkommen', 'Willkommenstext ({user}, {server}, {verify}, {count})', [opt(T.STRING, 'text', 'Text', { required: true, max_length: 900 })]),
    sub('regeln', 'Regeltext im Verifizierungs-Panel (\\n = neue Zeile)', [opt(T.STRING, 'text', 'Regeln', { required: true, max_length: 3500 })]),
    sub('captcha', 'Rechenaufgabe bei der Verifizierung', [opt(T.BOOLEAN, 'an', 'Captcha an oder aus', { required: true })]),
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
  base('raidmode', 'Raid-Modus beenden oder starten', P.MODERATE, [opt(T.BOOLEAN, 'an', 'An oder aus', { required: true })]),
];

module.exports = { COMMANDS, P };
