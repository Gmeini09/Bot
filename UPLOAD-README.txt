UNFUGSTIFTER SELLING SETUP v5.5

INSTALLATION
1. Lade selling-entry.js in den Hauptordner deines GitHub-Repos Gmeini09/Bot.
2. Ersetze die bestehende package.json durch die package.json aus diesem Paket.
3. Railway deployt nach dem Push normalerweise automatisch neu.
4. Falls Railway einen eigenen Start Command verwendet, setze ihn auf:
   node selling-entry.js
5. Nach dem Neustart stehen /setup server selling und /sell zur Verfügung.

WICHTIG FÜR /setup server selling
- Nur der aktuelle Discord-Server-Inhaber kann den Command ausführen.
- Der Bot braucht Administrator.
- Die Bot-Rolle muss über allen normalen Rollen stehen.
- Der Command ist absichtlich destruktiv: Alle löschbaren alten Channels und normalen Rollen werden entfernt.
- @everyone sowie Discord-/Bot-/Integrationsrollen können technisch nicht gelöscht werden.
- Der Ausführungs-Channel bleibt nur bis zur Abschlussmeldung und wird danach ebenfalls gelöscht.

NEU IN v5.5 – PROFESSIONELLES SELLING-SYSTEM

BESTELLUNGEN
- Strukturierte Produkt-Auswahl per Buttons.
- Vor Ticket-Erstellung öffnet sich ein Bestellformular.
- Automatische Bestellnummern: UF-0001, UF-0002, ...
- Gespeichert werden Produkt, Kunde, Wünsche, Referenzen, Wunschtermin, Rabatt, Preis, Status, Revisionen, Bearbeiter und Lieferung.
- Shop-Daten liegen persistent in selling-data.json und bleiben bei Railway-Neustarts erhalten.

STATUS & TEAM
- Zahlung offen
- Bezahlt
- In Bearbeitung
- Geliefert
- Streitfall / Problem
- Mitarbeiter können Bestellungen übernehmen.
- Status kann über Buttons im Ticket oder /sell order geändert werden.
- Preis und inkludierte Revisionen können über /sell order gesetzt werden.

PAYPAL
- Zahlungsart ist PayPal.
- /sell paypal setzt die interne PayPal-Empfängeradresse.
- Die Adresse wird dem Kunden im Kauf-Ticket bestätigt.
- Der Bot fordert niemals Passwort, 2FA-Code oder Login-Code an.

RABATTCODES
- /sell coupon add
- /sell coupon remove
- /sell coupon list
- Prozent, maximale Nutzungen und Ablaufzeit können gesetzt werden.
- Rabatt wird automatisch bei der Preisberechnung berücksichtigt.

KÄUFERROLLEN & LIZENZEN
- Nach bestätigter Zahlung werden Kunde- und Produkt-Käuferrolle automatisch vergeben.
- Bei Lieferung wird eine eindeutige Lizenz-ID erstellt.
- Pro Käufer wird eine eindeutige Käuferkennzeichnung erzeugt.
- Beispiel: LIC-UF-0001-001-ABCD + UFBUY-... Marker.
- /sell license kann Lizenzen anhand Nutzer oder Lizenz-ID prüfen.
- Der Bot erstellt im privaten Kundenbereich zusätzlich eine Lizenzdatei als TXT.

WICHTIG ZUM ANTI-LEAK-SCHUTZ
- Der Bot erzeugt Käufer-/Lizenzkennzeichnungen und dokumentiert die Zuordnung.
- Er verändert hochgeladene Binärdateien NICHT automatisch.
- Wenn du echte unsichtbare Wasserzeichen direkt in Bildern/Audio/Dateien möchtest, muss dafür ein produktspezifischer Watermark-Prozess ergänzt werden.

PRIVATER KUNDENBEREICH
- Bei Lieferung wird automatisch ein privater Delivery-Channel erstellt.
- Zugriff haben nur Kunde und Shop-Team.
- Lizenz-ID und Käuferkennzeichnung werden dort hinterlegt.
- Das Team kann dort die eigentlichen Produktdateien bereitstellen.

REVISIONEN
- Jedes Produkt besitzt Standard-Revisionen.
- Das Team kann die Anzahl anpassen.
- Kunden können eine Revision per Button anfragen.
- Die verbleibende Anzahl wird persistent gespeichert.

TRANSKRIPTE
- Beim Schließen von Kauf- oder Support-Tickets wird automatisch ein TXT-Transcript erzeugt.
- Transcript wird in 📄・transkripte gespeichert.
- Enthalten sind Nachrichten, Embed-Inhalte und Dateilinks bis zum gespeicherten Limit.

BEWERTUNGEN
- Nach Lieferung kann der Käufer eine Bewertung von 1 bis 5 Sternen abgeben.
- Nur der Käufer einer gelieferten Bestellung kann diese bewerten.
- Pro Bestellung ist nur eine Bewertung möglich.
- Bewertungen werden automatisch in ⭐・bewertungen veröffentlicht.

BLACKLIST
- /sell blacklist add
- /sell blacklist remove
- /sell blacklist list
- Gesperrte Nutzer können keine neuen Bestellungen eröffnen.
- Support-Tickets bleiben möglich, damit Streitfälle geklärt werden können.

PORTFOLIO
- /sell portfolio add
- /sell portfolio remove
- /sell portfolio list
- Neue Einträge werden automatisch im öffentlichen Portfolio-Channel veröffentlicht.

SHOP-STATUS & LIEFERZEIT
- /sell availability setzt den Shop auf Offen, Ausgelastet oder Geschlossen.
- Kunden sehen ungefähre Lieferzeiten je Produkt.
- Bei Geschlossen können keine neuen Bestellungen erstellt werden.

PRODUKT-UPDATES
- /sell update postet Updates für ein bestimmtes Produkt.
- Passende Käuferrolle wird automatisch erwähnt.

OWNER-DASHBOARD
- /sell dashboard zeigt:
  * Gesamtbestellungen
  * offene Bestellungen
  * Streitfälle
  * bezahlte Bestellungen
  * gelieferte Bestellungen
  * erfassten Umsatz
  * durchschnittliche Lieferzeit
  * Anzahl und Durchschnitt der Bewertungen
  * meistbestellte Produkte
  * aktuellen Shop-Status

SUPPORT
- Allgemeiner Support
- Installation / Einrichtung
- Bestellung / Lieferung
- Zahlung / PayPal
- Support-Tickets sind getrennt von Kauf-Tickets.
- Support-Transkripte werden beim Schließen ebenfalls gespeichert.

FAQ
- Interaktive FAQ-Buttons für Zahlung, Lieferung, Lizenz und Support.

REGELWERK
- Ausführliches 3-teiliges Shop-/Lizenzregelwerk.
- Weiterverkauf verboten.
- Leaken/Teilen verboten.
- Reupload/Reskin/Kopie als eigenes Produkt verboten.
- Unerlaubte Weitergabe an Freunde, andere Server, Discords, Clouds, Foren oder Downloadseiten verboten.
- Käuferkennzeichnungen/Lizenzhinweise dürfen nicht zur Verschleierung unerlaubter Weitergabe entfernt werden.
- Konsequenzen bei belegtem Lizenzmissbrauch sind klar beschrieben.
- Gesetzliche Verbraucherrechte werden nicht pauschal ausgeschlossen.

WICHTIGE /sell COMMANDS
/sell dashboard
/sell order
/sell license
/sell blacklist
/sell coupon
/sell portfolio
/sell availability
/sell update
/sell paypal

NEUE SERVER
Wenn der Bot nach einem Neustart auf einen weiteren Discord eingeladen wird, versucht er die Slash-Commands dort automatisch zu registrieren. Ein zusätzlicher Railway-Neustart sollte dafür nicht nötig sein.
