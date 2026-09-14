import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from test_excel_import import make_xlsx
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import app as app_module


class SyncHttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        demo = [
            {"id":"Q1","question":"Pregunta HTTP","example":True,"answers":[
                {"text":"SECRETO_UNO","points":40},
                {"text":"SECRETO_DOS","points":25}
            ]}
        ]
        (root / "demo.json").write_text(json.dumps(demo), encoding="utf-8")
        self.patchers = [
            patch.object(app_module, "DEMO_FILE", root / "demo.json"),
            patch.object(app_module, "BANK_FILE", root / "bank.json"),
            patch.object(app_module, "STATE_FILE", root / "state.json"),
            patch.object(app_module, "CONFIG_FILE", root / "config.json"),
            patch.object(app_module, "USAGE_FILE", root / "usage.json"),
        ]
        for p in self.patchers: p.start()
        self.old_app = app_module.APP
        app_module.APP = app_module.GameApp()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        app_module.APP = self.old_app
        for p in reversed(self.patchers): p.stop()
        self.tmp.cleanup()

    def request_json(self, path, method="GET", data=None, token=None):
        headers = {}
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read().decode("utf-8"))

    def test_public_does_not_receive_hidden_answers_and_syncs_after_reveal(self):
        public_before = self.request_json("/api/public/state")["data"]
        raw_before = json.dumps(public_before, ensure_ascii=False)
        self.assertNotIn("SECRETO_UNO", raw_before)
        self.assertNotIn("SECRETO_DOS", raw_before)

        login = self.request_json("/api/login", method="POST", data={"code": app_module.APP.config["control_pin"]})
        token = login["token"]
        control = self.request_json("/api/control/state", token=token)["data"]
        raw_control = json.dumps(control, ensure_ascii=False)
        self.assertIn("SECRETO_UNO", raw_control)
        self.assertIn("SECRETO_DOS", raw_control)

        self.request_json("/api/action", method="POST", token=token, data={"action":"reveal","payload":{"index":0}})
        public_after = self.request_json("/api/public/state")["data"]
        raw_after = json.dumps(public_after, ensure_ascii=False)
        self.assertIn("SECRETO_UNO", raw_after)
        self.assertNotIn("SECRETO_DOS", raw_after)
        self.assertEqual(public_after["round_points"], 40)

    def request_bytes(self, path, body, token, filename):
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
            "X-Filename": filename,
        }
        req = urllib.request.Request(self.base + path, data=body, method="POST", headers=headers)
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read().decode("utf-8"))

    def test_undo_after_award_restores_score_and_round(self):
        login = self.request_json("/api/login", method="POST", data={"code": app_module.APP.config["control_pin"]})
        token = login["token"]
        self.request_json("/api/action", method="POST", token=token, data={"action":"reveal","payload":{"index":0}})
        awarded = self.request_json("/api/action", method="POST", token=token, data={"action":"award","payload":{"team":0,"reason":"ronda"}})["data"]
        self.assertEqual(awarded["state"]["teams"][0]["score"], 40)
        self.assertTrue(awarded["state"]["round_awarded"])
        undone = self.request_json("/api/action", method="POST", token=token, data={"action":"undo","payload":{}})["data"]
        self.assertEqual(undone["state"]["teams"][0]["score"], 0)
        self.assertFalse(undone["state"]["round_awarded"])
        self.assertEqual(undone["state"]["round_points"], 40)


    def test_used_question_is_persistent_and_post_award_reveal_does_not_rescore(self):
        login = self.request_json("/api/login", method="POST", data={"code": app_module.APP.config["control_pin"]})
        token = login["token"]
        started = self.request_json("/api/action", method="POST", token=token, data={"action":"start_round","payload":{}})["data"]
        self.assertEqual(started["question_usage"]["used"], 1)
        self.request_json("/api/action", method="POST", token=token, data={"action":"reveal","payload":{"index":0}})
        awarded = self.request_json("/api/action", method="POST", token=token, data={"action":"award","payload":{"team":0,"reason":"robo"}})["data"]
        self.assertEqual(awarded["state"]["round_points"], 40)
        after = self.request_json("/api/action", method="POST", token=token, data={"action":"reveal","payload":{"index":1}})["data"]
        self.assertEqual(after["state"]["round_points"], 40)
        self.assertEqual(after["state"]["teams"][0]["score"], 40)
        self.assertEqual(after["question_usage"]["remaining"], 0)

    def test_http_excel_import_replaces_bank(self):
        login = self.request_json("/api/login", method="POST", data={"code": app_module.APP.config["control_pin"]})
        token = login["token"]
        xlsx = make_xlsx([
            ["ID", "Pregunta", "Respuesta", "Puntos"],
            ["N1", "Pregunta importada", "A", 55],
            ["N1", "Pregunta importada", "B", 45],
        ])
        imported = self.request_bytes("/api/import", xlsx, token, "prueba.xlsx")["data"]
        self.assertEqual(imported["imported_count"], 1)
        self.assertEqual(imported["questions"][0]["id"], "N1")
        public = self.request_json("/api/public/state")["data"]
        self.assertEqual(public["question"]["id"], "N1")
        self.assertEqual(public["answers"], [{"revealed": False}, {"revealed": False}])


if __name__ == "__main__":
    unittest.main()
