---
name: protokoll-korrigieren
description: Korrigiert ein bestehendes SV-Protokoll (FWS Frankfurt, Format des SV-Protokoll-Generators) behutsam - nur Rechtschreibung, Grammatik, Zeichensetzung, Tippfehler und Formfehler, ohne Inhalt oder Formulierungen zu verändern. Verwenden bei "korrigiere/prüfe/Korrektur lesen" eines SV-Protokolls (JSON, Link oder Export).
argument-hint: "[Protokoll-JSON, Link oder Dateipfad]"
title: SV-Protokoll korrigieren
---
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
