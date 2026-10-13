# XVY Imperium Bot

Discord-Bot für **XVY Imperium**: Verifizierung mit Captcha, Willkommensnachrichten, Ticket-System mit Transkripten, Moderation mit Verwarnungen, Automod gegen Spam und Raids, und ein Shop mit Warenkorb und Bestell-Tickets.

## Einrichtung (einmalig)

1. **Bot anlegen:** <https://discord.com/developers/applications> → *New Application* → Name „XVY Imperium“.
2. **Bot → Privileged Gateway Intents:** **Server Members Intent** und **Message Content Intent** einschalten → *Save*.
3. **Bot → Reset Token** → Token kopieren und in Railway beim Dienst als Variable `DISCORD_TOKEN` eintragen.
4. **Einladen:** Der Bot schreibt nach dem Start den Einladungslink ins Railway-Log. Alternativ:
   `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&permissions=8&scope=bot%20applications.commands`
5. **Bot-Rolle nach oben ziehen:** *Servereinstellungen → Rollen*, die Bot-Rolle über **✅ Mitglied** und **💎 Kunde** ziehen.
6. Auf dem Server **`/setup`** ausführen. Das legt Rollen, Kanäle und Panels an.

## Befehle

| Bereich | Befehle |
|---|---|
| Einrichtung | `/setup`, `/panel`, `/config anzeigen · name · farbe · teamrolle · mitgliedrolle · zahlung · willkommen · regeln · captcha · automod` |
| Shop | `/produkt hinzufuegen · bearbeiten · entfernen · liste` – Kunden bestellen über das Shop-Panel |
| Tickets | Panel im Support-Kanal; im Ticket: `/ticket hinzufuegen · entfernen · schliessen` |
| Moderation | `/warn`, `/warns`, `/unwarn`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/clear`, `/lock`, `/unlock`, `/slowmode`, `/raidmode` |

## Automatisch

- **Automod:** löscht fremde Einladungslinks, Massen-Erwähnungen und Spam, gibt 5 Minuten Timeout und eine Verwarnung. Ab 3 Verwarnungen folgt 1 Stunde Timeout. Das Team ist ausgenommen.
- **Raid-Schutz:** Treten 8 Accounts in 30 Sekunden bei, werden 10 Minuten lang neue Accounts unter 7 Tagen gekickt, und das Team wird gepingt.
- **Logs** im Kanal `🛡️・mod-log`: Beitritte, Austritte, gelöschte und bearbeitete Nachrichten, Banns und alle Moderationsaktionen.
- **Transkripte** von Tickets und Bestellungen landen im Kanal `📁・ticket-log`, und der Kunde bekommt sie per DM.

## Technik

- Node.js ≥ 20, discord.js 14. Start mit `npm start`, Tests mit `npm test`.
- Daten liegen in `DATA_DIR`, auf Railway auf dem Volume unter `/data`, in der Datei `xvy-bot.json`.
- Health-Check: `GET /` auf `PORT`.
