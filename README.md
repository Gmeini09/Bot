# SP Tool – Web-App (Handy, Tablet, Browser)

Gebaute SP Tool Web-App (`public/`) plus ein kleiner Node-Server ohne Abhängigkeiten (`server.mjs`).
Läuft als eigener Railway-Service; Anmeldung und Lizenzen laufen über den Lizenzserver des Bots.

- Start: `npm start` (Port aus `PORT`, Standard 8080)
- `SPTOOL_API_ORIGIN`: Adresse des Lizenzservers (für die Content-Security-Policy)
- `android/`: Android-App (WebView-Hülle, öffnet diese Web-App)

Dieser Branch enthält nur gebaute Dateien – der Quellcode liegt im SP-Tool-Projekt.
