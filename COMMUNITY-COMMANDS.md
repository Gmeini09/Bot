# Unfug Community Bot v7 – Commands


## Regelwerk

- `/regelwerk anzeigen` – aktuelles Regelwerk anzeigen
- `/regelwerk bearbeiten` – Regelwerk per Modal bearbeiten
- `/regelwerk posten [channel]` – Regelwerk posten bzw. vorhandenen Post aktualisieren
- `/regelwerk reset` – Design-Standard wiederherstellen

`bearbeiten`, `posten` und `reset` benötigen Server-verwalten oder Administrator.

## Coins & Aktivität

- `/daily` – tägliche Coins + Streak
- `/coins balance [user]` – Coin-Stand anzeigen
- `/coins leaderboard` – Coin-Bestenliste
- `/missions view` – tägliche Missionen anzeigen
- `/missions claim mission:<...>` – fertige Mission abholen
- `/season [user]` – aktuelle Season-Punkte und Platzierung
- `/seasonleaderboard` – Season Top 10

## Shop

- `/shop list` – alle Shop-Items
- `/shop buy id:<id>` – Rolle mit Coins kaufen
- `/shop add id:<id> name:<name> preis:<coins> rolle:<rolle>` – Shop-Rolle hinzufügen
- `/shop remove id:<id>` – Shop-Item entfernen

`/shop add` und `/shop remove` benötigen Server-verwalten oder Administrator.

## Engagement Setup

- `/engagement setup channel:<channel>` – Coins, Missionen, Seasons, Live-Panel und Drops aktivieren
- `/engagement status` – Status anzeigen
- `/engagement drop` – manuellen Coin-Drop starten

Beim `/setupserver` wird das Engagement-System automatisch mit dem neuen Activity-Hub verbunden.

## Server Designer & Backup

- `/setupserver design:1 bestaetigen:true` – Clean Community
- `/setupserver design:2 bestaetigen:true` – Gambo / Szene • Redline
- `/setupserver design:3 bestaetigen:true` – Minimal Elite • Obsidian
- `/setupserver design:4 bestaetigen:true` – private UNFUGSTIFTER Edition
- `/backupserver`
- `/restoreserver bestaetigen:true`

Diese drei Server-Struktur-Befehle sind nur für den echten Server-Inhaber verfügbar.

## Bereits vorhandene Community-Funktionen

- `/rep`, `/reps`
- `/communityrank`, `/communityleaderboard`
- `/clip submit`, `/clip top`, `/clip finish`
- `/mitspieler create`, `/mitspieler list`, `/mitspieler close`
- `/challenge create`, `/challenge list`, `/challenge end`
- `/game start`, `/game stop`, `/game quiz`, `/game leaderboard`, `/game status`
- `/badges`
- `/profil`, `/profilset`
- `/frage ...`
- `/communitypoll ...`
- `/memberofthemonth ...`
- `/anonymouspanel`, `/anonymousinfo`
- `/interessen ...`

## Automatik

- Text- und Voice-Aktivität
- XP / Level
- Coins mit Chat-Cooldown
- Voice-Coin-Rewards
- tägliche Missionen
- monatliche Seasons
- Live Activity Panel
- Random Coin Drops
- Frage des Tages
- Community-Umfragen
- Mitglied des Monats
- Clip der Woche
- Giveaways
- AutoMod
- Invite-Tracking


## GitHub / Changelog

- Automatischer Changelog bei jedem GitHub-`push` über `/github-webhook`
- Ziel-Channel: `1542411163630051358`
- Kein Slash-Command nötig; GitHub löst den Post automatisch aus
