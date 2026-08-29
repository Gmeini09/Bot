# Unfug Community Bot v11 – Command Übersicht

## Permanente Commandlisten

- `/command user [channel]` – erstellt/aktualisiert das permanente User-Command-Embed.
- `/command team [channel]` – erstellt/aktualisiert das permanente Team-Command-Embed.
- Nach einem Bot-Neustart/Deployment werden gespeicherte Command-Embeds automatisch aktualisiert.
- `/setupserver` erstellt passende Channels und postet beide Listen automatisch.

## Management Pro

- `/analytics zeitraum:<Heute|7 Tage|30 Tage>`
- `/weeklyreport setup channel:<channel>`
- `/weeklyreport status`
- `/weeklyreport post`
- `/weeklyreport disable`
- `/staffstats`
- `/modules status`
- `/modules enable modul:<...>`
- `/modules disable modul:<...>`
- `/ticketsla status`
- `/ticketsla set minuten:<5-1440>`
- `/ticketsla enable`
- `/ticketsla disable`
- `/botstatus`
- `/autobackup enable [stunde]`
- `/autobackup status`
- `/autobackup disable`

## Server Setup

- `/setupserver design:<1-4> modus:neu bestaetigen:true` – kompletter Neuaufbau mit Backup.
- `/setupserver design:<1-4> modus:update bestaetigen:true` – ergänzt fehlende Design-/Bot-Bestandteile ohne absichtliches Löschen.
- `/backupserver`
- `/restoreserver bestaetigen:true`
- `/servercheck`
- `/permissionscan`
- `/dashboard`

## Security

- `/antinuke enable|disable|status|whitelist|unwhitelist`
- `/selfheal enable|disable|status`
- `/automod ...`
- `/case user|view|note`
- `/warn`, `/warnings`, `/clearwarnings`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/unbanall`

## Tickets / Support

- `/ticketpanel`
- `/ticket add|remove|close|priority|info`
- `/applicationpanel`
- `/applicationlist`
- Ticket-Typen: Support, Kauf, Partnerschaft, Report und Entbannung.

## User Commands (Auswahl)

- Allgemein: `/help`, `/ping`, `/serverinfo`, `/userinfo`, `/avatar`, `/regelwerk anzeigen`
- Aktivität: `/daily`, `/coins`, `/missions`, `/season`, `/seasonleaderboard`, `/shop`
- Community: `/rank`, `/leaderboard`, `/invites`, `/inviteleaderboard`, `/rep`, `/reps`, `/communityrank`, `/communityleaderboard`
- Gemeinsam: `/event`, `/clip`, `/mitspieler`, `/challenge`, `/game`, `/badges`
- Profil/Socials: `/profil`, `/profilset`, `/interessen`, `/mysocials`, `/socialinfo`, `/sociallist`

## Weitere bestehende Systeme

Regelwerk, Giveaways, Level, Events, Duty, Custom Commands, Frage des Tages, Community-Polls, Mitglied des Monats, Clips, Mitspielersuche, Challenges, Profile, Badges, Interessen, anonyme Nachrichten, Socials, Temp Voice, Engagement/Coins/Missionen/Seasons sowie GitHub Push-Changelogs bleiben enthalten.
