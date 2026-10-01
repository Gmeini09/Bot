# SP Tool Lizenzsystem im Bot

Der Bot ist jetzt auch der **Lizenzserver für SP Tool**. Lizenzen hängen an der **Discord-ID**, jede Lizenz ist an **PCs (HWID)** gebunden – weitergeben funktioniert nicht. Owner **697402284849627180** ist immer Admin.

## Was dazukommt
- `sptool-license/` – Lizenz-API + Discord-Commands (keine neuen npm-Pakete, nutzt Node 22 `node:sqlite`)
- `start-fixed.js` – lädt `sptool-license/bot.js` vor dem restlichen Bot (Fehler dort legen den Bot nie lahm)
- Die API läuft auf derselben Railway-Adresse unter `/api/v1/...`
- Zwei **globale** Slash-Commands (zählen nicht zum 100er-Limit der Server-Commands):

| Command | Wer | Was |
|---|---|---|
| `/sptool lizenz` | alle | eigene Lizenz + Discord-ID |
| `/sptool einloesen key:` | alle | Lizenz-Key einlösen |
| `/sptool geraete` | alle | eigene gebundene PCs |
| `/sptool-admin lizenz-geben plan: user:/id: tage: geraete: notiz:` | Admins | Lizenz vergeben/ändern (0 Tage = lebenslang), User bekommt eine DM |
| `/sptool-admin lizenz-entziehen` | Admins | Lizenz widerrufen |
| `/sptool-admin info` | Admins | Lizenz, PCs, Ban-Status, letzter Login |
| `/sptool-admin geraete-reset` | Admins | alle PCs entfernen (Umzug auf neuen PC) |
| `/sptool-admin ban` / `unban` | Admins | für SP Tool sperren / entsperren |
| `/sptool-admin keys-erstellen plan: anzahl: tage: geraete:` | Admins | Keys `SPT-XXXX-…` erzeugen (nur für dich sichtbar) |
| `/sptool-admin key-widerrufen` | Admins | Key ungültig machen |
| `/sptool-admin suche` / `stats` | Admins | Benutzer suchen / Übersicht |
| `/sptool-admin admin aktion:` | nur Owner | weitere Admins ernennen/entfernen |
| `/sptool-admin setup` | Admins | zeigt API-Adresse, Redirect-URL und Public Key |

Alles, was im Bot passiert, sieht man auch im Admin-Bereich der SP Tool App (gleiche Datenbank), und umgekehrt.

## Einrichten (einmalig)
1. **Railway**: Variable `DISCORD_CLIENT_SECRET` setzen (Developer Portal → deine Bot-App → OAuth2 → *Reset Secret*). Volume `/data` muss bleiben.
2. Deploy. In Discord `/sptool-admin setup` ausführen.
3. Die dort angezeigte **Redirect-URL** im Developer Portal unter OAuth2 → *Redirects* eintragen.
4. SP Tool mit den beiden angezeigten Werten bauen (`SPTOOL_API_URL`, `SPTOOL_LICENSE_PUBKEY`).

Globale Commands können beim ersten Mal bis zu ein paar Minuten brauchen, bis sie in Discord erscheinen.

## Daten
Auf dem Volume: `sptool-license.db` (Lizenzen, Geräte, Keys, Audit-Log), `sptool-license-ed25519.pem` (privater Signaturschlüssel – **nicht löschen**, sonst müssen alle Nutzer eine neu gebaute App bekommen), `sptool-hwid-salt.txt`.

Test: `npm run test:sptool`
