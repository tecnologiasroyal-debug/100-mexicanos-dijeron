from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List, Tuple
from zipfile import BadZipFile, ZipFile
import posixpath
import re
import xml.etree.ElementTree as ET

REQUIRED = ["ID", "Pregunta", "Respuesta", "Puntos"]
_NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
_CELL_REF = re.compile(r"([A-Z]+)")


def _col_index(cell_ref: str) -> int:
    m = _CELL_REF.match((cell_ref or "").upper())
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _text_from_si(node: ET.Element) -> str:
    return "".join((t.text or "") for t in node.iter(f"{{{_NS_MAIN}}}t"))


def _load_shared_strings(zf: ZipFile) -> List[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [_text_from_si(si) for si in root.findall(f"{{{_NS_MAIN}}}si")]


def _worksheet_path(zf: ZipFile) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    relmap = {
        r.attrib.get("Id", ""): r.attrib.get("Target", "")
        for r in rels.findall(f"{{{_NS_PKG_REL}}}Relationship")
    }
    sheets = workbook.find(f"{{{_NS_MAIN}}}sheets")
    if sheets is None or not list(sheets):
        raise ValueError("El libro no contiene hojas.")
    chosen = None
    for sh in sheets:
        if sh.attrib.get("name", "").strip().casefold() == "preguntas":
            chosen = sh
            break
    if chosen is None:
        chosen = list(sheets)[0]
    rid = chosen.attrib.get(f"{{{_NS_REL}}}id")
    target = relmap.get(rid or "", "")
    if not target:
        raise ValueError("No se pudo localizar la hoja de preguntas.")
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))


def _cell_value(cell: ET.Element, shared: List[str]) -> Any:
    ctype = cell.attrib.get("t", "")
    if ctype == "inlineStr":
        inline = cell.find(f"{{{_NS_MAIN}}}is")
        return _text_from_si(inline) if inline is not None else ""
    v = cell.find(f"{{{_NS_MAIN}}}v")
    raw = "" if v is None or v.text is None else v.text
    if ctype == "s":
        try:
            return shared[int(raw)]
        except Exception:
            return ""
    if ctype in ("str", "e"):
        return raw
    if ctype == "b":
        return raw == "1"
    if raw == "":
        return ""
    try:
        number = float(raw)
        return int(number) if number.is_integer() else number
    except Exception:
        return raw


def _xlsx_rows(data: bytes) -> List[List[Any]]:
    try:
        with ZipFile(BytesIO(data)) as zf:
            shared = _load_shared_strings(zf)
            sheet_path = _worksheet_path(zf)
            root = ET.fromstring(zf.read(sheet_path))
            sheet_data = root.find(f"{{{_NS_MAIN}}}sheetData")
            if sheet_data is None:
                return []
            rows: List[List[Any]] = []
            for row in sheet_data.findall(f"{{{_NS_MAIN}}}row"):
                values: Dict[int, Any] = {}
                max_col = -1
                for cell in row.findall(f"{{{_NS_MAIN}}}c"):
                    idx = _col_index(cell.attrib.get("r", "A1"))
                    values[idx] = _cell_value(cell, shared)
                    max_col = max(max_col, idx)
                rows.append([values.get(i, "") for i in range(max_col + 1)] if max_col >= 0 else [])
            return rows
    except BadZipFile as exc:
        raise ValueError("El archivo no es un .xlsx válido.") from exc
    except KeyError as exc:
        raise ValueError("El archivo .xlsx está incompleto o dañado.") from exc
    except ET.ParseError as exc:
        raise ValueError("No se pudo leer la estructura interna del .xlsx.") from exc


def _parse_points(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError
    if isinstance(value, (int, float)):
        n = float(value)
    else:
        text = str(value or "").strip()
        if not text:
            raise ValueError
        n = float(text.replace(",", "."))
    if n < 0 or not n.is_integer():
        raise ValueError
    return int(n)


def parse_question_xlsx(data: bytes) -> Tuple[List[Dict[str, Any]], List[str]]:
    errors: List[str] = []
    if not data:
        return [], ["El archivo está vacío."]

    try:
        all_rows = _xlsx_rows(data)
    except Exception as exc:
        return [], [f"No se pudo abrir el archivo .xlsx: {exc}"]

    if not all_rows:
        return [], ["El archivo no contiene filas."]

    header = all_rows[0]
    header_map = {str(v).strip().lower(): i for i, v in enumerate(header) if str(v).strip()}
    missing = [name for name in REQUIRED if name.lower() not in header_map]
    if missing:
        return [], ["Faltan columnas obligatorias: " + ", ".join(missing) + "."]

    grouped: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for excel_row, values in enumerate(all_rows[1:], start=2):
        def cell(name: str):
            idx = header_map[name.lower()]
            return values[idx] if idx < len(values) else ""

        qid_raw, qtext_raw, answer_raw, points_raw = cell("ID"), cell("Pregunta"), cell("Respuesta"), cell("Puntos")
        if all(str(v or "").strip() == "" for v in (qid_raw, qtext_raw, answer_raw, points_raw)):
            continue

        qid = str(qid_raw or "").strip()
        qtext = str(qtext_raw or "").strip()
        answer = str(answer_raw or "").strip()

        if not qid:
            errors.append(f"Fila {excel_row}: ID vacío.")
        if not qtext:
            errors.append(f"Fila {excel_row}: Pregunta vacía.")
        if not answer:
            errors.append(f"Fila {excel_row}: Respuesta vacía.")
        try:
            points = _parse_points(points_raw)
        except Exception:
            errors.append(f"Fila {excel_row}: Puntos debe ser un entero mayor o igual a 0.")
            points = 0

        if not qid or not qtext or not answer:
            continue

        if qid not in grouped:
            grouped[qid] = {"id": qid, "question": qtext, "answers": [], "example": False}
            order.append(qid)
        elif grouped[qid]["question"] != qtext:
            errors.append(f"Fila {excel_row}: el ID {qid} aparece con una Pregunta distinta.")

        grouped[qid]["answers"].append({"text": answer, "points": points})
        if len(grouped[qid]["answers"]) > 8:
            errors.append(f"ID {qid}: tiene más de 8 respuestas. El tablero admite máximo 8.")

    questions = [grouped[qid] for qid in order]
    if not questions and not errors:
        errors.append("No se encontraron preguntas válidas.")

    for q in questions:
        seen = set()
        for ans in q["answers"]:
            key = ans["text"].strip().casefold()
            if key in seen:
                errors.append(f"ID {q['id']}: la respuesta “{ans['text']}” está repetida.")
            seen.add(key)

    if errors:
        return [], errors
    return questions, []
