import unittest
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

from excel_import import parse_question_xlsx

ROOT = Path(__file__).resolve().parents[1]


def make_xlsx(rows):
    def cell(ref, value):
        if isinstance(value, (int, float)):
            return f'<c r="{ref}"><v>{value}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'

    xml_rows = []
    for r_i, row in enumerate(rows, start=1):
        parts = []
        for c_i, value in enumerate(row, start=1):
            n = c_i
            letters = ""
            while n:
                n, rem = divmod(n - 1, 26)
                letters = chr(65 + rem) + letters
            parts.append(cell(f"{letters}{r_i}", value))
        xml_rows.append(f'<row r="{r_i}">' + ''.join(parts) + '</row>')

    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             '<sheetData>' + ''.join(xml_rows) + '</sheetData></worksheet>')
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Preguntas" sheetId="1" r:id="rId1"/></sheets></workbook>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet1.xml"/></Relationships>')
    content = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
               '<Default Extension="xml" ContentType="application/xml"/>'
               '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
               '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
               '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                 'Target="xl/workbook.xml"/></Relationships>')
    buf = BytesIO()
    with ZipFile(buf, 'w', ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', content)
        zf.writestr('_rels/.rels', root_rels)
        zf.writestr('xl/workbook.xml', workbook)
        zf.writestr('xl/_rels/workbook.xml.rels', rels)
        zf.writestr('xl/worksheets/sheet1.xml', sheet)
    return buf.getvalue()


class ExcelImportTests(unittest.TestCase):
    def test_demo_xlsx_imports(self):
        data = (ROOT / "preguntas_demostracion.xlsx").read_bytes()
        questions, errors = parse_question_xlsx(data)
        self.assertEqual(errors, [])
        self.assertEqual(len(questions), 5)
        self.assertEqual(questions[0]["id"], "EJ-001")
        self.assertGreaterEqual(len(questions[0]["answers"]), 1)

    def test_missing_columns_has_clear_error(self):
        data = make_xlsx([["ID", "Pregunta"], ["P1", "Texto"]])
        questions, errors = parse_question_xlsx(data)
        self.assertEqual(questions, [])
        self.assertTrue(any("Faltan columnas obligatorias" in e for e in errors))

    def test_more_than_eight_answers_is_rejected(self):
        rows = [["ID", "Pregunta", "Respuesta", "Puntos"]]
        for i in range(9):
            rows.append(["P1", "Pregunta", f"Respuesta {i}", i])
        questions, errors = parse_question_xlsx(make_xlsx(rows))
        self.assertEqual(questions, [])
        self.assertTrue(any("más de 8 respuestas" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
