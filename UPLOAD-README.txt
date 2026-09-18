TURBO DESIGNS SELLING BOT – v5.10

UPDATE OHNE SERVER-RESET
1. selling-entry.js im GitHub-Repo ersetzen.
2. package.json ersetzen.
3. Railway neu deployen.
4. NICHT /setup server selling ausführen, wenn die bestehende Serverstruktur erhalten bleiben soll.

NEU / ERWEITERT
- Support-Ticket-IDs: SUP-0001, SUP-0002, ...
- Support Auto-Rename behält die SUP-ID im Channelnamen.
- Interne Ticket-Notizen über /sell tools note
- Kundenprofil zeigt Bestellungen, Umsatz, Lizenzen, Reviews, Support-Tickets und Notizanzahl.
- Express-Auftrag per Button im Bestell-Ticket, Standardaufschlag 20 %.
- Express-Aufschlag konfigurierbar über /sell tools pricing.
- Zusatzkosten mit Kundenfreigabe über /sell tools extra.
- Revisionslimit bleibt hart aktiv; zusätzlicher Revisions-Richtpreis ist konfigurierbar.
- Team-Auslastung über /sell tools workload.
- Auto-Assign nutzt weiterhin den Mitarbeiter mit den wenigsten offenen Aufträgen.
- Live-Dashboard erweitert: offene Support-Tickets, Wartet-auf-Staff/Kunde, Express, überfällige Deadlines.
- Automatischer Wochenbericht standardmäßig Freitag ab 19:00 Europe/Vienna.
- Wochenbericht manuell über /sell tools weeklyreport.
- /sell search findet jetzt auch SUP-IDs.

WICHTIGE COMMANDS
/sell tools note action:Hinzufügen text:...
/sell tools note action:Notizen anzeigen
/sell tools extra action:Hinzufügen order:UF-0001 betrag:5 text:Zusätzliche Revision
/sell tools extra action:Liste order:UF-0001
/sell tools pricing express_prozent:20 revision_preis:5
/sell tools workload
/sell tools weeklyreport
/sell profile user:@User

BESTEHENDE FEATURES
Alle Features aus v5.9.3 bleiben erhalten, inklusive Checkout-Fix, /paypal, Delivery-Lock-Fix, Welcome-Ping, Teamliste, Angebote, Deadlines, QR-Lizenzen, Partner-/Refund-/Leak-Workflow, Releases, Kunden-/Staff-Menüs und Security.
