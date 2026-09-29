## Ergebnis immer als Link

Das Ergebnis ist **immer ein Link**, der das Protokoll direkt im Generator öffnet –
egal ob die Eingabe ein Link, JSON, eine Datei oder Notizen war. JSON gibt es nur,
wenn ausdrücklich danach gefragt wird.

1. **Link erzeugen:** Tool `protokoll_link` (prüft das Protokoll selbst – bei Fehlern
   korrigieren und erneut aufrufen). Ohne MCP-Tools: JSON in eine Datei schreiben und
   `python {{SCRIPT}} link <datei>` ausführen (bei Fehlern gibt es keinen Link).
2. **Antworten:** den fertigen Markdown-Link aus dem Ergebnis übernehmen, z. B.
   `[SV-Protokoll vom 27.1.2026 öffnen](https://…)`, dazu 2–4 Zeilen: was getan wurde,
   offene Fragen bzw. `[?]`-Stellen, Hinweise (z. B. weggelassene sensible Inhalte).
   **Kein JSON-Codeblock** in der Antwort.
3. Nur wenn weder Tool noch Python verfügbar sind: JSON als Datei ausgeben und auf
   „Import“ in der Seite hinweisen.

Auf Wunsch zusätzlich: JSON-Datei (`protokoll_save_json`), PDF (`protokoll_render_pdf`).

## Helfer vor dem Ausliefern
- **Bericht bei bestehenden Protokollen:** `protokoll_diff` bzw.
  `python {{SCRIPT}} diff <alt> <neu>` – zeigt Punkte neu/geändert/entfernt und die
  Wortzahl vorher → nachher. Die Zahlen daraus im Bericht nennen.
- **Gegenlesen:** `protokoll_preview` bzw. `python {{SCRIPT}} preview <datei>` zeigt das
  Protokoll als Klartext so, wie es gerendert wird.
- **Länge:** `python {{SCRIPT}} stats <datei>` (Wörter je Punkt); über MCP steht das in
  `protokoll_validate`.
- Statt einer Datei nehmen alle Befehle und Tools auch direkt einen Link.

## Eingabe lesen
- **Link** (`…/SV/#import=…`, z. B. aus „Link kopieren“): `protokoll_decode_link` bzw.
  `python {{SCRIPT}} decode "<link>"`.
- JSON (eingefügt, als Datei oder Pfad): direkt verwenden.
- PDF/Screenshot eines alten Protokolls: Inhalt abtippen und ins Format überführen.

## Nachschlagen
Datenformat, Stilleitfaden und **Glossar** (feste Begriffe wie „SV-Aktion“, „SSR“) bei
Bedarf lesen, nicht raten: Tool `protokoll_format` oder `references/format.md`,
`references/stil.md`, `references/glossar.md`, `references/beispiel.json`,
`references/schema.json` im Ordner dieses Skills.
