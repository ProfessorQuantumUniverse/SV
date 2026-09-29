---
name: protokoll-ueberarbeiten
description: Überarbeitet ein bestehendes SV-Protokoll (Schülervertretung FWS Frankfurt, SV-Protokoll-Generator) - formuliert um, kürzt, strukturiert neu, ergänzt/ändert einzelne Punkte oder hebt es auf professionelles Niveau nach dem SV-Stilleitfaden. Verwenden bei "kürze/verbessere/formuliere um/mach professioneller/überarbeite/ändere Punkt X". Auch wenn nur ein Link auf den SV-Protokoll-Generator (professorquantumuniverse.github.io/SV/#import=...) geschickt wird. Ergebnis ist immer ein neuer Link.
argument-hint: "[Protokoll-JSON, Link oder Dateipfad] [Wünsche, z. B. kürzer]"
title: SV-Protokoll überarbeiten
---
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

## Wenn gekürzt werden soll
„Kürzer“ geht dem Aufbau aus dem Stilleitfaden vor. Ziel: spürbar kürzer
(Richtwert: ein Viertel bis ein Drittel weniger Wörter), ohne dass ein Fakt verloren geht.
- **Raus:** Füllsätze, Wiederholungen, Höflichkeitsformeln, Begründungen, die nichts zum
  Ergebnis beitragen. Den Verlauf auf einen Halbsatz verdichten oder ganz streichen, wenn
  das Ergebnis für sich spricht.
- **Erlaubt:** Punkte zusammenlegen, ein einziger Absatz pro Punkt statt
  Stand/Verlauf/Ergebnis, knappe Aufzählungen mit „– “.
- **Bleibt immer:** Ergebnisse, Beschlüsse, Abstimmungen, Zuständigkeiten (wer macht was),
  Termine, Namen, Zahlen und ausdrücklich offene Punkte.
- Im Bericht die Wortzahl vorher → nachher nennen (`diff`).

## Grenzen
- Keine Fakten, Namen, Zahlen, Termine oder Beschlüsse hinzuerfinden oder verlieren.
  Ausnahme: sensible Inhalte (siehe Stilleitfaden), die dann im Chat melden.
- Fehlt einem Punkt das Ergebnis, nicht eines ausdenken: „Ein Ergebnis steht noch aus.“
  oder `[?]` und im Chat nachfragen.
- **Eckdaten bleiben unverändert:** Sitzungsdatum, „Erstellt am“ (`printDate`),
  Protokollant*in (`author`), Ort, Zeiten und Anwesenheit nur formal korrigieren – ändern
  nur auf ausdrücklichen Wunsch.
- Inhaltliche Änderungen, die ausdrücklich verlangt werden (Punkt ergänzen, Datum ändern,
  Namen nachtragen), werden übernommen – aber nur mit den genannten Fakten.
- Begriffe nach dem Glossar vereinheitlichen; Unbekanntes nachfragen statt raten.
- **IDs:** Beim Zusammenlegen die `id` des ersten Punkts behalten, die der anderen entfallen.
  Neue Punkte bekommen keine `id`. So kann `diff` alt und neu richtig zuordnen.

## Bericht
Zusätzlich zum Link: die 3–6 wichtigsten Änderungen in Stichpunkten
(z. B. „Punkt ‚Raum‘ und ‚Schlüssel‘ zu ‚SV-Raum‘ zusammengeführt“) und offene Fragen.
Grundlage ist `diff` zwischen altem und neuem Protokoll (inkl. Wortzahl).
