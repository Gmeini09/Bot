# Unfug Community Bot – All-in-One v7

Diese Version baut auf v6 auf und ergänzt das Engagement-System um ein vollständiges, editierbares Regelwerk-System.


## Neu in v7 – `/regelwerk`

- `/regelwerk anzeigen` – zeigt das aktuelle Regelwerk privat an
- `/regelwerk bearbeiten` – öffnet einen Editor für Titel, Regeln und Footer
- `/regelwerk posten [channel]` – veröffentlicht das Regelwerk oder aktualisiert den bestehenden Regelwerk-Post
- `/regelwerk reset` – setzt auf das Regelwerk des aktuell installierten Server-Designs zurück
- Beim Bearbeiten wird ein bereits veröffentlichter Regelwerk-Post automatisch aktualisiert
- `/setupserver` speichert den angelegten Regelwerk-Channel automatisch
- `/setup channel typ:Regelwerk` kann einen bestehenden Regelwerk-Channel manuell verbinden
- Bearbeiten/Posten/Reset benötigen **Server verwalten** oder Administrator; Anzeigen ist für alle möglich

## Engagement-System aus v6

### Daily + Streaks
- `/daily`
- tägliche Coins
- Streak-Bonus
- persönlicher Best-Streak
- Season Points

### Coins
- `/coins balance`
- `/coins leaderboard`
- Coins durch Daily, Missionen, Aktivität und Random Drops
- Chat-Rewards besitzen einen Cooldown, damit Spam nicht belohnt wird
- Voice-Rewards werden nach Voice-Sessions gutgeschrieben

### Missionen
- `/missions view`
- `/missions claim`

Tägliche Missionen:
- 15 Nachrichten
- 30 Minuten Voice
- an einer Community-Umfrage teilnehmen
- Daily abholen

Missionen geben Coins und Season Points.

### Community Shop
- `/shop list`
- `/shop buy`
- `/shop add`
- `/shop remove`

Admins können Discord-Rollen als Shop-Items hinterlegen. Der Bot prüft die Rollen-Hierarchie und zieht Coins erst nach erfolgreicher Vergabe ab.

### Seasons
- `/season`
- `/seasonleaderboard`
- automatische monatliche Season über die konfigurierte Community-Zeitzone
- Season Points durch Daily, Missionen, Chat, Voice und Drops

### Random Drops
- automatische `UNFUG DROP`-Events im Activity-Hub
- erster Klick gewinnt zufällig 100–300 Coins
- Drop läuft nach 5 Minuten ab
- automatische Drops haben einen Mindestabstand, damit der Channel nicht zugespammt wird
- `/engagement drop` startet als Admin einen Drop manuell

### Live Activity Panel
- zeigt heutige Nachrichten, Voice-Zeit, neue Mitglieder und aktuell verbundene Voice-Mitglieder
- zeigt Top 3 Aktivität, Season und Coins
- aktualisiert sich automatisch
- `/engagement setup channel:#channel` kann das System manuell einrichten
- `/engagement status` zeigt den aktuellen Zustand

## Server-Designs

- `/setupserver design:1 bestaetigen:true` – Clean Community
- `/setupserver design:2 bestaetigen:true` – Gambo / Szene • Redline
- `/setupserver design:3 bestaetigen:true` – Minimal Elite • Obsidian
- `/setupserver design:4 bestaetigen:true` – UNFUGSTIFTER Private Edition

Alle vier Designs erhalten jetzt einen eigenen Activity-Hub. Beim vollständigen Setup werden Coins, Missionen, Seasons, Live-Panel und Random Drops automatisch aktiviert.

**Wichtig:** `/setupserver`, `/backupserver` und `/restoreserver` funktionieren ausschließlich für den aktuellen Discord-Server-Inhaber. Normale Administratorrechte reichen dafür nicht.

Vor jedem vollständigen Setup wird automatisch ein Struktur-Backup erstellt.

## Design 4 freischalten

Railway Variable:

`PREMIUM_GUILD_IDS=SERVER_ID_1,SERVER_ID_2`

Optional:

`MASTER_USER_IDS=DEINE_DISCORD_USER_ID`

Auch ein Master-User muss auf dem jeweiligen Discord der echte Server-Inhaber sein.

## Railway

Pflichtvariable:

`DISCORD_TOKEN`

Empfohlen:

- Railway Volume auf `/data`
- `COMMUNITY_TIMEZONE=Europe/Vienna`

So bleiben Daten nach Deployments erhalten und Dailys/Seasons verwenden die richtige Zeitzone.

## Discord Developer Portal

Unter **Bot → Privileged Gateway Intents** aktivieren:

- Server Members Intent
- Message Content Intent

Der Bot benötigt für `/setupserver` Administratorrechte. Für Shop-Rollen muss seine Bot-Rolle über den Rollen liegen, die im Shop vergeben werden sollen.

## GitHub / Railway Update

1. Inhalt dieses Ordners in dein GitHub-Repository übernehmen.
2. Commit + Push.
3. Railway startet bei aktivem GitHub-Deploy automatisch neu.
4. Im Railway-Log auf `✅ Eingeloggt als ...` und die Command-Registrierung achten.
5. Auf einem Testserver zuerst `/engagement status` bzw. `/setupserver` testen.
