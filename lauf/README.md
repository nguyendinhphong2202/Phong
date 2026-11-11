# 🏃 Laufbuch

Eine Lauf-Tracking-Web-App, die **Screenshots und Fotos deiner Läufe automatisch
ausliest**, die Einheiten speichert und deine Fortschritte anzeigt.

![Übersicht](docs/uebersicht.png)

## Funktionen

- **Fotoerkennung**: Screenshot oder Foto hochladen, per Drag & Drop ablegen
  oder mit `Strg`+`V` einfügen. Die Texterkennung (Tesseract.js, Deutsch +
  Englisch) läuft komplett im Browser, deine Bilder verlassen das Gerät nicht.
- **Erkannte Werte**: Datum, Distanz, Dauer, Pace, Ø/max. Herzfrequenz,
  Kalorien, Höhenmeter, Schrittfrequenz und die Art des Laufs. Fehlende Werte
  werden berechnet (z. B. Pace aus Distanz und Zeit). Meilen und ft werden
  umgerechnet. Unstimmige Werte werden markiert.
- **Prüfen vor dem Speichern**: Jedes Feld zeigt, ob es *erkannt* oder
  *berechnet* wurde, und lässt sich korrigieren. Mögliche Duplikate werden
  angezeigt. Mehrere Fotos auf einmal → „Alle speichern“.
- **Ziele**: beliebig viele Ziele, einfach in eigenen Worten eingeben, z. B.
  „60 km diese Woche“, „10 km heute“, „3 Läufe pro Woche“, „5 Stunden im
  Monat“, „Halbmarathon bis 31.12.“ oder „8 km morgen“. Unterstützt werden
  Kilometer, Anzahl Läufe, Laufzeit und Einzelläufe. Zeiträume: Tag, Woche,
  Monat, Jahr oder bis zu einem Datum, einmalig oder wiederkehrend. Jede
  Zielkarte zeigt Fortschritt, Rest, verbleibende Tage, nötige km pro Tag und
  ob du **vor oder hinter Plan** liegst. Erreichte Ziele werden beim Speichern
  eines Laufs gefeiert, vergangene Ziele landen im Verlauf.
- **Fortschritt**: aktive Wochen in Folge,
  Monatsvergleich, Gesamtwerte, Wochenkilometer der letzten 12 Wochen,
  Pace-Entwicklung mit Trendlinie und Bestleistungen.
- **Einheiten**: nach Monaten gruppiert, bearbeiten und löschen (mit
  Rückgängig). Export als CSV (für Excel) oder als JSON-Backup inkl. Fotos,
  JSON-Import.
- **Süßes, freundliches Design**: Pastellfarben, runde Formen und Schrift,
  Maskottchen „Flitzi“ (läuft, winkt, jubelt), federnde Animationen,
  Konfetti bei erreichten Zielen, Begrüßung je nach Tageszeit. Animationen
  werden abgeschaltet, wenn das Gerät „Bewegung reduzieren“ eingestellt hat.
- Hell-/Dunkelmodus, für Handys optimiert (schwebende Tab-Leiste, großer
  Kamera-Button).

Getestet mit typischen Layouts von Strava, Garmin Connect, Apple Fitness, Nike
Run Club u. a. (Beschriftung über oder unter dem Wert, mehrspaltig, helle und
dunkle Screenshots).

![Erfassen](docs/erfassen.png)

| Ziel erreicht | Handy, Dunkelmodus |
|---|---|
| ![Ziel erreicht](docs/geschafft.png) | ![Handy](docs/handy-dunkel.png) |

## Aufs iPhone installieren

Laufbuch ist eine installierbare Web-App (PWA): eigenes Symbol auf dem
Home-Bildschirm, Vollbild ohne Browserleiste, funktioniert auch offline.

**1. Einmalig: App online stellen** (das iPhone braucht eine https-Adresse)

Am einfachsten mit GitHub Pages: im Repository unter **Settings → Pages →
Build and deployment** bei *Source* „Deploy from a branch“ wählen, den Branch
mit dem `lauf/`-Ordner und den Ordner `/ (root)` auswählen und speichern. Nach
ein bis zwei Minuten ist die App unter
`https://<github-name>.github.io/<repo-name>/lauf/` erreichbar.

**2. Auf dem iPhone**

1. Die Adresse in **Safari** öffnen.
2. Unten auf **Teilen** tippen (Quadrat mit Pfeil nach oben).
3. **„Zum Home-Bildschirm“** wählen und mit **„Hinzufügen“** bestätigen.

Die App zeigt diese Schritte auf dem iPhone auch selbst an („So geht's“).

Gut zu wissen:

- Die App auf dem Home-Bildschirm hat einen eigenen Speicher, getrennt von
  Safari. Vorher im Browser gespeicherte Läufe über **Einheiten → Backup**
  sichern und in der installierten App **importieren**.
- Offline funktioniert alles außer der allerersten Fotoerkennung: Dafür werden
  einmalig ca. 15 MB Erkennungsdaten geladen und danach auf dem Gerät behalten.
- Export (CSV/Backup) öffnet auf dem iPhone das Teilen-Menü, z. B. „In Dateien
  sichern“.
- Auf Android und am Computer (Chrome/Edge) erscheint stattdessen ein
  „Installieren“-Knopf.

## Starten (am Computer)

Keine Build-Schritte nötig. Im Repo-Ordner:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000/lauf/> öffnen. Für die erste Texterkennung braucht
die App Internet (Tesseract und die Sprachdaten, ca. 15 MB, werden einmalig von
jsDelivr geladen und dann vom Browser zwischengespeichert).

## Daten

Alle Einheiten liegen lokal im Browser (IndexedDB). Es gibt keinen Server und
kein Konto. Wenn du die Browserdaten löschst, sind die Einheiten weg, also
regelmäßig über **Einheiten → Backup** sichern.

## Aufbau

```
lauf/
  index.html          Oberfläche
  styles.css          Design (hell/dunkel, responsiv)
  app.js              Speicher, Fotoaufbereitung, OCR, Statistiken, Diagramme
  parser.js           OCR-Text → Laufdaten (läuft auch in Node)
  goals.js            Ziele: Eingabe in eigenen Worten, Zeiträume, Fortschritt
  manifest.webmanifest, sw.js, icons/   Installierbarkeit und Offline-Betrieb
  tests/              Parser-Tests
```

Tests (OCR-Parser und Ziele):

```bash
node --test lauf/tests/*.test.js
```

## Mögliche nächste Schritte

- Optional KI-Bilderkennung für schwierige Fotos (z. B. schräg fotografierte Uhr)
- Synchronisierung zwischen Geräten
