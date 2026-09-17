UNFUGSTIFTER SELLING SETUP v5.4

1. Lade selling-entry.js in den Hauptordner deines GitHub-Repos Gmeini09/Bot.
2. Ersetze die bestehende package.json durch die package.json aus diesem Paket.
3. Railway deployt nach dem Push normalerweise automatisch neu.
4. Falls du bei Railway einen eigenen Start Command gesetzt hast, ändere ihn auf:
   node selling-entry.js
5. Nach dem Bot-Neustart erscheint:
   /setup server selling
6. Der Command kann nur vom Server-Inhaber ausgeführt werden und der Bot braucht Administrator.

ENTHALTEN AUS v5.3:
- Zahlung fest auf PayPal ausgelegt
- eigener privater Support-Ticket-Button
- Kauf-Tickets und Support-Tickets können parallel offen sein
- deutlich erweitertes Shop-Regelwerk
- Weiterverkauf verboten
- Leaken / Teilen / Reupload verboten
- Ticket-/Bestellaktionen werden nachvollziehbar protokolliert
- Warnung vor gefälschten Zahlungsnachweisen
- PayPal-Login-Daten werden niemals verlangt
- neue Discord-Server bekommen die Slash-Commands automatisch registriert

NEU IN v5.4 – FULL RESET:
- /setup server selling entfernt zuerst die komplette alte normale Server-Struktur.
- Alle alten Channels werden gelöscht.
- Alle normalen, vom Bot löschbaren Rollen werden gelöscht.
- @everyone sowie Discord-System-, Bot-, Integrations- und Booster-Rollen können technisch nicht gelöscht werden und bleiben bestehen.
- Vor dem Löschen prüft der Bot die Rollen-Hierarchie. Liegt eine normale Rolle über der Bot-Rolle, startet der Reset NICHT.
- Der Command-Channel bleibt nur kurz für die Abschlussmeldung erhalten und wird danach ebenfalls gelöscht.
- Während des Resets werden die Self-Heal-/Delete-Handler des Hauptbots für diese absichtlichen Löschungen unterdrückt.
- Danach wird der professionelle Selling-Server vollständig neu erstellt.

WICHTIG:
Die Bot-Rolle muss im Discord-Rollenmenü über allen normalen Rollen stehen und der Bot braucht Administrator.
Der Full Reset ist absichtlich destruktiv. Führe /setup server selling nur auf dem Server aus, den du wirklich vollständig ersetzen willst.

Erstellt werden u.a.:
- Thumbnails
- NVE-Presets / Grafik-Setups
- Soundpacks
- Grafik-Designs
- FiveM-Assets
- Bundles
- Bestellbereich
- PayPal-Zahlungsinfo
- Bewertungen / Kunden-Ergebnisse
- Support-Chat
- privates Support-Ticket-System
- Team-Bereich
- privates Kauf-Ticket-System mit Produkt-Buttons

Hinweis: Der Shop-Text ist auf eigene bzw. lizenzierte Dateien/Assets ausgelegt und nicht auf unerlaubte Reuploads oder gecrackte Drittanbieter-Inhalte.


V5.3: Professionelles 3-teiliges Regelwerk/Lizenzbedingungen, strengere Anti-Leak-Regeln, strukturierte PayPal-Abwicklung und vier getrennte Support-Ticket-Arten.

V5.4: Full-Reset-Modus – bestehende normale Rollen und Channels werden entfernt und der Shop anschließend komplett neu aufgebaut.
