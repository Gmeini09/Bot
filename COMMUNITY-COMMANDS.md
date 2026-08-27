# Unfug Community Bot v10 – Commands

## Server Management

- `/setupserver design:<1-4> bestaetigen:true` – erstellt den kompletten Discord inklusive Rollen, Channels, Permissions, Panels und Bot-Verknüpfungen
- `/backupserver` – Serverstruktur sichern
- `/restoreserver bestaetigen:true` – letztes Backup wiederherstellen
- `/servercheck` – Server- und Bot-Konfiguration prüfen
- `/permissionscan` – kritische Rollenrechte anzeigen
- `/dashboard` – Owner Dashboard

## Security

- `/antinuke enable`
- `/antinuke disable`
- `/antinuke status`
- `/antinuke whitelist user:<user>`
- `/antinuke unwhitelist user:<user>`
- `/selfheal enable`
- `/selfheal disable`
- `/selfheal status`
- `/automod ...`

## Tickets 2.0

Das Ticket-Panel bietet automatisch:

- Support
- Kauf
- Partnerschaft
- Report
- Entbannung

Commands:

- `/ticket add user:<user>`
- `/ticket remove user:<user>`
- `/ticket close`
- `/ticket priority stufe:<Normal|Wichtig|Dringend>`
- `/ticket info`

## Temp Voice 2.0

- `/tempvoice setup ...`
- `/tempvoice disable`
- `/tempvoice status`
- `/voice name`
- `/voice limit`
- `/voice lock`
- `/voice unlock`
- `/voice permit`
- `/voice reject`
- `/voice transfer user:<user>`
- `/voice panel`

## Mod-Cases

Warn, Timeout, Kick und Ban erhalten automatisch eine Case-ID.

- `/case user user:<user>` – Akte eines Users
- `/case view id:<id>` – einzelnen Case anzeigen
- `/case note id:<id> text:<text>` – interne Notiz hinzufügen

## Regelwerk

- `/regelwerk anzeigen`
- `/regelwerk bearbeiten`
- `/regelwerk posten [channel]`
- `/regelwerk reset`

## GitHub / Changelog

- Jeder GitHub Push an den eingerichteten Webhook wird automatisch im Changelog-Channel gepostet.
- Das v9 Monospace-Design mit `(+)` Einträgen und optionalem `@everyone` bleibt erhalten.

## Weitere Systeme

Daily, Coins, Missionen, Seasons, Shop, Activity Hub, Giveaways, Level, Invites, Events, Duty, Bewerbungen, Socials, Clips, Mitspielersuche, Challenges, Community-Umfragen, Mitglied des Monats, Profile, Badges, Interessen, anonyme Nachrichten und Custom Commands bleiben enthalten.
