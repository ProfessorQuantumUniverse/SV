#!/usr/bin/env python3
"""SV-Protokoll – Prüfen und Import-Links ohne MCP-Server.

Python 3.8+, nur Standardbibliothek. Gegenstück zu plugin/mcp/lib/protokoll.mjs
(gleiche Fehlerpfade, gleiche Hinweis-Codes, gleiche Link-Kodierung).

  python sv_protokoll.py validate protokoll.json   # Fehler + Hinweise, Exit 1 bei Fehlern
  python sv_protokoll.py link protokoll.json       # Link, der das Protokoll im Generator öffnet
  python sv_protokoll.py decode "<link>"           # Link -> JSON
  python sv_protokoll.py normalise protokoll.json  # in Export-Form bringen (stdout)

Statt eines Dateinamens liest "-" von stdin.
"""

import base64
import json
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
    for i, sec in enumerate(sections):
        if not isinstance(sec, dict):
            continue
        p = "sections[%d]" % i
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
    text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8-sig").read()
    return json.loads(text)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 2 or argv[0] not in ("validate", "link", "decode", "normalise"):
        print(__doc__.strip())
        return 2
    cmd, arg = argv[0], argv[1]

    if cmd == "decode":
        print(json.dumps(decode_payload(extract_payload(arg)), ensure_ascii=False, indent=2))
        return 0

    data = read_json(arg)
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
        print(make_link(data))
    else:
        print(json.dumps(normalise(data), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
