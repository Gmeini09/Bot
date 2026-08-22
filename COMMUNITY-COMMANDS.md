# Neue Community-Funktionen

Der Bot registriert die Slash-Commands beim Start automatisch. Die vorhandenen Daten aus `data.json` bleiben erhalten und werden auf die neue Datenversion erweitert.

## Schnell einrichten

- `/frage setup` – tägliche Frage und Uhrzeit festlegen
- `/communitypoll setup` – tägliche oder wöchentliche Umfragen aktivieren
- `/memberofthemonth setup` – Monatsauszeichnung und optionale Rolle festlegen
- `/clip setup` – Channel für den Clip der Woche festlegen
- `/mitspieler setup` – Channel für Mitspielersuchen festlegen
- `/anonymouspanel` – Panel und Team-Inbox für anonyme Nachrichten erstellen
- `/interessen add` – Interessenrolle hinzufügen
- `/interessen panel` – Willkommens- und Interessenpanel erstellen

## Befehle für Mitglieder

- `/rep`, `/reps`
- `/communityrank`, `/communityleaderboard`
- `/clip submit`, `/clip top`
- `/mitspieler create`, `/mitspieler list`, `/mitspieler close`
- `/challenge list`
- `/game status`, `/badges`
- `/profil`, `/profilset`

## Team-Befehle

- `/frage add`, `/frage remove`, `/frage post`, `/frage status`
- `/communitypoll add`, `/communitypoll remove`, `/communitypoll post`, `/communitypoll status`
- `/memberofthemonth run`
- `/clip finish`
- `/challenge create`, `/challenge end`
- `/game start`, `/game stop`, `/game quiz`, `/game leaderboard`
- `/anonymousinfo`
- `/interessen add`, `/interessen remove`, `/interessen list`, `/interessen panel`

## Automatik

- Aktivität aus Textchat und Voice wird dauerhaft gespeichert.
- Das Mitglied des Monats wird anhand gemeinsamer Community-Punkte ausgewählt.
- Community-Punkte: 1 Punkt pro Nachricht und 1 Punkt pro 5 Voice-Minuten.
- Clips werden wöchentlich ausgewertet.
- Erfolge und Abzeichen werden automatisch freigeschaltet.
- Alle Uhrzeiten verwenden standardmäßig `Europe/Vienna`. Das kann mit der Railway-Variable `COMMUNITY_TIMEZONE` geändert werden.
