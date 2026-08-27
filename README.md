# Unfug Community Bot v10 – Discord Management

Diese Version baut auf v9 auf und erweitert den Bot zu einem deutlich stärkeren Discord-Management-Bot.

## Neu in v10

- **Anti-Nuke 2.0**: erkennt schnelle Channel-/Rollen-Löschungen, Bans, Kicks und Webhook-Aktionen. Bei einem klaren Burst werden entfernbare gefährliche Rollen des Auslösers entzogen und der Owner informiert.
- **Self-Healing**: kritische, vom Setup verwaltete Channels/Kategorien werden nach einer Löschung automatisch neu erstellt und in der Bot-Konfiguration ersetzt.
- **`/servercheck`**: prüft Bot-Rechte, kritische Channel-/Rollen-IDs, Staff-Privatsphäre und veraltete Temp-Voice-Einträge.
- **`/permissionscan`**: listet Rollen mit Administrator, Manage Server, Manage Roles, Manage Channels, Ban/Kick oder Manage Webhooks.
- **`/dashboard`**: Owner-only Dashboard mit Servercheck, Backup, Permission Scanner sowie Schaltern für Anti-Nuke, Self-Healing und AutoMod.
- **Ticket-System 2.0**: Support, Kauf, Partnerschaft, Report und Entbannung als getrennte Ticket-Typen; Ticket-ID, Claiming, Priorität und Info-Ansicht.
- **Temp-Voice 2.0**: Control-Panel, Lock/Unlock, Limit +/- und Ownership-Transfer.
- **Mod-Cases**: Warn, Timeout, Kick und Ban erzeugen automatisch fortlaufende Case-IDs; `/case` zeigt die Akte und erlaubt interne Notizen.
- Beim **`/setupserver`** werden Anti-Nuke und Self-Healing automatisch aktiviert. Die restliche Bot-Konfiguration und Panels werden weiterhin automatisch eingerichtet.
- GitHub Push-Changelogs aus v9 bleiben vollständig erhalten.

## Wichtige Commands

- `/servercheck`
- `/permissionscan`
- `/dashboard`
- `/antinuke enable|disable|status|whitelist|unwhitelist`
- `/selfheal enable|disable|status`
- `/case user|view|note`
- `/ticket priority|info`
- `/voice transfer|panel`

## Railway

Pflichtvariable:

`DISCORD_TOKEN`

Für GitHub-Changelogs zusätzlich:

- `GITHUB_WEBHOOK_SECRET`
- `CHANGELOG_CHANNEL_ID=1542411163630051358`
- `GITHUB_REPO=Gmeini09/Bot`

Empfohlen:

- Railway Volume auf `/data`
- `COMMUNITY_TIMEZONE=Europe/Vienna`

## Discord Rechte

Für `/setupserver`, Backups, Self-Healing und den vollen Anti-Nuke-Schutz sollte der Bot **Administrator** besitzen. Der Bot liest für Anti-Nuke außerdem Discord-Audit-Logs.

Im Developer Portal weiterhin aktivieren:

- Server Members Intent
- Message Content Intent

## Update

1. Inhalt dieses Ordners in dein GitHub-Repository übernehmen.
2. Commit + Push.
3. Railway deployt automatisch neu.
4. In Railway Logs auf `✅ Eingeloggt als ...` achten.
5. Auf einem Testserver zuerst `/servercheck` und `/dashboard` testen.
