---
name: protokoll-ueberarbeiten
description: Überarbeitet ein bestehendes SV-Protokoll (FWS Frankfurt, Format des SV-Protokoll-Generators) gründlich - formuliert um, strukturiert neu und hebt es auf professionelles Niveau nach dem SV-Stilleitfaden, ohne Fakten zu verändern. Verwenden bei "verbessern/umformulieren/professioneller machen/kürzen/überarbeiten" eines SV-Protokolls.
argument-hint: "[Protokoll-JSON, Link oder Dateipfad] [Wünsche, z. B. kürzer]"
---
<!-- Generiert aus shared/modi/protokoll-ueberarbeiten.md und shared/ausgabe.md – dort bearbeiten, dann `npm run build`. -->

# SV-Protokoll überarbeiten

Gründliche redaktionelle Überarbeitung nach dem Stilleitfaden. Ergebnis: ein
professionelles Protokoll, das Verlauf und Ergebnisse klar trennt. **Die Fakten
bleiben exakt dieselben.**

## Vorgehen
1. Protokoll lesen, Wünsche der Nutzerin/des Nutzers beachten (z. B. „kürzer“,
   „förmlicher“, „nur Punkt 3“). Wünsche gehen dem Stilleitfaden vor.
2. **Struktur:** Punkte sinnvoll schneiden – Zusammengehöriges bündeln, Überladenes
   teilen, „Sonstiges“ ans Ende. Titel nach Stilleitfaden vereinheitlichen.
3. **Pro Punkt** neu formulieren: Stand → Verlauf → Ergebnis → nächste Schritte, je
   als eigener Absatz. Ergebnis und Zuständigkeiten klar herausstellen.
4. **Sprache:** sachlich, präzise, „wir“-Perspektive, Wertungen und Umgangssprache
   raus, Füllsätze streichen, Wiederholungen zusammenführen.
5. **Abstimmungen:** Stehen Stimmenzahlen im Text, als `votes`-Tabelle anlegen und
   im Text nur noch das Ergebnis nennen.
6. Rechtschreibung und Formfehler wie bei einer Korrektur gleich mit beheben.

## Grenzen
- Alle Fakten, Namen, Zahlen, Termine und Beschlüsse bleiben erhalten – nichts
  hinzuerfinden, nichts Inhaltliches weglassen (Ausnahme: sensible Inhalte, siehe
  Stilleitfaden – dann im Chat melden).
- Fehlt einem Punkt das Ergebnis, nicht eines ausdenken: „Ein Ergebnis steht noch aus.“
  oder `[?]` und im Chat nachfragen.
- Eckdaten und Anwesenheit nur formal korrigieren.

## Bericht
Zusätzlich zum Abschluss: die 3–6 wichtigsten Änderungen in Stichpunkten
(z. B. „Punkt ‚Raum‘ und ‚Schlüssel‘ zu ‚SV-Raum‘ zusammengeführt“) und offene Fragen.

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
