# XVY Kaiserreich Bot

Discord-Bot für **XVY Kaiserreich**: Verifizierung mit Captcha, Willkommensnachrichten, Ticket-System mit Transkripten, Moderation mit Verwarnungen, Automod gegen Spam und Raids, und ein Shop mit Warenkorb und Bestell-Tickets.

## Einrichtung (einmalig)

1. **Bot anlegen:** <https://discord.com/developers/applications> → *New Application* → Name „XVY Kaiserreich“.
2. **Bot → Privileged Gateway Intents:** **Server Members Intent** und **Message Content Intent** einschalten → *Save*.
3. **Bot → Reset Token** → Token kopieren und in Railway beim Dienst als Variable `DISCORD_TOKEN` eintragen.
4. **Einladen – ohne Administrator:** Der Bot schreibt nach dem Start den Einladungslink mit genau den nötigen Rechten ins Railway-Log; `/rechte` zeigt ihn ebenfalls und prüft, ob etwas fehlt (auch pro Kanal).
   Rechte: Kanäle/Rollen/Nicknames/Nachrichten verwalten, Server verwalten (Invite-Tracking), Kicken, Bannen, Timeout, Audit-Log, Kanäle ansehen, Senden, Links einbetten, Dateien, Verlauf, Reaktionen, externe Emojis, Threads, Nickname ändern.
5. **Bot-Rolle nach oben ziehen:** *Servereinstellungen → Rollen*, die Bot-Rolle über die Rollen ziehen, die er vergeben soll.
6. Kanäle und Rollen zuordnen: `/config kanal` (Willkommen, Verifizieren, Shop, Tickets, Logs, Kategorien), `/config teamrolle`, `/config mitgliedrolle`, optional `/config kundenrolle`. Danach postet **`/setup`** die Panels in diese Kanäle.

   Der Bot legt **keine** Kanäle oder Rollen an und ändert die bestehende Server-Struktur nicht. Für XVY Imerpium ist die Zuordnung fest hinterlegt (`src/adopt.js`) und wird beim ersten Start automatisch übernommen.

## Befehle

| Bereich | Befehle |
|---|---|
| Einrichtung | `/setup`, `/panel`, `/rechte`, `/backup`, `/config anzeigen · kanal · teamrolle · mitgliedrolle · kundenrolle · name · farbe · zahlung · willkommen · willkommensbild · regeln · captcha · tickets · automod` |
| Shop | `/produkt hinzufuegen · bearbeiten · bild · bestand · entfernen · liste`, `/rabatt erstellen · loeschen · liste` – Bestand mit „ausverkauft“ und 🔔-Benachrichtigung, Rabattcodes (Prozent oder Betrag, Ablauf, max. Nutzungen, je Mitglied einmal) beim Bestellen; Kunden bestellen über das Shop-Panel; nach „Geliefert“ bewerten sie mit 1–5 Sternen (→ Feedback-Kanal) |
| Tickets | Panel im Support-Kanal; im Ticket: `/ticket hinzufuegen · entfernen · schliessen` |
| Giveaways | `/giveaway start · beenden · neu-ziehen · liste` – Teilnehmen-Button, Gewinner werden automatisch gezogen. Erlaubt für Admins, das Team und die Rolle **giveaway perms** |
| Rollen | `/rollen hinzufuegen · entfernen · panel` – bestehende Rollen per Button selbst wählen (keine Rollen mit Mod-/Admin-Rechten) |
| Invites | `/invites anzeigen · rangliste` – wer wen eingeladen hat; wieder gegangene und neue Accounts (< 7 Tage) zählen nicht |
| Statistik | `/stats` – Bestellungen, Umsatz, Top-Produkte, Bewertungen, Tickets, Giveaways |
| Moderation | `/warn`, `/warns`, `/unwarn`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/clear`, `/lock`, `/unlock`, `/slowmode`, `/raidmode` |

## Automatisch

- **Automod:** löscht fremde Einladungslinks, Massen-Erwähnungen und Spam, gibt 5 Minuten Timeout und eine Verwarnung. Ab 3 Verwarnungen folgt 1 Stunde Timeout. Das Team ist ausgenommen.
- **Raid-Schutz:** Treten 8 Accounts in 30 Sekunden bei, werden 10 Minuten lang neue Accounts unter 7 Tagen gekickt, und das Team wird gepingt.
- **Logs** im eingestellten Mod-Log-Kanal: Beitritte (mit Einlader), Austritte, gelöschte und bearbeitete Nachrichten, Banns, alle Moderationsaktionen – und wer wem Rollen gibt/nimmt, Nicknames, Timeouts aus dem Discord-Menü, Kanäle und Rollen erstellt/gelöscht, Rechte-Änderungen an Rollen (Admin → Team-Ping).
- **Tickets ohne Antwort:** nach 48 h Erinnerung, 24 h später automatisch geschlossen (mit Transkript). `/config tickets`.
- **Willkommensbild** mit Avatar, Name und Mitgliedsnummer (`/config willkommensbild`).
- **Mitgliederliste** der Rang-Rollen, aktualisiert sich selbst.
- **Sicherungen:** täglich eine Kopie der Daten unter `/data/backups` (14 Tage).
- **Transkripte** von Tickets und Bestellungen landen im Ticket-Log-Kanal, und der Kunde bekommt sie per DM.

## Technik

- Node.js ≥ 20, discord.js 14. Start mit `npm start`, Tests mit `npm test`.
- Daten liegen in `DATA_DIR`, auf Railway auf dem Volume unter `/data`: `xvy-bot.json` und Produktbilder in `images/`.
- Health-Check: `GET /` auf `PORT`.
