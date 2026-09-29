---
name: protokoll-erstellen
description: Erstellt ein neues SV-Protokoll (FWS Frankfurt) im Format des SV-Protokoll-Generators aus Notizen, Stichpunkten, Chatverläufen oder dem Transkript einer Audioaufnahme. Verwenden, wenn ein Sitzungsprotokoll der Schülervertretung neu geschrieben, aus Mitschrift/Notizen/Transkript erstellt oder "from scratch" aufgesetzt werden soll.
argument-hint: "[Notizen, Transkript oder Dateipfad]"
---
<!-- Generiert aus shared/modi/protokoll-erstellen.md und shared/ausgabe.md – dort bearbeiten, dann `npm run build`. -->

# SV-Protokoll erstellen

Aus Rohmaterial (Notizen, Stichpunkte, Transkript) wird ein fertiges, formgetreues
SV-Protokoll als JSON für den SV-Protokoll-Generator.

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
