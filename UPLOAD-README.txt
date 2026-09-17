UNFUGSTIFTER SELLING BOT v5.8 AUTOMATION
=========================================

UPLOAD / UPDATE
1. Lade selling-entry.js in den Root deines GitHub-Repositories hoch und ersetze die vorhandene Datei.
2. Ersetze package.json durch die Version aus diesem ZIP.
3. Deine bestehende index.js bleibt unverändert bestehen.
4. Railway muss mit `node selling-entry.js` starten. Das package.json setzt dies bereits als Start-Script.
5. Nach dem Deploy den Bot einmal vollständig neu starten/deployen, damit die neuen Slash-Commands registriert werden.

ERSTES SETUP
- /setup server selling
- Nur der Server-Inhaber darf den Full Reset ausführen.
- Der Bot braucht Administrator und seine Bot-Rolle muss über allen normalen Rollen stehen.
- ACHTUNG: Der Full Reset löscht die bisherige normale Channel-/Rollenstruktur und baut den Selling-Server neu auf.

DANACH EMPFOHLEN
1. /sell wizard
   - PayPal-Adresse
   - Busy-Limit
   - Auto-Close-Limit
   - Reminder-Zeit
2. /sell product action:Preis setzen ...
   - Standardpreise eintragen. Dann wird der Preis bei Bestellungen automatisch übernommen.
3. /sell panel
   - Erstellt/aktualisiert das zentrale Staff-Control-Panel.

NORMALER BESTELLABLAUF
1. Kunde bestellt über den Shop-Katalog/Warenkorb.
2. Bot weist den Auftrag automatisch einem passenden Teammitglied zu, soweit möglich.
3. Im Ticket: Preis-Button benutzen, falls kein Standardpreis gesetzt ist.
4. Nach PayPal-Zahlung: Bezahlt drücken.
5. Bearbeitung drücken.
6. Produkt liefern drücken.
7. Innerhalb von 5 Minuten die fertige Datei direkt im Ticket hochladen.
8. Bot erledigt automatisch:
   - Delivery-Channel
   - Lizenz
   - Käuferrollen
   - PDF-Bestellbeleg
   - Bild-Watermarking (PNG/JPG/WEBP)
   - Sales-Log
   - Kunden-Abnahme
9. Kunde drückt Produkt akzeptieren oder Änderung anfordern.
10. Kunde kann Portfolio erlauben. Erst dann darf das Ergebnis automatisch öffentlich ins Portfolio übernommen werden.
11. Nach Abnahme wird das ursprüngliche Bestell-Ticket samt Transcript automatisch archiviert.

STAFF CONTROL CENTER
- Offene Aufträge
- Offene Zahlungen
- In Bearbeitung
- Queue
- Kunden
- Lizenzen
- Portfolio
- Security
- Health Check
- Refresh

NEUE COMMANDS
/sell panel
/sell search query:...
/sell profile user:@user
/sell product action:... produkt:... preis:...
/sell automation action:status|enable|disable
/sell wizard
/sell deliver order:UF-0001 datei:<Datei>

PORTFOLIO
- Manuell: /sell portfolio action:Hinzufügen titel:... datei:<Bild> kategorie:... beschreibung:... preis:...
- Automatisch: Kunde erlaubt Portfolio nach Lieferung -> der Bot übernimmt das gelieferte Ergebnis automatisch.
- Kein extra Bild-Link mehr nötig, wenn du direkt eine Datei hochlädst.

AUTOMATION
- Auto-Assign nach Produkttyp
- Team-Pings nach Kategorie
- Automatische Shop-Auslastung abhängig von aktiver Queue
- Zahlungs-Reminder
- Review-Reminder
- Auto-Close alter Delivery-Tickets
- Health Check / Self-Heal
- täglicher Automation-Report
- automatische Backups, maximal 5 Versionen

HINWEISE
- Direktes Bild-Watermarking funktioniert für Bilddateien. Andere Dateitypen erhalten Lizenz-/Bestellzuordnung und werden in den Delivery-Bereich übertragen.
- Große Dateien können abhängig von Discord-Uploadlimits nicht als Bot-Reupload verarbeitet werden; dann wird der Discord-Dateilink weitergereicht.
- Der Bot verlangt niemals PayPal-Passwörter oder 2FA-Codes.
- Für persistente Daten auf Railway wird ein Volume empfohlen.
