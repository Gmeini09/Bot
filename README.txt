Turbo Designs Bot v5.9.3 FIX

Gefixt:
1. Warenkorb-Checkout: "Invalid component passed in ModalBuilder.addComponents at index 4"
2. FileUploadBuilder#setFileTypes Kompatibilität für discord.js 14.27.0
3. Discord Command-Limit: vorher 104 Commands -> neue Advanced-Funktionen sind in EINEM /tools Command gebündelt

Hochladen/ersetzen im Repo-Root:
- compat-fix.js                  (neu)
- turbo-tools.js                 (neu)
- selling-entry-merged.js        (ersetzen)
- package.json                   (ersetzen)

WICHTIG:
- selling-entry.js NICHT löschen oder ersetzen.
- index.js NICHT löschen.
- advanced-features.js kann im Repo bleiben, wird von v5.9.3 aber nicht mehr geladen.

Neue Commands:
/tools panel create
/tools panel list
/tools panel delete
/tools config show
/tools config channel
/tools config role
/tools config color
/tools config library
/tools library
/tools setup save
/tools setup check
/tools setup repair
/tools systemcheck
