---
name: protokoll-korrigieren
description: Korrigiert ein bestehendes SV-Protokoll (FWS Frankfurt, Format des SV-Protokoll-Generators) behutsam - nur Rechtschreibung, Grammatik, Zeichensetzung, Tippfehler und Formfehler, ohne Inhalt oder Formulierungen zu verändern. Verwenden bei "korrigiere/prüfe/Korrektur lesen" eines SV-Protokolls (JSON, Link oder Export).
argument-hint: "[Protokoll-JSON, Link oder Dateipfad]"
---
<!-- Generiert aus shared/modi/protokoll-korrigieren.md und shared/ausgabe.md – dort bearbeiten, dann `npm run build`. -->

# SV-Protokoll korrigieren

Minimal-invasive Korrektur: Das Protokoll soll danach fehlerfrei sein, aber **so
klingen wie vorher**. Wer es geschrieben hat, soll seinen Text wiedererkennen.

## Was korrigiert wird
- Rechtschreibung, Grammatik, Zeichensetzung, Tippfehler, doppelte Wörter/Leerzeichen.
- Typografie: „…“ statt "…", Gedankenstrich –, einheitliche Uhrzeit-/Datumsschreibweise.
- Einheitliche Schreibung derselben Namen und Begriffe im ganzen Protokoll.
- Formfehler im Datenformat: Doppelpunkt am Titelende entfernen, Markdown-Reste
  (`**`, `#`) entfernen, Namenslisten der Anwesenheit mit Komma statt „und“/„;“,
  offensichtlich falsch formatierte Datums-/Zeitfelder.

## Was NICHT verändert wird
- Inhalt, Fakten, Namen, Zahlen, Reihenfolge, Absatzstruktur.
- Stil und Wortwahl – auch wenn es „schöner“ ginge. Kein Umformulieren ganzer Sätze,
  außer ein Satz ist grammatisch kaputt; dann so nah wie möglich am Original reparieren.
- Abstimmungszahlen, auch wenn sie unplausibel wirken (→ nur im Chat anmerken).

## Bericht
Zusätzlich zum Abschluss eine kompakte Änderungsliste, gruppiert nach Punkt:
`Podiumsdiskussion: „Podiumsdiskusssion“ → „Podiumsdiskussion“`. Bei sehr vielen
Kleinigkeiten zusammenfassen („12 Kommafehler“). Inhaltliche Auffälligkeiten
(Widersprüche, fehlende Ergebnisse, sensible Inhalte) separat als **Hinweise**,
ohne sie selbst zu ändern.

## Werkzeuge

Nutze das erste, was verfügbar ist:

1. **MCP-Server `sv-protokoll`** (Tools `protokoll_*`) – bevorzugt.
2. **Skript** `scripts/sv_protokoll.py` im Ordner dieses Skills (Python 3, nur
   Standardbibliothek): `validate <datei>`, `link <datei>`, `decode "<link>"`.
3. Sonst: JSON als Datei bzw. Codeblock ausgeben – Import über „Import“ in der Seite.

Referenzen (bei Bedarf lesen, nicht auswendig annehmen): `references/format.md`
(Felder & Darstellung), `references/stil.md` (Stilleitfaden), `references/beispiel.json`
(vollständiges Beispiel), `references/schema.json` (JSON-Schema).
Ohne diese Dateien liefert das Tool `protokoll_format` denselben Inhalt.

## Eingabe lesen
- JSON (eingefügt, als Datei oder Pfad) direkt verwenden.
- Link aus „Link kopieren“ (`…/SV/#import=…`) mit `protokoll_decode_link` bzw.
  `decode` entpacken.
- PDF/Screenshot eines alten Protokolls: Inhalt abtippen und ins Format überführen.

## Abschluss (immer)
1. **Validieren** (`protokoll_validate` bzw. `validate`). Fehler beheben, Warnungen
   prüfen – eine Warnung darf bleiben, wenn sie begründet ist.
2. **Ausliefern:**
   - **Link** (`protokoll_link` bzw. `link`) – öffnet das Protokoll direkt in der Seite.
   - **JSON-Datei** `sv-protokoll-YYYY-MM-DD.json` (in Claude Code: Datei schreiben;
     mit MCP: `protokoll_save_json`; sonst Datei-Ausgabe/Codeblock).
   - **PDF** nur auf Wunsch (`protokoll_render_pdf`).
3. **Kurz berichten:** was getan wurde (2–4 Zeilen), offene Fragen / `[?]`-Stellen,
   Hinweise (z. B. weggelassene sensible Inhalte). Das komplette JSON nicht zusätzlich
   in den Chat kippen, wenn Link oder Datei geliefert wurden.
