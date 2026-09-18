Turbo Designs – Selling Bug Fix

1. Lege FIX_SELLING_BUG.js in denselben Ordner wie deine aktuelle selling-entry.js.
2. Öffne in diesem Ordner CMD / PowerShell.
3. Starte:
   node FIX_SELLING_BUG.js
4. Danach entsteht:
   selling-entry-fixed.js
5. Ersetze im Bot die alte selling-entry.js durch die neue Datei
   (selling-entry-fixed.js vorher in selling-entry.js umbenennen).
6. Railway neu deployen / Bot neu starten.

Gefixt:
- DiscordAPIError[10062] Unknown interaction beim Warenkorb-Checkout
- gleicher Timeout-Schutz bei normalen Einzelbestellungen
- Angebot-Button wird nach bestätigter Zahlung deaktiviert
- bereits geöffnetes Angebotsformular erzeugt nach Zahlung keinen ERR-Systemfehler mehr
- Angebot-Submit wird frühzeitig bestätigt, damit Discord die Interaction nicht verwirft

Die Originaldatei wird vom Fixer nicht überschrieben.
