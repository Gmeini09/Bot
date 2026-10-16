# XVY Kaiserreich Bot

Discord-Bot für **XVY Kaiserreich**: Verifizierung mit Captcha, Willkommensnachrichten, Ticket-System mit Transkripten, Moderation mit Verwarnungen, Automod gegen Spam und Raids, und ein Shop mit Warenkorb und Bestell-Tickets.

## Einrichtung (einmalig)

1. **Bot anlegen:** <https://discord.com/developers/applications> → *New Application* → Name „XVY Kaiserreich“.
2. **Bot → Privileged Gateway Intents:** **Server Members Intent** und **Message Content Intent** einschalten → *Save*.
3. **Bot → Reset Token** → Token kopieren und in Railway beim Dienst als Variable `DISCORD_TOKEN` eintragen.
4. **Einladen:** Der Bot schreibt nach dem Start den Einladungslink ins Railway-Log. Alternativ:
   `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&permissions=8&scope=bot%20applications.commands`
5. **Bot-Rolle nach oben ziehen:** *Servereinstellungen → Rollen*, die Bot-Rolle über die Rollen ziehen, die er vergeben soll.
6. Kanäle und Rollen zuordnen: `/config kanal` (Willkommen, Verifizieren, Shop, Tickets, Logs, Kategorien), `/config teamrolle`, `/config mitgliedrolle`, optional `/config kundenrolle`. Danach postet **`/setup`** die Panels in diese Kanäle.

   Der Bot legt **keine** Kanäle oder Rollen an und ändert die bestehende Server-Struktur nicht. Für XVY Imerpium ist die Zuordnung fest hinterlegt (`src/adopt.js`) und wird beim ersten Start automatisch übernommen.

## Befehle

| Bereich | Befehle |
|---|---|
| Einrichtung | `/setup`, `/panel`, `/config anzeigen · kanal · teamrolle · mitgliedrolle · kundenrolle · name · farbe · zahlung · willkommen · regeln · captcha · automod` |
| Shop | `/produkt hinzufuegen · bearbeiten · bild · entfernen · liste` – Kunden bestellen über das Shop-Panel; nach „Geliefert“ bewerten sie mit 1–5 Sternen (→ Feedback-Kanal) |
| Tickets | Panel im Support-Kanal; im Ticket: `/ticket hinzufuegen · entfernen · schliessen` |
| Giveaways | `/giveaway start · beenden · neu-ziehen · liste` – Teilnehmen-Button, Gewinner werden automatisch gezogen. Erlaubt für Admins, das Team und die Rolle **giveaway perms** |
| Rollen | `/rollen hinzufuegen · entfernen · panel` – bestehende Rollen per Button selbst wählen (keine Rollen mit Mod-/Admin-Rechten) |
| Statistik | `/stats` – Bestellungen, Umsatz, Top-Produkte, Bewertungen, Tickets, Giveaways |
| Moderation | `/warn`, `/warns`, `/unwarn`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/clear`, `/lock`, `/unlock`, `/slowmode`, `/raidmode` |

## Automatisch

- **Automod:** löscht fremde Einladungslinks, Massen-Erwähnungen und Spam, gibt 5 Minuten Timeout und eine Verwarnung. Ab 3 Verwarnungen folgt 1 Stunde Timeout. Das Team ist ausgenommen.
- **Raid-Schutz:** Treten 8 Accounts in 30 Sekunden bei, werden 10 Minuten lang neue Accounts unter 7 Tagen gekickt, und das Team wird gepingt.
- **Logs** im eingestellten Mod-Log-Kanal: Beitritte, Austritte, gelöschte und bearbeitete Nachrichten, Banns und alle Moderationsaktionen.
- **Transkripte** von Tickets und Bestellungen landen im Ticket-Log-Kanal, und der Kunde bekommt sie per DM.

## Technik

- Node.js ≥ 20, discord.js 14. Start mit `npm start`, Tests mit `npm test`.
- Daten liegen in `DATA_DIR`, auf Railway auf dem Volume unter `/data`: `xvy-bot.json` und Produktbilder in `images/`.
- Health-Check: `GET /` auf `PORT`.
