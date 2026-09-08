# Integration in Gmeini09/Bot

## Basis und Betrieb

Geprüfter Ausgangscommit: `43d62c686aa72a370774c00bb1fd96a4340c0eb1` auf `main`.

Railway-Konfiguration am 07.09.2026 lesend geprüft:

- Projekt `gleaming-expression`, Dienst `Bot`, Umgebung `production`.
- Quelle `Gmeini09/Bot`, Branch `main`; eine Instanz in `ams`.
- Persistentes Volume `/data`.
- Öffentliche Domain `bot-production-d58c.up.railway.app`, Zielport 8080. Der bestehende Bot verwendet weiterhin Railway `PORT`.
- Bestehende Variablen wurden nicht ausgelesen oder verändert. Twitch-Variablennamen fehlten in der Liste.

Kein zweiter Discord-Client, kein neuer Discord-Token, kein zusätzlicher Railway-Service, kein zusätzlicher HTTP-Port. `/stream/*` wird im vorhandenen HTTP-Server behandelt; `/health` und `/github-webhook` bleiben erhalten. Die 96 bestehenden Command-Definitionen sind identisch. Nur fünf kleine Einbaupunkte ändern `index.js`.

## Sicher übernehmen

Die Integration ist ohne `STREAM_ENABLED=true` vollständig deaktiviert. Keine lokalen Tests mit dem echten `DISCORD_TOKEN` starten: Eine zweite aktive Kopie könnte bestehende Bot-Automationen doppelt ausführen.

1. In GitHub einen **neuen Branch vom geprüften main-Stand** anlegen, z. B. `unfug-stream-integration`. Falls main inzwischen geändert wurde, nicht die ganze `index.js` ersetzen: Patch überprüfen und die fünf Einbaupunkte auf den neuen Stand übertragen.
2. Die Dateien aus `Bot/` mit gleicher Ordnerstruktur in diesen Branch übernehmen. Alternativ in einem sauberen lokalen Checkout einen neuen Branch erstellen und `git apply --check /pfad/unfug-stream.patch`, anschließend `git apply /pfad/unfug-stream.patch` verwenden.
3. Die vorhandene Abhängigkeit installieren (`npm install --ignore-scripts`) und `node --test stream/stream.test.js stream/preservation.test.js` ausführen. Zusätzlich `node --check index.js`.
4. Pull Request zu `main` erstellen und Änderungen prüfen. Die automatische Branch-Erstellung über die verbundene GitHub-Integration wurde hier mit 403 abgelehnt. Es wurden weder Branch noch PR angelegt.
5. Vor einer Produktionsfreigabe die vorhandenen Volume-Daten sichern. **`/data/data.json` niemals durch eine Datei aus einer ZIP ersetzen.** Dieses Update enthält absichtlich keine `data.json`, keine produktive Stream-Datendatei und keine Tokens.
6. Erst nach der Prüfung den PR bewusst zusammenführen. Railway folgt derzeit `main`; dieser Schritt kann ein Produktionsdeployment auslösen. Das wurde hier nicht durchgeführt.

## Einmalige Twitch-Verbindung

In [Twitch Developer Console](https://dev.twitch.tv/console/apps) eine Anwendung registrieren. Eine Twitch-Anwendung ist nötig, keine neue Discord-Anwendung. Als exakte OAuth-Redirect-URL eintragen:

`https://bot-production-d58c.up.railway.app/stream/oauth/callback`

Im **bestehenden** Railway-Dienst `Bot` ergänzen:

```env
STREAM_ENABLED=true
TWITCH_CLIENT_ID=<privat eintragen>
TWITCH_CLIENT_SECRET=<privat eintragen>
PUBLIC_URL=https://bot-production-d58c.up.railway.app
```

`DISCORD_TOKEN`, bestehende Variablen, `PORT`, Startbefehl und Volume unverändert behalten. Secrets niemals in GitHub, Screenshots oder Chatnachrichten kopieren. Die Platzhalterdatei `.env.example` dient nur als Vorlage.

Nach der freigegebenen Bereitstellung im Discord:

1. `/stream einrichten twitch:DEIN_KANAL kanal:DEIN_LIVE_KANAL` und optional `pingrolle` wählen. Ohne Pingrolle wird eine vorher eingestellte Rolle entfernt. Kein `@everyone` als Pingrolle zulässig.
2. `/stream verbinden`: privaten Link öffnen und als eingerichteter Twitch-Kanal anmelden. Nur Leseberechtigung `chat:read` wird angefordert. Falsches Konto wird abgelehnt. Link läuft nach zehn Minuten ab und ist einmalig.
3. Nach höchstens etwa 60 Sekunden `/stream status`: Chat muss verbunden sein. Der Bot schreibt keine Teilnahmebestätigungen in Twitch; Teilnehmerzahl und Ergebnis stehen im OBS-Overlay.
4. Optional `/stream text vorlage:{name} ist live! {title} – {game} {url}`. Unterstützte Platzhalter: `{name}`, `{title}`, `{game}`, `{url}`. Gespeicherter Text gilt für künftige Meldungen; bereits gesendete Discord-Nachrichten werden nicht nachträglich geändert.
5. `/stream test` sendet eine klar gekennzeichnete Testmeldung ohne Ping. Danach `/stream an` aktiviert die echte Automatik. Auch ein bereits laufender, noch nicht angekündigter Stream wird beim nächsten Check angekündigt.

Der Bot benötigt im Zielkanal „Kanal ansehen“, „Nachrichten senden“ und „Links einbetten“. Für den optionalen Rollenping muss die Rolle erwähnbar sein oder der Bot passende Erwähnungsrechte besitzen. Verwaltungscommands verwenden dieselbe Prüfung wie das bestehende `canSetup`: Administrator oder „Server verwalten“.

## OBS

`/stream overlay` zeigt eine private Browser-URL. Der Leseschlüssel steht im URL-Fragment und wird von der Seite als Authorization-Header an den Status-Endpunkt gesendet, nicht als Query-Parameter. Die öffentliche HTML-Seite allein verrät keine Giveaway-Daten. Der Status liefert Preis, Anzahl, Countdown und Gewinnernamen, keine vollständige Teilnehmerliste oder Tokens.

`/stream overlayneu` widerruft die bisherige Overlay-Adresse. Anschließend die neue URL in der gemeinsamen OBS-Browserquelle ersetzen. In OBS bei der Browserquelle „Browser aktualisieren, wenn Szene aktiv wird“ und „Quelle herunterfahren, wenn sie nicht sichtbar ist“ deaktiviert lassen; der Updater stellt dies bereits ein.

Die V5-Hauptsammlungen enthalten das PRUDA-Wasserzeichen bereits unten rechts in allen elf Hauptszenen. Nach Installation OBS schließen und `STREAMBOT-VERBINDEN.cmd` im Paket-Hauptordner mit der privaten URL ausführen; es aktualisiert beide zuletzt installierten Sammlungen mit Backup. Die Giveaway-Quelle ist in den Szenen 02–06 und 11 vorbereitet. Die Original-Audio-Hilfsszenen und Profile bleiben erhalten. `/streamgiveaway ausblenden` versteckt die Gewinneranzeige, ohne die Teilnehmer zu löschen.

## Speicherung, Wiederanlauf und Grenzen

- Stream-Zustand und OAuth-Tokens liegen in `/data/unfug-stream.json`; Community-Daten bleiben in `/data/data.json`. Schreibvorgänge verwenden temporäre Datei, Flush und Umbenennung. Auf Linux wird die neue Datei mit Modus 0600 angelegt.
- Nur eine Bot-Instanz pro Volume betreiben. Die Datei ist nicht für mehrere parallele Prozesse ausgelegt.
- Twitch-Tokens werden beim Start und mindestens stündlich validiert; ablaufende Tokens werden mit Refresh-Token erneuert und gespeichert. Widerrufene Autorisierung kann ein erneutes `/stream verbinden` erfordern.
- IRC verwendet TLS, antwortet auf PING und verbindet nach Verbindungsverlust beim nächsten Durchlauf erneut. Während der Unterbrechung werden Chatnachrichten nicht nachträglich wiedergegeben; der Giveaway-Countdown läuft weiter. OBS zeigt die fehlende Chatverbindung an.
- Maximal ein aktives Giveaway pro Discord-Server, 20.000 Teilnehmer, 1–20 Gewinner, 1–1440 Minuten. Twitch-Benutzer-ID verhindert Mehrfachteilnahmen trotz Namenswechsel. Es gibt keine Discord-Rollenbedingung für Twitch-Teilnehmer.
- Eine Auslosung ohne Teilnehmer endet ohne Gewinner. Weniger verfügbare Teilnehmer ergeben entsprechend weniger Gewinner. Neuziehungen schließen alle bereits gezogenen Gewinner aus.
- Beim Neustart werden überfällige Giveaways einmal beendet. Automatische Auslosungen werden jede Sekunde geprüft; das Overlay fragt ungefähr alle 1,5 Sekunden ab.
- Live-Erkennung erfolgt ungefähr alle 60 Sekunden über die offizielle Twitch-API. Die Stream-ID wird **vor** dem Versand gespeichert, um wiederholte Rollenpings auch nach einem Absturz zu verhindern. Bei einem Versandfehler oder Absturz zwischen Speicherung und Versand kann deshalb eine Meldung ausbleiben. `/stream status` zeigt den Fehler; im Discord prüfen und nötigenfalls eine Meldung manuell senden. Es wird nicht blind erneut gepingt. Die letzten 200 Stream-IDs werden behalten.
- Bei falscher Stream-Konfiguration/defekter Stream-Datei wird nur die Erweiterung deaktiviert; der bestehende Community-Bot kann weiter starten. Diagnose erfolgt durch eine generische Logmeldung ohne Secrets. Eine fehlende Stream-Command-Liste nach Aktivierung ist ein Grund, Konfiguration und Volume-Datei zu prüfen.

## Rückweg

Für den schnellen Rückweg `STREAM_ENABLED=false` setzen und den bestehenden Dienst neu starten. Die neue Erweiterung bleibt inaktiv; ihre Commands werden beim nächsten Ready durch die ursprünglichen Commands ersetzt. Alternativ den Integrationscommit zurücknehmen. **Keine Volume-Dateien löschen.** In OBS zur vorherigen Szenensammlung zurückwechseln, das bisherige Profil behalten.

## Quellen

- [Twitch IRC](https://dev.twitch.tv/docs/chat/irc/)
- [Twitch OAuth Authorization Code Flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow)
- [Twitch Token Validation](https://dev.twitch.tv/docs/authentication/validate-tokens/)
- [Twitch Token Refresh](https://dev.twitch.tv/docs/authentication/refresh-tokens/)
- [Twitch Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams)
