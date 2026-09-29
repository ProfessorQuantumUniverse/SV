---
name: protokoll-korrigieren
description: Korrigiert ein bestehendes SV-Protokoll (Schülervertretung FWS Frankfurt, SV-Protokoll-Generator) behutsam - nur Rechtschreibung, Grammatik, Zeichensetzung, Tippfehler und Formfehler, ohne Inhalt oder Formulierungen zu verändern. Verwenden bei "korrigiere/prüfe/Korrektur lesen/Fehler raus". Auch wenn nur ein Link auf den SV-Protokoll-Generator (professorquantumuniverse.github.io/SV/#import=...) geschickt wird. Ergebnis ist immer ein neuer Link.
argument-hint: "[Protokoll-JSON, Link oder Dateipfad]"
allowed-tools: mcp__plugin_sv-protokoll_sv-protokoll__protokoll_format mcp__plugin_sv-protokoll_sv-protokoll__protokoll_validate mcp__plugin_sv-protokoll_sv-protokoll__protokoll_link mcp__plugin_sv-protokoll_sv-protokoll__protokoll_decode_link Bash(python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py *) Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py *) Bash(py ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py *)
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
Zusätzlich zum Link eine kompakte Änderungsliste, gruppiert nach Punkt:
`Podiumsdiskussion: „Podiumsdiskusssion“ → „Podiumsdiskussion“`. Bei sehr vielen
Kleinigkeiten zusammenfassen („12 Kommafehler“). Inhaltliche Auffälligkeiten
(Widersprüche, fehlende Ergebnisse, sensible Inhalte) separat als **Hinweise**,
ohne sie selbst zu ändern.

## Ergebnis immer als Link

Das Ergebnis ist **immer ein Link**, der das Protokoll direkt im Generator öffnet –
egal ob die Eingabe ein Link, JSON, eine Datei oder Notizen war. JSON gibt es nur,
wenn ausdrücklich danach gefragt wird.

1. **Link erzeugen:** Tool `protokoll_link` (prüft das Protokoll selbst – bei Fehlern
   korrigieren und erneut aufrufen). Ohne MCP-Tools: JSON in eine Datei schreiben und
   `python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py link <datei>` ausführen (bei Fehlern gibt es keinen Link).
2. **Antworten:** den fertigen Markdown-Link aus dem Ergebnis übernehmen, z. B.
   `[SV-Protokoll vom 27.1.2026 öffnen](https://…)`, dazu 2–4 Zeilen: was getan wurde,
   offene Fragen bzw. `[?]`-Stellen, Hinweise (z. B. weggelassene sensible Inhalte).
   **Kein JSON-Codeblock** in der Antwort.
3. Nur wenn weder Tool noch Python verfügbar sind: JSON als Datei ausgeben und auf
   „Import“ in der Seite hinweisen.

Auf Wunsch zusätzlich: JSON-Datei (`protokoll_save_json`), PDF (`protokoll_render_pdf`).

## Eingabe lesen
- **Link** (`…/SV/#import=…`, z. B. aus „Link kopieren“): `protokoll_decode_link` bzw.
  `python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py decode "<link>"`.
- JSON (eingefügt, als Datei oder Pfad): direkt verwenden.
- PDF/Screenshot eines alten Protokolls: Inhalt abtippen und ins Format überführen.

## Nachschlagen
Datenformat und Stilleitfaden bei Bedarf lesen, nicht raten: Tool `protokoll_format`
oder `references/format.md`, `references/stil.md`, `references/beispiel.json`,
`references/schema.json` im Ordner dieses Skills.
