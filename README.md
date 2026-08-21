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
