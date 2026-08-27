# Unfug Community Bot – All-in-One

Diese Version enthält **alle bisherigen Funktionen in einer einzigen `index.js`**.

## Enthalten

- Socials-System inkl. mehreren Links, Rollen-Sortierung, Edit/Delete/MySocials
- automatische Vorschlags-Panels aus normalen Nachrichten mit ✅ / ❌
- Ticket-System
- Verifizierung per Rechenaufgabe
- Welcome / Leave
- Moderation und Warnsystem
- Logs
- Ankündigungen und Abstimmungen
- Giveaway-System mit Teilnahme-Button, automatischer Auslosung, End und Reroll

## Giveaway Commands

- `/giveaway start`
- `/giveaway end`
- `/giveaway reroll`
- `/giveaway list`

Die Dauer wird z. B. als `10m`, `2h`, `1d` angegeben.

## Giveaway-Channel

Optional: `/setup channel` → `Giveaways` auswählen.

## Railway

Pflichtvariable:

- `DISCORD_TOKEN`

Empfohlen: Railway Volume auf `/data`, damit Socials, Warnungen, Einstellungen und Giveaways Deployments überleben.

## Discord Developer Portal

Unter **Bot → Privileged Gateway Intents** aktivieren:

- Server Members Intent
- Message Content Intent

## GitHub Update

Die vorhandene `index.js` im Repo vollständig durch diese Version ersetzen und committen. Railway deployt danach neu.

## Eigene Embeds

`/embed` öffnet ein Formular für eigene Discord-Embed-Nachrichten.

Optionen beim Command:
- `channel` – Ziel-Channel (optional)
- `everyone` – optional @everyone

Im Formular:
- Titel
- Nachricht
- Farbe (z. B. `schwarz`, `rot`, `lila` oder `#5865F2`)
- Footer (optional)
- Bild-URL (optional)

Berechtigung: dieselbe Berechtigung wie `/announce` (Announcement-Rolle bzw. Server verwalten/Admin).


## Unban All

`/unbanall` entbannt nach einer Sicherheitsabfrage alle gebannten Nutzer. Benötigt **Mitglieder bannen** oder Administrator.

## Komplettes Server-Setup (v4)

Neu sind drei öffentliche Server-Designs und eine private Edition:

- `/setupserver design:1 bestaetigen:true` – Clean Community
- `/setupserver design:2 bestaetigen:true` – Gambo / Szene
- `/setupserver design:3 bestaetigen:true` – Minimal Elite
- `/setupserver design:4 bestaetigen:true` – UNFUGSTIFTER Private Edition

**Wichtig:** `/setupserver`, `/backupserver` und `/restoreserver` funktionieren ausschließlich für den aktuellen Discord-Server-Inhaber (Krone). Administrator oder „Server verwalten“ reicht dafür nicht.

Vor jedem vollständigen Setup wird automatisch ein Struktur-Backup erstellt. Zusätzlich kann mit `/backupserver` jederzeit manuell gesichert werden. `/restoreserver bestaetigen:true` stellt das zuletzt vorhandene Backup wieder her.

Discord lässt Rollen oberhalb der Bot-Rolle und verwaltete Integrations-/Bot-Rollen nicht löschen. Der Bot meldet solche Rollen nach dem Setup.

### Design 4 freischalten

Design 4 ist zusätzlich geschützt. Trage bei Railway unter **Variables** die Server-IDs ein, die Design 4 nutzen dürfen:

`PREMIUM_GUILD_IDS=SERVER_ID_1,SERVER_ID_2`

Optional kannst du deine eigene Discord-User-ID als Master hinterlegen:

`MASTER_USER_IDS=DEINE_DISCORD_USER_ID`

Auch ein Master-User muss auf dem jeweiligen Discord der echte Server-Inhaber sein, um `/setupserver` auszuführen.

### Benötigte Bot-Rechte

Für das vollständige Server-Setup braucht der Bot **Administrator**. Seine Bot-Rolle sollte möglichst ganz oben stehen, damit alte Rollen gelöscht und neue Rollen verwaltet werden können.

## Mehrere Discord-Server gleichzeitig

Die Bot-Daten werden ab dieser Version pro Discord-Server getrennt unter `guilds.<SERVER_ID>` gespeichert. Dadurch überschreiben sich z. B. Verifizierungsrollen, Ticket-Kategorien, Socials-Channels oder Setup-Designs nicht mehr gegenseitig, wenn dieselbe Bot-Instanz auf mehreren Servern läuft.

Beim ersten Start wird eine vorhandene alte Einzelserver-Konfiguration automatisch für den ersten verwendeten Server übernommen.
