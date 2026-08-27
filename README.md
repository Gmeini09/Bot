# Unfug Community Bot v9 – Changelog Design

Diese Version baut auf v8 auf und gestaltet die automatischen GitHub-Changelogs im reduzierten Stil der gewünschten Discord-Vorlage.

## Neu in v9 – Changelog Design

- Dunkles, minimalistisches Changelog-Embed
- Monospace-Layout wie in der Referenz
- Überschrift `Changelogs DD.MM.YYYY`
- Jeder GitHub-Commit erscheint als `(+) Commit-Nachricht`
- `@everyone` wird direkt darunter als eigene Nachricht gepostet
- Mit `CHANGELOG_PING_EVERYONE=false` kann der Ping deaktiviert werden
- Repository-Filter, GitHub-Signaturprüfung und Railway-Webhook bleiben erhalten

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


webhock Test 
