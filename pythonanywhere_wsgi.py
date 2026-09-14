from __future__ import annotations

import json
import mimetypes
import secrets
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

# IMPORTANT:
# In the PythonAnywhere WSGI configuration file, set CONTROL_PIN before
# importing this module, for example:
#   os.environ['CONTROL_PIN'] = '482731'

from app import APP, APP_VERSION, MAX_UPLOAD_BYTES, STATIC_DIR, SUPPORTED_ACTIONS, UserError


def _json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _response(start_response, status_code: int, body: bytes = b"", content_type: str = "application/json; charset=utf-8", extra_headers: Dict[str, str] | None = None):
    status_text = {
        200: "OK", 204: "No Content", 302: "Found", 400: "Bad Request",
        401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error",
    }.get(status_code, "OK")
    headers = [
        ("Content-Type", content_type),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
    ]
    if extra_headers:
        headers.extend((k, v) for k, v in extra_headers.items())
    start_response(f"{status_code} {status_text}", headers)
    return [body]


def _json(start_response, status_code: int, data: Any):
    return _response(start_response, status_code, _json_bytes(data))


def _error(start_response, status_code: int, message: str):
    return _json(start_response, status_code, {"ok": False, "error": message})


def _redirect(start_response, location: str):
    return _response(start_response, 302, b"", "text/plain; charset=utf-8", {"Location": location})


def _authorized(environ: Dict[str, Any]) -> bool:
    return environ.get("HTTP_AUTHORIZATION", "") == f"Bearer {APP.session_token}"


def _read_body(environ: Dict[str, Any], max_bytes: int) -> bytes:
    try:
        length = int(environ.get("CONTENT_LENGTH") or "0")
    except Exception:
        raise UserError("Tamaño de solicitud inválido.")
    if length < 0 or length > max_bytes:
        raise UserError("Solicitud demasiado grande.")
    return environ["wsgi.input"].read(length) if length else b""


def _read_json(environ: Dict[str, Any]) -> Dict[str, Any]:
    raw = _read_body(environ, 1024 * 1024) or b"{}"
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        raise UserError("JSON inválido.")
    if not isinstance(data, dict):
        raise UserError("Solicitud inválida.")
    return data


def _serve_static(start_response, relative: str):
    try:
        target = (STATIC_DIR / relative).resolve()
        static_resolved = STATIC_DIR.resolve()
        if static_resolved not in target.parents and target != static_resolved:
            return _error(start_response, 403, "Ruta no permitida.")
        if not target.is_file():
            return _error(start_response, 404, "Archivo no encontrado.")
        body = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        return _response(start_response, 200, body, ctype, {"Cache-Control": "no-cache"})
    except Exception as exc:
        return _error(start_response, 500, f"Error al servir archivo: {exc}")


def _base_url(environ: Dict[str, Any]) -> str:
    scheme = environ.get("HTTP_X_FORWARDED_PROTO") or environ.get("wsgi.url_scheme") or "https"
    host = environ.get("HTTP_HOST") or environ.get("SERVER_NAME") or ""
    return f"{scheme}://{host}".rstrip("/")


def application(environ: Dict[str, Any], start_response):
    method = (environ.get("REQUEST_METHOD") or "GET").upper()
    path = environ.get("PATH_INFO") or "/"
    query = urllib.parse.parse_qs(environ.get("QUERY_STRING") or "")

    try:
        if method == "GET":
            if path == "/favicon.ico":
                return _response(start_response, 204, b"", "image/x-icon")

            if path == "/api/version":
                return _json(start_response, 200, {"ok": True, "data": {"app_version": APP_VERSION, "supported_actions": sorted(SUPPORTED_ACTIONS)}})

            if path == "/api/public/state":
                with APP.lock:
                    return _json(start_response, 200, {"ok": True, "data": APP.public_payload()})

            if path == "/api/control/state":
                if not _authorized(environ):
                    return _error(start_response, 401, "Control no autorizado.")
                with APP.lock:
                    return _json(start_response, 200, {"ok": True, "data": APP.control_payload()})

            if path == "/api/setup":
                supplied = (query.get("code") or [""])[0]
                pin = str(APP.config["control_pin"])
                if not secrets.compare_digest(supplied, pin):
                    return _error(start_response, 401, "Código de configuración incorrecto.")
                base = _base_url(environ)
                return _json(start_response, 200, {
                    "ok": True,
                    "data": {
                        "ip": environ.get("HTTP_HOST", ""),
                        "port": 443,
                        "pin": pin,
                        "control_url": f"{base}/control?code={pin}",
                        "public_url": f"{base}/public",
                    },
                })

            if path == "/api/qr":
                data = (query.get("data") or [""])[0][:500]
                if not data:
                    return _error(start_response, 400, "Falta el contenido del QR.")
                try:
                    import qrcode
                    from qrcode.image.svg import SvgPathImage
                    qr = qrcode.QRCode(version=None, box_size=8, border=3)
                    qr.add_data(data)
                    qr.make(fit=True)
                    img = qr.make_image(image_factory=SvgPathImage)
                    body = img.to_string(encoding="utf-8")
                    return _response(start_response, 200, body, "image/svg+xml; charset=utf-8", {"Cache-Control": "no-cache"})
                except Exception as exc:
                    return _error(start_response, 500, f"No se pudo generar el QR: {exc}")

            if path == "/":
                return _redirect(start_response, "/public")
            if path == "/setup":
                supplied = (query.get("code") or [""])[0]
                if not secrets.compare_digest(supplied, str(APP.config["control_pin"])):
                    return _error(start_response, 401, "Abre /setup?code=TU_CODIGO_DE_6_DIGITOS")
                return _serve_static(start_response, "setup.html")
            if path == "/public":
                return _serve_static(start_response, "public.html")
            if path == "/control":
                return _serve_static(start_response, "control.html")
            if path.startswith("/static/"):
                return _serve_static(start_response, path[len("/static/"):])
            return _error(start_response, 404, "No encontrado.")

        if method == "POST":
            if path == "/api/login":
                data = _read_json(environ)
                if secrets.compare_digest(str(data.get("code", "")), str(APP.config["control_pin"])):
                    return _json(start_response, 200, {"ok": True, "token": APP.session_token})
                return _error(start_response, 401, "Código de control incorrecto.")

            if path == "/api/action":
                if not _authorized(environ):
                    return _error(start_response, 401, "Control no autorizado.")
                data = _read_json(environ)
                action = str(data.get("action", ""))
                payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
                result = APP.action(action, payload)
                return _json(start_response, 200, {"ok": True, "data": result})

            if path == "/api/import":
                if not _authorized(environ):
                    return _error(start_response, 401, "Control no autorizado.")
                raw = _read_body(environ, MAX_UPLOAD_BYTES)
                if not raw:
                    raise UserError("Selecciona un archivo .xlsx.")
                filename = urllib.parse.unquote(environ.get("HTTP_X_FILENAME", ""))
                if filename and not filename.lower().endswith(".xlsx"):
                    raise UserError("El archivo debe tener extensión .xlsx.")
                result = APP.import_xlsx(raw)
                return _json(start_response, 200, {"ok": True, "data": result})

            return _error(start_response, 404, "No encontrado.")

        return _error(start_response, 404, "No encontrado.")

    except (UserError, ValueError) as exc:
        return _error(start_response, 400, str(exc))
    except Exception as exc:
        print("WSGI ERROR:", repr(exc), file=sys.stderr)
        return _error(start_response, 500, f"Error interno: {exc}")
