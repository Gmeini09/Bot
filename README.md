# Unfug Community Bot v11 – Management Pro

Diese Version baut auf v10 auf und ergänzt die Discord-Management-Funktionen um Analytics, automatische Reports, Ticket-SLA, Auto-Backups, Module und permanente Commandlisten.

## Neu in v11

- **Permanente Commandlisten:** `/command user` und `/command team` posten getrennte User-/Team-Embeds. Die Message-ID wird gespeichert und die Embeds werden nach jedem Bot-Deployment automatisch aktualisiert.
- **Automatisch im `/setupserver`:** Jedes Design erhält einen öffentlichen `commands`-Channel, einen privaten `team-commands`-Channel und einen privaten `server-analytics`-Channel. Die Command-Embeds werden direkt beim Setup gepostet.
- **Server Analytics Pro:** `/analytics zeitraum:<Heute|7 Tage|30 Tage>` zeigt Joins, Leaver, Netto-Wachstum, Nachrichten und Voice-Zeit.
- **Weekly Report:** `/weeklyreport ...`; beim vollständigen `/setupserver` und beim Setup-Update automatisch aktiviert. Standard: Sonntag ab 19:00 Uhr in der konfigurierten Zeitzone.
- **Staff Performance:** `/staffstats` kombiniert geschlossene/übernommene Tickets, Mod-Cases, Duty-Zeit und durchschnittliche erste Ticket-Antwort.
- **Ticket SLA:** `/ticketsla ...` erinnert das Support-Team automatisch, wenn ein offenes Ticket nach der eingestellten Zeit noch keine Team-Antwort erhalten hat. Standard: 30 Minuten.
- **Module Manager:** `/modules status|enable|disable` für Analytics, Weekly Report, Staff Stats, Ticket SLA, Auto Backup, Command Panels, Engagement, Anti-Nuke, Self-Healing und AutoMod.
- **Bot Health Monitor:** `/botstatus` zeigt Ping, Uptime, RAM, Command-Anzahl, Guilds, GitHub-Webhook-Status und Datenversion.
- **Auto Backups:** `/autobackup enable|disable|status`; nach `/setupserver` standardmäßig täglich um 03:00 Uhr aktiv. Es bleiben maximal die letzten 5 Backups erhalten.
- **Setup Update ohne Reset:** `/setupserver design:<1-4> modus:update bestaetigen:true` ergänzt fehlende Rollen, Kategorien, Channels und v11-Panels, ohne die vorhandene Struktur absichtlich zu löschen.
- Das vorhandene **Anti-Nuke, Self-Healing, Ticket 2.0, Temp Voice, Mod-Cases, Regelwerk, Engagement und GitHub-Changelog-System** bleibt erhalten.

## Empfohlener Update-Ablauf für einen bestehenden Discord

1. v11-Dateien ins GitHub-Repository hochladen.
2. Railway deployen lassen.
3. Auf dem Discord als Server-Inhaber ausführen:
   - `/setupserver design:<dein Design> modus:update bestaetigen:true`
4. Dadurch werden insbesondere `commands`, `team-commands` und `server-analytics` ergänzt und die permanenten Commandlisten gepostet.
5. Mit `/servercheck`, `/dashboard` und `/botstatus` prüfen.

## Wichtige neue Commands

- `/command user [channel]`
- `/command team [channel]`
- `/analytics [zeitraum]`
- `/weeklyreport setup|disable|status|post`
- `/staffstats`
- `/modules status|enable|disable`
- `/ticketsla status|enable|disable|set`
- `/botstatus`
- `/autobackup status|enable|disable`
- `/setupserver design:<1-4> modus:update bestaetigen:true`

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

Für vollständiges Server-Setup, Auto-Backups, Self-Healing und Anti-Nuke sollte die Bot-Rolle **Administrator** besitzen und weit oben in der Rollen-Hierarchie stehen.
