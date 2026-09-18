Turbo Designs – Merge mit aktuellem Push

Basis geprüft:
Commit bdfd488c5c1923435abc882d6c661812b98f85cb
"Bug Fix" vom 18.09.2026

Dieses Paket führt ZWEI Änderungen zusammen:
1. Aktueller Bug Fix:
   - Discord Unknown Interaction / Timeout bei Bestellungen
   - Angebot nach Zahlung/Abschluss sperren
   - Offer-Submit rechtzeitig deferen
2. Turbo Designs Shop-Listen:
   - /command user nur Shop/Kunden
   - /command team nur Shop-Team
   - /help nur Shop-Hilfe
   - start:core behält die alten Community-Listen

Anwendung:
1. APPLY_MERGED_UPDATE.js und INSTALLIEREN.cmd in den Root deines Bot-Repos legen
   (dort wo index.js und selling-entry.js liegen).
2. INSTALLIEREN.cmd doppelklicken.
3. Danach index.js und selling-entry.js zu GitHub pushen.
4. Railway deployen lassen.

Vor dem Ändern werden Backups erstellt:
- index.js.bak-merged-update
- selling-entry.js.bak-merged-update
