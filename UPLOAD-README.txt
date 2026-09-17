UNFUGSTIFTER SELLING SETUP v5.6 PROFESSIONAL+

INSTALLATION
1. Lade selling-entry.js in den Hauptordner deines GitHub-Repos Gmeini09/Bot.
2. Ersetze die bestehende package.json durch die package.json aus diesem Paket.
3. Railway installiert beim Deploy zusätzlich pdfkit und sharp.
4. Falls Railway einen eigenen Start Command verwendet: node selling-entry.js
5. Danach stehen /setup server selling und /sell zur Verfügung.

WICHTIG: FULL RESET
/setup server selling ist absichtlich destruktiv.
- Nur der aktuelle Server-Inhaber kann ihn ausführen.
- Der Bot braucht Administrator.
- Die Bot-Rolle muss über allen normalen Rollen stehen.
- Alle löschbaren alten Channels und normalen Rollen werden entfernt.
- @everyone sowie Discord-/Bot-/Integrationsrollen bleiben technisch bestehen.
- Der Command-Channel wird nur für die Abschlussmeldung behalten und danach ebenfalls gelöscht.
- Das Selling-Datensystem wird beim kompletten Neuaufbau frisch initialisiert.

NEU IN v5.6

1) WARENKORB
- Produktbuttons legen Thumbnails, NVE, Soundpacks, Designs, FiveM Assets und Bundles in einen persistenten Warenkorb.
- Mehrere verschiedene Produkte können gemeinsam bestellt werden.
- Warenkorb anzeigen, leeren und Checkout per Button.
- Checkout erstellt genau eine gemeinsame UF-Bestellnummer.
- Rabattcode, Wünsche, Referenzen, Termin und Zusatzinfos werden im Checkout erfasst.
- Produkt-Käuferrollen werden bei Kombibestellungen passend zu allen enthaltenen Produkten vergeben.

2) AUTOMATISCHE WARTESCHLANGE + ETA
- Jede aktive Bestellung wird automatisch nach Erstellzeit einsortiert.
- Ticket zeigt Queue-Position und geschätzten Start-/Lieferzeitraum.
- Öffentliche Übersicht in 📊・bestellstatus.
- Interner Bereich ⏱️・auftrags-warteschlange.
- /sell queue zeigt dem Team alle aktiven Aufträge.
- ETA ist bewusst als Schätzung gekennzeichnet und passt sich an den Shop-Status an.

3) STAMMKUNDEN / VIP
Automatische Stufen nach gelieferten Bestellungen:
- Bronze: ab 3 Lieferungen -> 5 %
- Silber: ab 5 -> 8 %
- Gold: ab 10 -> 12 %
- VIP: ab 20 -> 15 %

- Rollen werden automatisch aktualisiert.
- /sell loyalty user:@Kunde zeigt Status.
- Rabattcode und Stammkundenrabatt werden standardmäßig nicht gestapelt; automatisch gilt der höhere Rabatt.
- Der finale Preis wird immer im Ticket bestätigt.

4) PDF-BESTELLBELEG
- Bei Lieferung wird automatisch ein PDF-Bestell-/Zahlungsbeleg erstellt.
- Enthält Bestellnummer, Discord-ID, Produkte, PayPal als Zahlungsart, Betrag, Bestell-/Zahlungs-/Lieferdatum und Lizenz-ID.
- Der Beleg wird nicht pauschal als steuerliche Rechnung bezeichnet.
- /sell receipt order:UF-0001 erstellt den Beleg erneut.

5) ECHTES BILD-WATERMARKING
- /sell watermark order:UF-0001 datei:<Bild>
- Unterstützt Bilddateien wie PNG/JPG/WEBP.
- Das Bild erhält wiederholte sichtbare Käufer-/Lizenz-Wasserzeichen und eine Kennzeichnung am unteren Rand.
- Verwendet Bestellnummer, Lizenz-ID und Käufermarker.
- Bilder bis 20 MB.
- Ergebnis wird als PNG ausgegeben.
- Andere Dateitypen werden nicht fälschlich als unsichtbar wassergezeichnet bezeichnet.

REGELWERK
Der Channel 📜・regelwerk enthält jetzt das vollständige Shop-Regelwerk in mehreren Abschnitten mit 41 konkreten Punkten:
- Geltungsbereich und Vertragsablauf
- Warenkorb und verbindliche Bestellungen
- PayPal und Zahlungsnachweise
- Rabattcodes und VIP/Stammkundenrabatte
- PDF-Belege
- Queue und ETA
- Lieferung, Abnahme und Revisionen
- persönliche Nutzungslizenz
- Mehrnutzer-/Serverlizenzen
- Lizenztransfer
- Weiterverkauf strikt verboten
- Leaken/Teilen strikt verboten
- Reuploads/Reskins/Kopien verboten
- Käuferkennung und Watermarking
- Anti-Leak-Nachverfolgung ohne falsche Überwachungsbehauptungen
- Konsequenzen bei belegtem Lizenzmissbrauch
- Support und Streitfälle
- Refund/Widerruf/Gewährleistung ohne pauschalen Ausschluss gesetzlicher Rechte
- Blacklist und Betrugsversuche
- Chargebacks / falsche Zahlungsbehauptungen
- Speicherung von Bestell-/Ticketdaten
- Ticket-Transkripte
- Verhalten und Rechte Dritter
- Produkt-Updates
- Regeländerungen und Zustimmung

BEREITS AUS v5.5 ENTHALTEN
- UF-Bestellnummern
- persistente selling-data.json
- PayPal-System
- Preis-/Statusverwaltung
- Käuferrollen
- Lizenzen und Käufermarker
- privater Delivery-Bereich
- Revisionen
- Ticket-Transkripte
- verifizierte Bewertungen
- Blacklist
- Rabattcodes
- Portfolio
- Shop-Status
- Produkt-Updates
- Owner-Dashboard
- Support-Ticket-Typen
- automatische Slash-Command-Registrierung auf neu beigetretenen Discord-Servern

WICHTIGE TEAM-COMMANDS
/sell dashboard
/sell order
/sell queue
/sell receipt
/sell watermark
/sell loyalty
/sell license
/sell blacklist
/sell coupon
/sell portfolio
/sell availability
/sell update
/sell paypal

ABHÄNGIGKEITEN
- discord.js 14.27.0
- ws
- pdfkit
- sharp
- Node.js >= 18.17.0
