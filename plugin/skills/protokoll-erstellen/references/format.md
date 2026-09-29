# Datenformat & Darstellung

Ein Protokoll ist ein JSON-Objekt (Schema: `schema.json`). Der Generator rendert es
immer im gleichen Layout – Inhalt ist deine Aufgabe, Gestaltung macht die Seite.

## Felder

| Feld | Pflicht | Format | Wo es erscheint |
|---|---|---|---|
| `meetingDate` | ja | `YYYY-MM-DD` | Titel: „SV-Protokoll – 27.1.2026“ |
| `printDate` | empfohlen | `YYYY-MM-DD` | Fußzeile: „Erstellt von …, 1.2.2026“ |
| `author` | empfohlen | voller Name | Fußzeile |
| `location` | optional | Text | Untertitel, z. B. „SV-Raum · 13.30 – 14.15 Uhr“ |
| `timeFrom`, `timeTo` | optional | `HH:MM` (24 h) | Untertitel |
| `attendance` | empfohlen | `{ "9B": "Lorenzo, Annika" }` | Anwesenheitsraster 7A–13B |
| `sections` | ja | Liste von Punkten | Themenliste + Protokoll |
| `format`, `version` | optional | `"sv-protokoll"`, `1` | – (Kennung beim Export) |

Leere Werte als `""` angeben (nicht weglassen, nicht `null`).

### Anwesenheit
- Nur die Klassen **7A–13B** (A/B-Züge) sind erlaubt. Klassen ohne Anwesende weglassen.
- Wert: **Vornamen, durch Komma getrennt** (`"Tina, Isabella, Clara"`), kein „und“.
- Personenzahl und Klassenanzahl berechnet der Generator selbst.

### Protokollpunkte (`sections`)
```json
{
  "title": "SV-Aktion",
  "text": "Erster Absatz.\n\nZweiter Absatz.\nZeile im selben Absatz.",
  "votes": null
}
```
- `title`: kurz (1–3 Wörter), **ohne Doppelpunkt**. Alle Titel ergeben automatisch
  die Zeile „Themen:“ – deshalb keine separate Themenliste pflegen.
- `text`: reiner Text. `\n\n` = neuer Absatz, `\n` = Zeilenumbruch.
  **Kein Markdown, kein HTML** – `**fett**` erscheint wörtlich mit Sternchen.
  Aufzählungen bei Bedarf als Zeilen mit „– “ am Anfang.
- `id`: optional und nur intern (Editor, Zuordnung bei `diff`) – nie sichtbar.
  Bestehende IDs unverändert lassen; beim Zusammenlegen die ID des ersten Punkts behalten;
  neue Punkte ohne `id` (der Generator vergibt eine). IDs nie doppelt vergeben.

### Abstimmungen (`votes`)
```json
"votes": {
  "caption": "Abstimmung zur SV-Aktion",
  "rows": [
    { "label": "Escape Room", "yes": 12, "no": 3, "abstain": 1 },
    { "label": "Lasertag",    "yes": 5,  "no": 9, "abstain": 2 }
  ]
}
```
- Eine Zeile pro Antrag/Option. Stimmen als ganze Zahlen; unbekannt = `""`.
- Die Spalte **Ergebnis** berechnet der Generator: Ja > Nein → „Angenommen“,
  Ja < Nein → „Abgelehnt“, sonst „Unentschieden“. Nicht selbst in den Text rechnen,
  aber das Ergebnis im Text in einem Satz festhalten.
- Keine Tabelle, wenn keine Stimmenzahlen bekannt sind – dann nur im Text
  (z. B. „einstimmig angenommen“). **Niemals Zahlen erfinden.**

## Layout (automatisch)
- A4, Logo-Kopfzeile, Titel mit Datum, Anwesenheit und Themen auf Seite 1.
- Seiten werden automatisch gefüllt; zu lange Punkte werden an Absatzgrenzen
  getrennt und mit „(Fortsetzung)“ weitergeführt. Seitenumbrüche also nie
  selbst „bauen“ – kurze, klare Absätze ergeben das schönste Layout.
- Fußzeile: „Erstellt von {author}, {printDate}“ und „Seite x von y“.
