from __future__ import annotations

import copy
import json
import mimetypes
import os
import secrets
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Tuple

from game_logic import (
    add_event,
    add_strike,
    award_round,
    clear_strikes,
    configure_timer,
    default_state,
    fast_money_duplicate_warnings,
    fast_money_hide_all,
    fast_money_reveal,
    fast_money_totals,
    pause_timer,
    public_state,
    recompute_round_points,
    refresh_timer,
    reset_timer,
    reveal_answer,
    sanitize_state,
    set_multiplier,
    set_question,
    set_screen_mode,
    set_team_name,
    set_team_score,
    start_timer,
    start_round,
    update_fast_money,
)

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_DIR / "data"
DEMO_FILE = DATA_DIR / "demo_questions.json"
BANK_FILE = DATA_DIR / "question_bank.json"
STATE_FILE = DATA_DIR / "game_state.json"
CONFIG_FILE = DATA_DIR / "config.json"
USAGE_FILE = DATA_DIR / "question_usage.json"
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", os.environ.get("CIEN_MEXICANOS_PORT", "8765")))
HOSTED = bool(os.environ.get("RENDER") or os.environ.get("RENDER_EXTERNAL_HOSTNAME"))
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


class UserError(Exception):
    pass


def atomic_json_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return copy.deepcopy(fallback)


def local_ip() -> str:
    # No internet request is made. UDP connect is only used to ask the OS which LAN interface it would use.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    finally:
        s.close()

    try:
        candidates = socket.gethostbyname_ex(socket.gethostname())[2]
        for ip in candidates:
            if not ip.startswith("127."):
                return ip
    except Exception:
        pass
    return "127.0.0.1"


def load_or_create_config() -> Dict[str, Any]:
    cfg = load_json(CONFIG_FILE, {})
    env_pin = str(os.environ.get("CONTROL_PIN", "")).strip()
    pin = env_pin or str(cfg.get("control_pin", ""))
    if len(pin) != 6 or not pin.isdigit():
        pin = f"{secrets.randbelow(1_000_000):06d}"
    cfg = {"control_pin": pin}
    atomic_json_write(CONFIG_FILE, cfg)
    return cfg


def load_usage() -> Dict[str, str]:
    raw = load_json(USAGE_FILE, {"used": {}})
    used = raw.get("used", {}) if isinstance(raw, dict) else {}
    if not isinstance(used, dict):
        used = {}
    return {str(k): str(v) for k, v in used.items() if str(k).strip()}


def usage_warning(remaining: int, total: int) -> str:
    if total <= 0:
        return "No hay preguntas cargadas."
    if remaining <= 0:
        return "Ya no quedan preguntas sin usar. Puedes cargar más o reiniciar el historial."
    if remaining <= 10:
        return f"ATENCIÓN: solo quedan {remaining} preguntas sin usar."
    if remaining <= 25:
        return f"Quedan {remaining} preguntas sin usar."
    if remaining <= 50:
        return f"Quedan {remaining} preguntas disponibles; conviene preparar un banco nuevo pronto."
    return ""


def validate_bank(bank: Any) -> List[Dict[str, Any]]:
    if not isinstance(bank, list):
        raise ValueError("Banco de preguntas inválido.")
    clean: List[Dict[str, Any]] = []
    ids = set()
    for raw in bank:
        if not isinstance(raw, dict):
            continue
        qid = str(raw.get("id", "")).strip()
        text = str(raw.get("question", "")).strip()
        answers = raw.get("answers", [])
        if not qid or not text or qid in ids or not isinstance(answers, list) or not (1 <= len(answers) <= 8):
            continue
        clean_answers = []
        for ans in answers:
            if not isinstance(ans, dict) or not str(ans.get("text", "")).strip():
                continue
            try:
                pts = max(0, int(ans.get("points", 0)))
            except Exception:
                pts = 0
            clean_answers.append({"text": str(ans["text"]).strip()[:200], "points": pts})
        if not clean_answers:
            continue
        clean.append({"id": qid[:80], "question": text[:300], "answers": clean_answers[:8], "example": bool(raw.get("example", False))})
        ids.add(qid)
    if not clean:
        raise ValueError("No hay preguntas válidas en el banco.")
    return clean


class GameApp:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.config = load_or_create_config()
        demo = validate_bank(load_json(DEMO_FILE, []))
        try:
            self.bank = validate_bank(load_json(BANK_FILE, demo))
        except Exception:
            self.bank = demo
        self.state = sanitize_state(load_json(STATE_FILE, default_state()))
        self.usage = load_usage()
        if not any(str(q["id"]) == str(self.state.get("current_question_id")) for q in self.bank):
            self.state["current_question_id"] = str(self.bank[0]["id"])
            self.state["revealed"] = []
            self.state["round_points"] = 0
            self.state["round_awarded"] = False
        if not self.state.get("round_awarded"):
            recompute_round_points(self.state, self.bank)
        self.history: deque[Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, str]]] = deque(maxlen=60)
        self.session_token = secrets.token_urlsafe(32)
        self.save_all()

    def save_all(self) -> None:
        atomic_json_write(BANK_FILE, self.bank)
        atomic_json_write(STATE_FILE, self.state)
        atomic_json_write(USAGE_FILE, {"used": self.usage})

    def snapshot(self) -> None:
        self.history.append((copy.deepcopy(self.state), copy.deepcopy(self.bank), copy.deepcopy(self.usage)))

    def undo(self) -> None:
        if not self.history:
            raise UserError("No hay acciones para deshacer.")
        current_next_id = int(self.state.get("next_event_id", 1))
        state, bank, usage = self.history.pop()
        self.state = sanitize_state(state)
        self.bank = validate_bank(bank)
        self.usage = {str(k): str(v) for k, v in usage.items()}
        self.state["next_event_id"] = max(current_next_id, int(self.state.get("next_event_id", 1)))
        add_event(self.state, "undo")
        self.save_all()

    def refresh_timer_if_needed(self) -> None:
        if refresh_timer(self.state):
            self.save_all()

    def control_payload(self) -> Dict[str, Any]:
        self.refresh_timer_if_needed()
        questions = copy.deepcopy(self.bank)
        bank_ids = {str(q.get("id")) for q in questions}
        used_ids = {qid for qid in self.usage if qid in bank_ids}
        for q in questions:
            qid = str(q.get("id"))
            q["used"] = qid in used_ids
            q["used_at"] = self.usage.get(qid)
        remaining = max(0, len(questions) - len(used_ids))
        return {
            "state": copy.deepcopy(self.state),
            "questions": questions,
            "undo_available": bool(self.history),
            "fast_money_warnings": fast_money_duplicate_warnings(self.state),
            "fast_money_totals": fast_money_totals(self.state, revealed_only=False),
            "question_usage": {
                "total": len(questions),
                "used": len(used_ids),
                "remaining": remaining,
                "warning": usage_warning(remaining, len(questions)),
            },
        }

    def public_payload(self) -> Dict[str, Any]:
        self.refresh_timer_if_needed()
        return public_state(self.state, self.bank)

    def _reset_round(self) -> None:
        self.state["revealed"] = []
        self.state["round_points"] = 0
        self.state["errors"] = 0
        self.state["round_awarded"] = False
        self.state["round_phase"] = "ready"
        self.state["last_award"] = None
        add_event(self.state, "round_reset")

    def mark_current_question_used(self) -> None:
        qid = str(self.state.get("current_question_id") or "")
        if qid and qid not in self.usage:
            self.usage[qid] = time.strftime("%Y-%m-%dT%H:%M:%S")

    def next_unused_question_id(self) -> str:
        if not self.bank:
            raise UserError("No hay preguntas cargadas.")
        current = str(self.state.get("current_question_id") or "")
        ids = [str(q.get("id")) for q in self.bank]
        start = ids.index(current) + 1 if current in ids else 0
        ordered = ids[start:] + ids[:start]
        for qid in ordered:
            if qid not in self.usage:
                return qid
        raise UserError("Ya no quedan preguntas sin usar. Reinicia el historial o carga un banco nuevo.")

    def action(self, action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            if action == "undo":
                self.undo()
                return self.control_payload()

            self.snapshot()
            try:
                if action == "set_question":
                    qid = str(payload.get("question_id", ""))
                    if qid in self.usage and qid != str(self.state.get("current_question_id") or ""):
                        raise UserError("Esa pregunta ya fue usada. Elige una disponible o reinicia el historial.")
                    set_question(self.state, self.bank, qid)
                elif action == "start_round":
                    start_round(self.state, self.bank)
                    self.mark_current_question_used()
                elif action == "next_question":
                    set_question(self.state, self.bank, self.next_unused_question_id())
                elif action == "set_multiplier":
                    set_multiplier(self.state, self.bank, int(payload.get("multiplier", 1)))
                elif action == "reveal":
                    reveal_answer(self.state, self.bank, int(payload.get("index", -1)))
                elif action == "strike":
                    add_strike(self.state)
                elif action == "clear_strikes":
                    clear_strikes(self.state)
                elif action == "award":
                    award_round(self.state, int(payload.get("team", -1)), str(payload.get("reason", "ronda")))
                elif action == "team_name":
                    set_team_name(self.state, int(payload.get("team", -1)), str(payload.get("name", "")))
                elif action == "score":
                    set_team_score(self.state, int(payload.get("team", -1)), int(payload.get("score", 0)))
                elif action == "timer_config":
                    configure_timer(self.state, int(payload.get("seconds", 30)))
                elif action == "timer_start":
                    start_timer(self.state)
                elif action == "timer_pause":
                    pause_timer(self.state)
                elif action == "timer_reset":
                    reset_timer(self.state)
                elif action == "screen_mode":
                    set_screen_mode(self.state, str(payload.get("mode", "normal")))
                elif action == "fast_update":
                    warnings = update_fast_money(self.state, payload)
                    self.save_all()
                    result = self.control_payload()
                    result["fast_money_warnings"] = warnings
                    return result
                elif action == "fast_reveal":
                    fast_money_reveal(self.state, int(payload.get("participant", 1)), int(payload.get("index", -1)))
                elif action == "fast_hide_all":
                    fast_money_hide_all(self.state)
                elif action == "round_reset":
                    self._reset_round()
                elif action == "reset_usage":
                    self.usage = {}
                    add_event(self.state, "usage_reset")
                elif action == "new_game":
                    current_bank = self.bank
                    next_event_id = int(self.state.get("next_event_id", 1))
                    old_current = str(self.state.get("current_question_id") or "")
                    self.state = default_state()
                    self.state["next_event_id"] = next_event_id
                    available = [str(q["id"]) for q in current_bank if str(q["id"]) not in self.usage]
                    self.state["current_question_id"] = available[0] if available else (old_current or str(current_bank[0]["id"]))
                    add_event(self.state, "new_game")
                elif action == "restore_demo":
                    demo = validate_bank(load_json(DEMO_FILE, []))
                    self.bank = demo
                    self.usage = {}
                    self.state["current_question_id"] = str(demo[0]["id"])
                    self._reset_round()
                    add_event(self.state, "bank_restored")
                else:
                    raise UserError("Acción no reconocida.")
            except Exception:
                # Failed actions must not pollute Undo history.
                self.history.pop()
                raise

            self.save_all()
            return self.control_payload()

    def import_xlsx(self, data: bytes) -> Dict[str, Any]:
        if len(data) > MAX_UPLOAD_BYTES:
            raise UserError("El archivo supera el límite de 8 MB.")
        try:
            from excel_import import parse_question_xlsx
        except ImportError as exc:
            raise UserError("No se pudo cargar el importador de Excel incluido con el juego.") from exc

        questions, errors = parse_question_xlsx(data)
        if errors:
            raise UserError("\n".join(errors[:30]))
        questions = validate_bank(questions)
        with self.lock:
            self.snapshot()
            self.bank = questions
            self.usage = {qid: ts for qid, ts in self.usage.items() if qid in {str(q["id"]) for q in questions}}
            self.state["current_question_id"] = str(questions[0]["id"])
            self._reset_round()
            add_event(self.state, "bank_imported", count=len(questions))
            self.save_all()
            result = self.control_payload()
            result["imported_count"] = len(questions)
            return result


APP = GameApp()


def json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "100MexicanosLocal/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep terminal useful without flooding on state polling.
        if not self.path.startswith("/api/public/state") and not self.path.startswith("/api/control/state"):
            super().log_message(fmt, *args)

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8", extra_headers: Dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: Any) -> None:
        self._send(status, json_bytes(data))

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"ok": False, "error": message})

    def _read_json(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except Exception:
            raise UserError("Solicitud inválida.")
        if length > 1024 * 1024:
            raise UserError("Solicitud demasiado grande.")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            raise UserError("JSON inválido.")
        if not isinstance(data, dict):
            raise UserError("Solicitud inválida.")
        return data

    def _authorized(self) -> bool:
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {APP.session_token}"

    def _is_localhost(self) -> bool:
        ip = self.client_address[0]
        return ip in ("127.0.0.1", "::1") or ip.startswith("127.")

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        if path == "/api/public/state":
            with APP.lock:
                return self._json(200, {"ok": True, "data": APP.public_payload()})
        if path == "/api/control/state":
            if not self._authorized():
                return self._error(401, "Control no autorizado.")
            with APP.lock:
                return self._json(200, {"ok": True, "data": APP.control_payload()})
        if path == "/api/setup":
            query = urllib.parse.parse_qs(parsed.query)
            supplied = (query.get("code") or [""])[0]
            pin = str(APP.config["control_pin"])
            if HOSTED:
                if not secrets.compare_digest(supplied, pin):
                    return self._error(401, "Código de configuración incorrecto.")
                proto = self.headers.get("X-Forwarded-Proto", "https")
                host = self.headers.get("Host", "")
                base = f"{proto}://{host}"
                control_url = f"{base}/control?code={pin}"
                public_url = f"{base}/public"
                return self._json(200, {"ok": True, "data": {"ip": host, "port": PORT, "pin": pin, "control_url": control_url, "public_url": public_url}})
            if not self._is_localhost():
                return self._error(403, "La página de configuración solo se muestra en la computadora anfitriona.")
            ip = local_ip()
            control_url = f"http://{ip}:{PORT}/control?code={pin}"
            public_url = f"http://{ip}:{PORT}/public"
            return self._json(200, {"ok": True, "data": {"ip": ip, "port": PORT, "pin": pin, "control_url": control_url, "public_url": public_url}})
        if path == "/api/qr":
            query = urllib.parse.parse_qs(parsed.query)
            data = (query.get("data") or [""])[0][:500]
            if not data:
                return self._error(400, "Falta el contenido del QR.")
            try:
                import qrcode
                from qrcode.image.svg import SvgPathImage

                qr = qrcode.QRCode(version=None, box_size=8, border=3)
                qr.add_data(data)
                qr.make(fit=True)
                img = qr.make_image(image_factory=SvgPathImage)
                body = img.to_string(encoding="utf-8")
                return self._send(200, body, "image/svg+xml; charset=utf-8", {"Cache-Control": "no-cache"})
            except ImportError:
                return self._error(500, "No se pudo cargar el generador QR incluido con el juego.")

        if path == "/":
            return self._redirect("/public") if HOSTED else self._serve_static("setup.html")
        if path == "/setup":
            if HOSTED:
                query = urllib.parse.parse_qs(parsed.query)
                supplied = (query.get("code") or [""])[0]
                if not secrets.compare_digest(supplied, str(APP.config["control_pin"])):
                    return self._error(401, "Abre /setup?code=TU_CODIGO_DE_6_DIGITOS")
                return self._serve_static("setup.html")
            if not self._is_localhost():
                return self._redirect("/public")
            return self._serve_static("setup.html")
        if path == "/public":
            return self._serve_static("public.html")
        if path == "/control":
            return self._serve_static("control.html")
        if path.startswith("/static/"):
            return self._serve_static(path[len("/static/"):])
        self._error(404, "No encontrado.")

    def _redirect(self, location: str) -> None:
        body = b""
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _serve_static(self, relative: str) -> None:
        try:
            target = (STATIC_DIR / relative).resolve()
            static_resolved = STATIC_DIR.resolve()
            if static_resolved not in target.parents and target != static_resolved:
                return self._error(403, "Ruta no permitida.")
            if not target.is_file():
                return self._error(404, "Archivo no encontrado.")
            body = target.read_bytes()
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            self._send(200, body, ctype, {"Cache-Control": "no-cache"})
        except Exception as exc:
            self._error(500, f"Error al servir archivo: {exc}")

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/login":
                data = self._read_json()
                if secrets.compare_digest(str(data.get("code", "")), str(APP.config["control_pin"])):
                    return self._json(200, {"ok": True, "token": APP.session_token})
                return self._error(401, "Código de control incorrecto.")

            if path == "/api/action":
                if not self._authorized():
                    return self._error(401, "Control no autorizado.")
                data = self._read_json()
                action = str(data.get("action", ""))
                payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
                result = APP.action(action, payload)
                return self._json(200, {"ok": True, "data": result})

            if path == "/api/import":
                if not self._authorized():
                    return self._error(401, "Control no autorizado.")
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except Exception:
                    raise UserError("Tamaño de archivo inválido.")
                if length <= 0:
                    raise UserError("Selecciona un archivo .xlsx.")
                if length > MAX_UPLOAD_BYTES:
                    raise UserError("El archivo supera el límite de 8 MB.")
                filename = urllib.parse.unquote(self.headers.get("X-Filename", ""))
                if filename and not filename.lower().endswith(".xlsx"):
                    raise UserError("El archivo debe tener extensión .xlsx.")
                raw = self.rfile.read(length)
                result = APP.import_xlsx(raw)
                return self._json(200, {"ok": True, "data": result})

            return self._error(404, "No encontrado.")
        except UserError as exc:
            return self._error(400, str(exc))
        except ValueError as exc:
            return self._error(400, str(exc))
        except Exception as exc:
            print("ERROR:", repr(exc), file=sys.stderr)
            return self._error(500, f"Error interno: {exc}")


def main() -> None:
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        print(f"No se pudo iniciar el servidor en el puerto {PORT}: {exc}")
        print("Cierra otra copia del juego o cambia el puerto con la variable CIEN_MEXICANOS_PORT.")
        if not HOSTED:
            input("Presiona Enter para cerrar...")
        return

    ip = local_ip()
    print("=" * 66)
    print("100 MEXICANOS DIJERON — SERVIDOR LOCAL")
    print("=" * 66)
    print(f"Configuración local: http://localhost:{PORT}/setup")
    print(f"Tablero público:    http://{ip}:{PORT}/public")
    print(f"Control celular:    http://{ip}:{PORT}/control")
    print(f"Código de control:  {APP.config['control_pin']}")
    print("\nMantén esta ventana abierta durante el juego.")
    print("Para detener el servidor, presiona Ctrl+C.")
    print("=" * 66)

    def open_setup() -> None:
        time.sleep(0.7)
        try:
            webbrowser.open(f"http://localhost:{PORT}/setup")
        except Exception:
            pass

    if not HOSTED:
        threading.Thread(target=open_setup, daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
