# Discord Socials Bot – iPhone / Railway

Diese Version ist für Hosting über Railway vorbereitet.

## Bereits eingetragene IDs
- Client ID: 1540161502856740914
- Guild ID: 1531989453168578650
- Panel Channel ID: 1540162074531856474

## Railway Variable
Lege im Railway-Service unter **Variables** an:

`DISCORD_TOKEN=dein_token`

Der Token gehört **nicht** in GitHub.

## Start
Railway erkennt Node.js automatisch und startet mit:

`npm start`

Beim Start registriert der Bot `/socials` automatisch.

## Daten dauerhaft speichern
Ohne Volume kann `data.json` bei einem neuen Deployment verloren gehen.
Erstelle in Railway ein Volume und verbinde es mit dem Bot-Service. Mount Path z. B.:

`/data`

Der Bot erkennt `RAILWAY_VOLUME_MOUNT_PATH` automatisch und speichert dort `data.json`.
