TURBO DESIGNS SELLING BOT – v5.9 WORKFLOW

UPDATE:
1. selling-entry.js in den Root deines GitHub-Repos hochladen/ersetzen.
2. package.json ersetzen.
3. Railway neu deployen.
4. KEIN /setup server selling ausführen, wenn der bestehende Server erhalten bleiben soll.

WICHTIG:
- Neue Dependency: qrcode (wird durch Railway/npm install installiert).
- Bestehende Shop-Daten bleiben erhalten.
- Beim Start werden Panels, Teamliste und Permissions synchronisiert.

v5.9 HIGHLIGHTS:
- Auto-DM nach Join
- Angebots-System mit Annehmen/Ablehnen
- Ticket-Prioritäten
- Auto-Ticket-Renames nach Status/Priorität/Warten-Status
- Auftragskalender + Deadline-Warnungen
- Produkt-spezifische Vorlagen, Style-Auswahl, Referenz-Uploads
- gepinnte Ticket-Zusammenfassung
- Wartet auf Kunde / Wartet auf Staff + Follow-ups
- No-Response Archivierung
- Projekt-Archiv
- Mitarbeiter- und Produktstatistiken
- Staff-Ranking
- Monatsumsatz
- Coupon + Gutschein + VIP/Stammkunden-Logik
- Geschenkbestellungen
- zeitlich begrenzte Download-Tokens + Download-Bestätigung
- Lizenz-PDF mit QR-Code
- Lizenz-Check
- Leak-Report
- Refund-/Dispute-Workflow
- Partner-Bewerbungen + Partner-Ad-Verwaltung
- Release-System + Käufer-Pings
- Panel-Cleanup / Startup-Check / Owner-Alarm
- Test-Modus
- Export/Import
- Kunden-Hauptmenü
- Team-Hauptmenü
- automatische Teamliste aus Discord-Rollen

TEAMLISTE:
Die Teamliste wird aus Inhaber, Management, Support, Designer,
Sound Designer und Developer automatisch erzeugt und bei relevanten
Member-/Rollenänderungen aktualisiert.
