TURBO DESIGNS BOT v5.9.2 – MERGED + CHECKOUT FIX
==================================================

Gefundener Live-Fehler in Railway (17.09.2026 ca. 16:42 AT):
TypeError: ...setFileTypes is not a function
at handleCartButton (/app/selling-entry.js:2680:89)

URSACHE
- selling-entry.js verwendet FileUploadBuilder#setFileTypes(...)
- Railway installiert laut package.json discord.js 14.27.0
- in diesem Build ist setFileTypes() nicht vorhanden
- dadurch crasht das Modal bereits beim Klick auf Checkout

FIX
- Compatibility-Shim in advanced-features.js
- betrifft Warenkorb-Checkout UND normale Produkt-Bestellformulare
- bestehendes selling-entry.js bleibt unverändert
- alle v5.9.0 Selling-Funktionen bleiben erhalten
- Advanced Features aus v5.9.1 bleiben enthalten

UPLOAD IN DEN REPO-ROOT
1. advanced-features.js ersetzen/hochladen
2. selling-entry-merged.js ersetzen/hochladen
3. package.json ersetzen
4. selling-entry.js NICHT löschen
5. index.js NICHT löschen

Railway startet danach über:
node selling-entry-merged.js

Danach testen:
1. Warenkorb öffnen
2. Produkt hinzufügen
3. Checkout klicken
4. Formular muss sich öffnen
5. Formular absenden und prüfen, ob das Bestell-Ticket erstellt wird

Version: 5.9.2
