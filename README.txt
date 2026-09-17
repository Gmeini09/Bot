Turbo Designs Bot v5.9.4 – Detailed Changelog Update

UPLOAD IN DEN GITHUB-ROOT:
1. compat-fix.js
2. changelog-enhancer.js
3. turbo-tools.js
4. selling-entry-merged.js
5. package.json
6. CHANGELOG-v5.9.4.txt

selling-entry.js und index.js NICHT löschen oder ersetzen.

Railway startet weiterhin: node selling-entry-merged.js

NACH DEM DEPLOY:
- /tools changelog status
- /tools changelog setup   (falls du einen neuen 📝・changelogs Channel willst)
- /tools changelog test

Der bestehende GitHub Webhook /github-webhook und GITHUB_WEBHOOK_SECRET werden weiterverwendet.
Das neue Modul ersetzt nur die alte generische Changelog-Ausgabe, nicht den restlichen Webserver.
