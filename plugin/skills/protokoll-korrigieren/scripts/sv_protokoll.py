#!/usr/bin/env python3
"""SV-Protokoll – Prüfen und Import-Links ohne MCP-Server.

Python 3.8+, nur Standardbibliothek. Gegenstück zu plugin/mcp/lib/protokoll.mjs
(gleiche Fehlerpfade, gleiche Hinweis-Codes, gleiche Link-Kodierung).

  python sv_protokoll.py validate protokoll.json   # Fehler + Hinweise, Exit 1 bei Fehlern
  python sv_protokoll.py link protokoll.json       # Markdown-Link, der das Protokoll im Generator öffnet
                                                   # (--raw: nur die URL)
  python sv_protokoll.py decode "<link>"           # Link -> JSON
  python sv_protokoll.py preview protokoll.json    # Klartext, wie das Protokoll gerendert aussieht
  python sv_protokoll.py stats protokoll.json      # Wörter je Punkt und gesamt
  python sv_protokoll.py diff alt.json neu.json    # Punkte vorher/nachher inkl. Wortzahl
  python sv_protokoll.py normalise protokoll.json  # in Export-Form bringen (stdout)

Statt eines Dateinamens geht auch "-" (stdin) oder direkt ein Link (…#import=…).
"""

import base64
import json
import math
import os
import re
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_CANDIDATES = [
    os.path.join(HERE, "..", "references", "schema.json"),
    os.path.join(HERE, "..", "schema", "protokoll.schema.json"),
]
APP_URL = os.environ.get("SV_APP_URL", "https://professorquantumuniverse.github.io/SV/")
LINK_PARAM = "import"

TYPE_NAMES = {
    "null": "null", "boolean": "Wahrheitswert", "integer": "ganze Zahl", "number": "Zahl",
    "string": "Text", "array": "Liste", "object": "Objekt",
}


def load_schema():
    for path in SCHEMA_CANDIDATES:
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
    raise SystemExit("schema.json nicht gefunden (erwartet in ../references/).")


# ── Schema-Validierung (gleiche Teilmenge wie protokoll.mjs) ──────────

def type_of(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "integer" if value.is_integer() else "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def join_path(path, key):
    if isinstance(key, int):
        return "%s[%d]" % (path, key)
    return "%s.%s" % (path, key) if path else key


def resolve(node, root):
    while isinstance(node, dict) and "$ref" in node:
        cur = root
        for part in node["$ref"].lstrip("#/").split("/"):
            cur = cur[part]
        node = cur
    return node


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def check(node, value, path, root, errors):
    s = resolve(node, root)
    at = path or "(Protokoll)"

    if "const" in s and not (dumps(value) == dumps(s["const"]) and type_of(value) == type_of(s["const"])):
        errors.append({"path": at, "message": "muss %s sein" % dumps(s["const"])})
        return
    if "enum" in s and value not in s["enum"]:
        errors.append({"path": at, "message": "erlaubt sind: %s" % ", ".join(s["enum"])})
        return
    if "anyOf" in s:
        # Passt genau eine Alternative vom Typ her, deren Fehler melden.
        actual = type_of(value)
        by_type = []
        for alt in s["anyOf"]:
            t = resolve(alt, root).get("type")
            ts = t if isinstance(t, list) else ([t] if t else [])
            if not ts or any(x == actual or (x == "number" and actual == "integer") for x in ts):
                by_type.append(alt)
        if len(by_type) == 1:
            check(by_type[0], value, path, root, errors)
            return
        ok = False
        for alt in s["anyOf"]:
            trial = []
            check(alt, value, path, root, trial)
            if not trial:
                ok = True
                break
        if not ok:
            msg = "ungültiger Wert %s" % dumps(value)
            if s.get("description"):
                msg += " – " + s["description"]
            errors.append({"path": at, "message": msg})
        return
    if "type" in s:
        actual = type_of(value)
        types = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(t == actual or (t == "number" and actual == "integer") for t in types):
            errors.append({"path": at, "message": "erwartet %s, gefunden %s" % (
                " oder ".join(TYPE_NAMES[t] for t in types), TYPE_NAMES[actual])})
            return

    kind = type_of(value)
    if kind == "string":
        if "maxLength" in s and len(value) > s["maxLength"]:
            errors.append({"path": at, "message": "zu lang (%d Zeichen, max. %d)" % (len(value), s["maxLength"])})
        # \Z statt $ und ASCII-\d – verhält sich damit wie ein JavaScript-RegExp
        pattern = re.sub(r"\$$", r"\\Z", s.get("pattern", ""))
        if "pattern" in s and not re.search(pattern, value, re.ASCII):
            msg = "Format ungültig: %s" % dumps(value)
            if s.get("description"):
                msg += " – " + s["description"]
            errors.append({"path": at, "message": msg})
    elif kind in ("integer", "number"):
        if "minimum" in s and value < s["minimum"]:
            errors.append({"path": at, "message": "muss ≥ %s sein" % s["minimum"]})
    elif kind == "array":
        if "minItems" in s and len(value) < s["minItems"]:
            errors.append({"path": at, "message": "mindestens %d Einträge nötig" % s["minItems"]})
        if "maxItems" in s and len(value) > s["maxItems"]:
            errors.append({"path": at, "message": "höchstens %d Einträge erlaubt" % s["maxItems"]})
        if "items" in s:
            for i, item in enumerate(value):
                check(s["items"], item, join_path(path, i), root, errors)
    elif kind == "object":
        props = s.get("properties", {})
        for key in s.get("required", []):
            if key not in value:
                errors.append({"path": join_path(path, key), "message": "Pflichtfeld fehlt"})
        for key in value:
            sub = join_path(path, key)
            if "propertyNames" in s:
                trial = []
                check(s["propertyNames"], key, sub, root, trial)
                if trial:
                    errors.append({"path": sub, "message": "unbekannter Schlüssel – " + trial[0]["message"]})
                    continue
            if key in props:
                check(props[key], value[key], sub, root, errors)
            elif s.get("additionalProperties") is False:
                errors.append({"path": sub, "message": "unbekanntes Feld"})
            elif isinstance(s.get("additionalProperties"), dict):
                check(s["additionalProperties"], value[key], sub, root, errors)


# ── Stil-Hinweise ─────────────────────────────────────────────────────

MARKDOWN = re.compile(r"\*\*|__|^#{1,6}\s|\[[^\]]+\]\([^)]+\)", re.M)


def blank(v):
    return v is None or str(v).strip() == ""


def lint(data):
    w = []

    def add(code, path, message):
        w.append({"code": code, "path": path, "message": message})

    if blank(data.get("author")):
        add("no-author", "author", "Protokollant*in fehlt – die Fußzeile bleibt leer.")
    if blank(data.get("printDate")):
        add("no-print-date", "printDate", "Erstellungsdatum fehlt.")
    if data.get("meetingDate") and data.get("printDate") and str(data["printDate"]) < str(data["meetingDate"]):
        add("print-before-meeting", "printDate", "Erstellungsdatum liegt vor dem Sitzungsdatum.")
    if data.get("timeFrom") and data.get("timeTo") and str(data["timeTo"]) <= str(data["timeFrom"]):
        add("time-order", "timeTo", "Ende liegt nicht nach dem Beginn.")

    att = data.get("attendance") if isinstance(data.get("attendance"), dict) else {}
    if not any(not blank(v) for v in att.values()):
        add("no-attendance", "attendance", "Keine Anwesenden eingetragen.")
    for cls, names in att.items():
        if isinstance(names, str) and re.search(r";|/|\s(und|&)\s", names):
            add("attendance-separator", "attendance." + cls,
                "Namen nur durch Komma trennen (kein „und“, „;“ oder „/“).")

    sections = data.get("sections") if isinstance(data.get("sections"), list) else []
    if not sections:
        add("no-sections", "sections", "Das Protokoll hat keine Punkte.")
    seen = {}
    ids = {}
    for i, sec in enumerate(sections):
        if not isinstance(sec, dict):
            continue
        p = "sections[%d]" % i
        if isinstance(sec.get("id"), str) and sec["id"]:
            if sec["id"] in ids:
                add("duplicate-id", p + ".id",
                    "ID doppelt (wie sections[%d]) – beim Zusammenlegen nur eine behalten." % ids[sec["id"]])
            else:
                ids[sec["id"]] = i
        title = sec["title"].strip() if isinstance(sec.get("title"), str) else ""
        text = sec["text"] if isinstance(sec.get("text"), str) else ""
        votes = sec.get("votes")
        rows = votes["rows"] if isinstance(votes, dict) and isinstance(votes.get("rows"), list) else []

        if not title and blank(text) and not rows:
            add("empty-section", p, "Leerer Punkt – erscheint nicht im Protokoll.")
        elif not title:
            add("no-title", p + ".title", "Punkt ohne Titel – fehlt in der Themenliste.")
        if title.endswith(":"):
            add("title-colon", p + ".title", "Titel ohne abschließenden Doppelpunkt schreiben.")
        if len(title) > 40:
            add("long-title", p + ".title", "Titel ist sehr lang – besser 1–3 Wörter.")
        if title:
            key = title.lower()
            if key in seen:
                add("duplicate-title", p + ".title", "Titel doppelt (wie sections[%d])." % seen[key])
            else:
                seen[key] = i
        if MARKDOWN.search(title) or MARKDOWN.search(text):
            add("markdown", p, "Markdown wird nicht dargestellt (z. B. **fett**) – als reinen Text schreiben.")
        if '"' in title or '"' in text:
            add("straight-quotes", p, "Gerade Anführungszeichen – besser „…“.")
        if "[?]" in text:
            add("placeholder", p + ".text", "Enthält offene Stellen [?].")

        for j, r in enumerate(rows):
            if not isinstance(r, dict):
                continue
            rp = "%s.votes.rows[%d]" % (p, j)
            if blank(r.get("label")):
                add("vote-no-label", rp + ".label", "Abstimmungszeile ohne Bezeichnung.")
            if all(blank(r.get(k)) for k in ("yes", "no", "abstain")):
                add("vote-no-counts", rp, "Abstimmungszeile ohne Stimmen.")
    return w


def validate(data):
    if not isinstance(data, dict):
        return {"valid": False, "errors": [{"path": "(Protokoll)", "message": "erwartet ein JSON-Objekt"}], "warnings": []}
    root = load_schema()
    errors = []
    check(root, data, "", root, errors)
    return {"valid": not errors, "errors": errors, "warnings": lint(data)}


# ── Klartext-Vorschau, Diff, Statistik (wie protokoll.mjs) ────────────

ALL_CLASSES = ["7A", "7B", "8A", "8B", "9A", "9B", "10A", "10B", "11A", "11B", "12A", "12B", "13A", "13B"]


def s_(v):
    return "" if v is None else (json.dumps(v) if isinstance(v, bool) else str(v))


def word_count(text):
    return len(re.findall(r"\S+", s_(text)))


def section_words(sec):
    return word_count("%s %s" % (s_(sec.get("title")), s_(sec.get("text"))))


def section_list(data):
    secs = data.get("sections")
    return [x for x in secs if isinstance(x, dict)] if isinstance(secs, list) else []


def count_names(v):
    return len([x for x in s_(v).split(",") if x.strip()])


def format_date(value):
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})\Z", s_(value), re.ASCII)
    return "%d.%d.%s" % (int(m.group(3)), int(m.group(2)), m.group(1)) if m else "…"


def subtitle(data):
    bits = []
    if s_(data.get("location")).strip():
        bits.append(s_(data.get("location")).strip())
    frm = s_(data.get("timeFrom")).replace(":", ".", 1)
    to = s_(data.get("timeTo")).replace(":", ".", 1)
    if frm and to:
        bits.append("%s – %s Uhr" % (frm, to))
    elif frm:
        bits.append("ab %s Uhr" % frm)
    elif to:
        bits.append("bis %s Uhr" % to)
    return " · ".join(bits)


def to_num(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return int(n) if n.is_integer() else n


def vote_result(row):
    y, n, a = (to_num(row.get(k)) for k in ("yes", "no", "abstain"))
    if y is None and n is None and a is None:
        return "–"
    if (y or 0) > (n or 0):
        return "Angenommen"
    if (y or 0) < (n or 0):
        return "Abgelehnt"
    return "Unentschieden"


def vote_rows(sec):
    v = sec.get("votes")
    rows = v.get("rows") if isinstance(v, dict) else None
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def has_content(sec):
    return bool(s_(sec.get("title")).strip() or s_(sec.get("text")).strip() or vote_rows(sec))


def preview(data):
    out = ["SV-Protokoll – " + format_date(data.get("meetingDate"))]
    sub = subtitle(data)
    if sub:
        out.append(sub)

    att = data.get("attendance") if isinstance(data.get("attendance"), dict) else {}
    present = [c for c in ALL_CLASSES if count_names(att.get(c)) > 0]
    people = sum(count_names(att.get(c)) for c in present)
    out.append("")
    if people:
        out.append("Anwesend: %d %s aus %d %s" % (people, "Person" if people == 1 else "Personen",
                                                   len(present), "Klasse" if len(present) == 1 else "Klassen"))
    else:
        out.append("Anwesend: –")
    for c in present:
        out.append("  %s: %s" % (c, s_(att.get(c)).strip()))

    sections = [x for x in section_list(data) if has_content(x)]
    topics = [s_(x.get("title")).strip() for x in sections if s_(x.get("title")).strip()]
    if topics:
        out += ["", "Themen: " + ", ".join(topics)]

    out += ["", "Protokoll:"]
    for sec in sections:
        out += ["", "▌ " + (s_(sec.get("title")).strip() or "(ohne Titel)")]
        paras = [p.rstrip() for p in re.split(r"\n{2,}", s_(sec.get("text")))]
        for i, p in enumerate(x for x in paras if x.strip()):
            if i:
                out.append("")
            out.append(p)
        rows = vote_rows(sec)
        if rows:
            caption = s_(sec["votes"].get("caption")).strip()
            out.append("  Abstimmung" + (": " + caption if caption else ""))
            for r in rows:
                def cell(v):
                    n = to_num(v)
                    return "–" if n is None else str(n)
                out.append("  – %s: Ja %s · Nein %s · Enth. %s → %s" % (
                    s_(r.get("label")).strip() or "–", cell(r.get("yes")), cell(r.get("no")),
                    cell(r.get("abstain")), vote_result(r)))
    out += ["", "Erstellt von %s, %s" % (s_(data.get("author")).strip() or "…", format_date(data.get("printDate")))]
    return "\n".join(out)


EC_FIELDS = [("meetingDate", "Sitzungsdatum"), ("printDate", "Erstellt am"), ("author", "Protokollant*in"),
             ("location", "Ort"), ("timeFrom", "Beginn"), ("timeTo", "Ende")]


def vote_key(sec):
    rows = vote_rows(sec)
    if not rows:
        return ""
    return dumps([s_(sec["votes"].get("caption")),
                  [[s_(r.get("label")), s_(r.get("yes")), s_(r.get("no")), s_(r.get("abstain"))] for r in rows]])


def quote(v):
    return "„%s“" % s_(v).strip() if s_(v).strip() else "–"


def diff(before, after):
    out = []
    changes = ["  %s: %s → %s" % (label, quote(before.get(k)), quote(after.get(k)))
               for k, label in EC_FIELDS if s_(before.get(k)).strip() != s_(after.get(k)).strip()]
    if changes:
        out += ["Eckdaten:"] + changes
    att_a = before.get("attendance") or {}
    att_b = after.get("attendance") or {}
    att_changes = ["  %s: %s → %s" % (c, quote(att_a.get(c)), quote(att_b.get(c)))
                   for c in ALL_CLASSES if s_(att_a.get(c)).strip() != s_(att_b.get(c)).strip()]
    if att_changes:
        out += ["Anwesenheit:"] + att_changes

    olds = section_list(before)
    used = set()

    def title(sec):
        return s_(sec.get("title")).strip() or "(ohne Titel)"

    def find_old(sec):
        if sec.get("id") is not None and sec.get("id") != "":
            for k, o in enumerate(olds):
                if k not in used and o.get("id") is not None and s_(o.get("id")) == s_(sec.get("id")):
                    return k
        t = s_(sec.get("title")).strip().lower()
        if t:
            for k, o in enumerate(olds):
                if k not in used and s_(o.get("title")).strip().lower() == t:
                    return k
        return -1

    out.append("Punkte:")
    for sec in section_list(after):
        i = find_old(sec)
        if i < 0:
            out.append("  + %s (neu, %d Wörter)" % (title(sec), section_words(sec)))
            continue
        used.add(i)
        old = olds[i]
        notes = []
        if s_(old.get("title")).strip() != s_(sec.get("title")).strip():
            notes.append("Titel: %s → %s" % (quote(old.get("title")), quote(sec.get("title"))))
        if vote_key(old) != vote_key(sec):
            notes.append("Abstimmung geändert")
        if not notes and s_(old.get("text")) == s_(sec.get("text")):
            out.append("  = %s (unverändert, %d Wörter)" % (title(sec), section_words(sec)))
        else:
            out.append("  ~ %s (%d → %d Wörter)%s" % (title(sec), section_words(old), section_words(sec),
                                                      " [%s]" % "; ".join(notes) if notes else ""))
    for k, old in enumerate(olds):
        if k not in used:
            out.append("  − %s (entfernt, %d Wörter)" % (title(old), section_words(old)))

    a = sum(section_words(x) for x in olds)
    b = sum(section_words(x) for x in section_list(after))
    total = "Gesamt: %d → %d Wörter" % (a, b)
    if a:
        pct = int(math.floor((b - a) / a * 100 + 0.5))
        total += " (%s%d %%)" % ("+" if pct > 0 else "", pct)
    out.append(total)
    return "\n".join(out)


def stats_text(data):
    secs = section_list(data)
    width = max([len(s_(x.get("title")).strip() or "(ohne Titel)") for x in secs] + [5])
    lines = ["%-*s  %5d" % (width, s_(x.get("title")).strip() or "(ohne Titel)", section_words(x)) for x in secs]
    lines.append("%-*s  %5d" % (width, "Summe", sum(section_words(x) for x in secs)))
    return "\n".join(lines)


# ── Normalisieren & Links ─────────────────────────────────────────────

def normalise(data):
    def s(v):
        return "" if v is None else str(v)

    out_sections = []
    for sec in data.get("sections") or []:
        out = {}
        if sec.get("id") is not None:
            out["id"] = str(sec["id"])
        out["title"] = s(sec.get("title"))
        out["text"] = s(sec.get("text"))
        votes = sec.get("votes")
        if isinstance(votes, dict) and votes.get("rows"):
            out["votes"] = {
                "caption": s(votes.get("caption")),
                "rows": [{"label": s(r.get("label")), "yes": s(r.get("yes")),
                          "no": s(r.get("no")), "abstain": s(r.get("abstain"))} for r in votes["rows"]],
            }
        else:
            out["votes"] = None
        out_sections.append(out)
    return {
        "format": "sv-protokoll",
        "version": 1,
        "meetingDate": s(data.get("meetingDate")),
        "printDate": s(data.get("printDate")),
        "author": s(data.get("author")),
        "location": s(data.get("location")),
        "timeFrom": s(data.get("timeFrom")),
        "timeTo": s(data.get("timeTo")),
        "attendance": {k: str(v).strip() for k, v in (data.get("attendance") or {}).items() if not blank(v)},
        "sections": out_sections,
    }


def encode_payload(data):
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = comp.compress(raw) + comp.flush()
    return base64.urlsafe_b64encode(packed).decode("ascii").rstrip("=")


def decode_payload(payload):
    padded = payload + "=" * (-len(payload) % 4)
    return json.loads(zlib.decompress(base64.urlsafe_b64decode(padded), -15).decode("utf-8"))


def make_link(data, app_url=APP_URL):
    return "%s#%s=%s" % (app_url.split("#")[0], LINK_PARAM, encode_payload(normalise(data)))


def link_label(data):
    parts = str(data.get("meetingDate") or "").split("-")
    if len(parts) == 3 and all(parts):
        y, m, d = parts
        return "SV-Protokoll vom %d.%d.%s öffnen" % (int(d), int(m), y)
    return "SV-Protokoll öffnen"


def extract_payload(link):
    link = link.strip()
    m = re.search(r"(?:^|[#&])%s=([A-Za-z0-9_-]+)" % LINK_PARAM, link)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]+", link):
        return link
    raise ValueError("Kein „#%s=…“ im Link gefunden." % LINK_PARAM)


# ── CLI ───────────────────────────────────────────────────────────────

def read_json(src):
    """Datei, "-" (stdin) oder direkt ein Link (…#import=…)."""
    if re.search(r"[#&]%s=" % LINK_PARAM, src):
        return decode_payload(extract_payload(src))
    text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8-sig").read()
    return json.loads(text)


COMMANDS = ("validate", "link", "decode", "normalise", "preview", "stats", "diff")


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 2 or argv[0] not in COMMANDS or (argv[0] == "diff" and len(argv) < 3):
        print(__doc__.strip())
        return 2
    cmd, arg = argv[0], argv[1]

    if cmd == "decode":
        print(json.dumps(decode_payload(extract_payload(arg)), ensure_ascii=False, indent=2))
        return 0
    if cmd == "diff":
        print(diff(read_json(arg), read_json(argv[2])))
        return 0

    data = read_json(arg)
    if cmd == "preview":
        print(preview(data))
        return 0
    if cmd == "stats":
        print(stats_text(data))
        return 0
    result = validate(data)
    result = validate(data)
    if cmd == "validate":
        if "--json" in argv:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print("✓ Gültig." if result["valid"] else "✗ Ungültig.")
            for e in result["errors"]:
                print("Fehler   %s: %s" % (e["path"], e["message"]))
            for w in result["warnings"]:
                print("Hinweis  [%s] %s: %s" % (w["code"], w["path"], w["message"]))
        return 0 if result["valid"] else 1

    if not result["valid"]:
        for e in result["errors"]:
            print("Fehler   %s: %s" % (e["path"], e["message"]), file=sys.stderr)
        return 1
    if cmd == "link":
        url = make_link(data)
        if "--raw" in argv:
            print(url)
        else:
            print("[%s](%s)" % (link_label(data), url))
    else:
        print(json.dumps(normalise(data), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
