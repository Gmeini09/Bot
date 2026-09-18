TURBO DESIGNS SELLING BOT – v5.11 STABILITY & DATABASE

UPDATE:
1. selling-entry.js im Root deines GitHub-Repos ersetzen.
2. package.json ersetzen.
3. Railway neu deployen.
4. KEIN /setup server selling ausführen, wenn dein bestehender Server erhalten bleiben soll.

POSTGRESQL (empfohlen):
- In Railway einen PostgreSQL-Service zum Projekt hinzufügen.
- Den Bot-Service mit DATABASE_URL (alternativ POSTGRES_URL/POSTGRESQL_URL) verbinden.
- Beim nächsten Start erstellt der Bot die Tabelle `turbo_selling_state` automatisch.
- PostgreSQL ist danach die primäre persistente Quelle; selling-data.json bleibt als lokaler Fallback/Backup erhalten.
- Falls PostgreSQL nicht erreichbar ist, startet der Bot weiter mit dem JSON-Fallback und zeigt den Zustand über /sell diagnose.

NEU IN v5.11:
- PostgreSQL-Persistenz mit automatischem Restore/Sync und JSON-Fallback
- Fehler-IDs wie ERR-A1B2C3; Stacktrace landet intern in 📋・logs
- /sell audit prüft Bot-Rechte, Rollen, kritische Channels, Ticket-Privatsphäre und veraltete IDs
- /sell diagnose action:Prüfen zeigt DB, JSON, Ping, Locks, offene Tickets und Permission-Probleme
- /sell diagnose action:Prüfen + reparieren startet Self-Heal und prüft danach erneut
- Self-Healing reagiert zusätzlich auf gelöschte/geänderte Selling-Channels und Selling-Rollen
- automatische Permission-Synchronisierung für offene Tickets/Delivery-Channels
- Order-Timeline: /sell order order:UF-0001 action:Timeline anzeigen
- Timeline erfasst Erstellung, Zuweisung, Angebote, Preise, Status, Revision, Lieferung, Abnahme und Abschluss

WICHTIG:
- Neue npm Dependency: pg
- Bestehende Shop-Daten werden migriert; kein Reset notwendig.
- Bestehende Orders bekommen beim Anzeigen der Timeline abgeleitete historische Einträge aus bereits vorhandenen Zeitstempeln.
