---
name: protokoll-erstellen
description: Erstellt ein neues SV-Protokoll (Schülervertretung FWS Frankfurt) im Format des SV-Protokoll-Generators aus Notizen, Stichpunkten, Chatverläufen oder dem Transkript einer Audioaufnahme. Verwenden, wenn ein Sitzungsprotokoll neu geschrieben, aus Mitschrift/Notizen/Transkript erstellt oder "from scratch" aufgesetzt werden soll. Ergebnis ist immer ein Link, der das Protokoll im Generator öffnet.
argument-hint: "[Notizen, Transkript oder Dateipfad]"
allowed-tools: mcp__plugin_sv-protokoll_sv-protokoll__protokoll_format mcp__plugin_sv-protokoll_sv-protokoll__protokoll_validate mcp__plugin_sv-protokoll_sv-protokoll__protokoll_link mcp__plugin_sv-protokoll_sv-protokoll__protokoll_decode_link mcp__plugin_sv-protokoll_sv-protokoll__protokoll_diff mcp__plugin_sv-protokoll_sv-protokoll__protokoll_preview Bash(python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py *) Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py *) Bash(py ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py *)
---
<!-- Generiert aus shared/modi/protokoll-erstellen.md und shared/ausgabe.md – dort bearbeiten, dann `npm run build`. -->

# SV-Protokoll erstellen

Aus Rohmaterial (Notizen, Stichpunkte, Transkript) wird ein fertiges, formgetreues
SV-Protokoll für den SV-Protokoll-Generator – ausgeliefert als Link.

## Vorgehen
1. **Material sichten.** Notizen, Transkript, Chatverlauf, altes Protokoll – alles zählt.
   - **Audio:** Kannst du die Datei nicht selbst transkribieren, bitte um ein Transkript
     (Diktier-/Transkriptionsfunktion am Handy, Teams/Zoom-Transkript, Whisper) und
     brich hier ab.
   - **Transkripte** sind unsauber: Sprecher zuordnen, Füllwörter, Abschweifungen,
     Privatgespräche und Organisatorisches ohne Inhalt („Hört ihr mich?“) weglassen.
2. **Eckdaten** herausziehen: Datum, Uhrzeit, Ort, Protokollant*in, Anwesende je Klasse.
   `printDate` = heute, wenn nicht anders angegeben.
3. **Tagesordnungspunkte** identifizieren – in Sitzungsreihenfolge. Thematisch
   Zusammengehöriges zu einem Punkt bündeln, auch wenn es verstreut besprochen wurde.
4. **Pro Punkt** nach Stilleitfaden schreiben: Stand → Verlauf → Ergebnis → nächste
   Schritte. Nur was im Material steht.
   Abkürzungen und Begriffe aus den Notizen (z. B. „FS“, „SSR“) nach dem Glossar
   auflösen bzw. schreiben; was dort nicht steht, nachfragen.
5. **Abstimmungen** erkennen („wer ist dafür … 12, dagegen 3“) → `votes`-Tabelle.
   Ohne Zahlen keine Tabelle.
6. **Lücken:** Fehlt etwas Wesentliches (Datum, Anwesenheit, Protokollant*in), trotzdem
   einen vollständigen Entwurf liefern – Feld leer lassen bzw. `[?]` im Text – und
   gesammelt nachfragen. Nur wenn Datum *und* Inhalt völlig unklar sind, vorher fragen.

## Regeln
- Nichts erfinden: keine Namen, Zahlen, Termine, Beschlüsse, die nicht im Material stehen.
- Anwesenheit nur, wenn sie im Material steht; Namen der richtigen Klasse zuordnen
  (unsicher → im Chat nachfragen, nicht raten).
- Sensible Inhalte (siehe Stilleitfaden) weglassen und im Chat erwähnen.

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

## Helfer vor dem Ausliefern
- **Bericht bei bestehenden Protokollen:** `protokoll_diff` bzw.
  `python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py diff <alt> <neu>` – zeigt Punkte neu/geändert/entfernt und die
  Wortzahl vorher → nachher. Die Zahlen daraus im Bericht nennen.
- **Gegenlesen:** `protokoll_preview` bzw. `python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py preview <datei>` zeigt das
  Protokoll als Klartext so, wie es gerendert wird.
- **Länge:** `python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py stats <datei>` (Wörter je Punkt); über MCP steht das in
  `protokoll_validate`.
- Statt einer Datei nehmen alle Befehle und Tools auch direkt einen Link.

## Eingabe lesen
- **Link** (`…/SV/#import=…`, z. B. aus „Link kopieren“): `protokoll_decode_link` bzw.
  `python ${CLAUDE_SKILL_DIR}/scripts/sv_protokoll.py decode "<link>"`.
- JSON (eingefügt, als Datei oder Pfad): direkt verwenden.
- PDF/Screenshot eines alten Protokolls: Inhalt abtippen und ins Format überführen.

## Nachschlagen
Datenformat, Stilleitfaden und **Glossar** (feste Begriffe wie „SV-Aktion“, „SSR“) bei
Bedarf lesen, nicht raten: Tool `protokoll_format` oder `references/format.md`,
`references/stil.md`, `references/glossar.md`, `references/beispiel.json`,
`references/schema.json` im Ordner dieses Skills.
