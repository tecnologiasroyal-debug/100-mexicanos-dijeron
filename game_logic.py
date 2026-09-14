from __future__ import annotations

import copy
import math
import re
import time
import unicodedata
from typing import Any, Dict, List

MAX_ANSWERS = 8
MAX_EVENTS = 40


def default_fast_money() -> Dict[str, Any]:
    return {
        "target": 200,
        "questions": [
            {
                "question": f"Pregunta {i + 1}",
                "p1": {"answer": "", "points": 0, "revealed": False},
                "p2": {"answer": "", "points": 0, "revealed": False},
            }
            for i in range(5)
        ],
    }


def default_state() -> Dict[str, Any]:
    return {
        "version": 1,
        "teams": [
            {"name": "Equipo 1", "score": 0},
            {"name": "Equipo 2", "score": 0},
        ],
        "screen_mode": "normal",
        "current_question_id": None,
        "multiplier": 1,
        "revealed": [],
        "round_points": 0,
        "errors": 0,
        "round_awarded": False,
        "round_phase": "ready",
        "control_team": None,
        "last_award": None,
        "timer": {
            "duration": 30,
            "remaining": 30,
            "running": False,
            "end_epoch": None,
        },
        "fast_money": default_fast_money(),
        "events": [],
        "next_event_id": 1,
    }


def sanitize_state(raw: Dict[str, Any] | None) -> Dict[str, Any]:
    base = default_state()
    if not isinstance(raw, dict):
        return base

    # Keep only known top-level keys and normalize sensitive/critical types.
    for key in base:
        if key in raw:
            base[key] = copy.deepcopy(raw[key])

    if not isinstance(base.get("teams"), list) or len(base["teams"]) != 2:
        base["teams"] = default_state()["teams"]
    for i, team in enumerate(base["teams"]):
        if not isinstance(team, dict):
            base["teams"][i] = {"name": f"Equipo {i+1}", "score": 0}
        else:
            team["name"] = str(team.get("name") or f"Equipo {i+1}")[:40]
            try:
                team["score"] = max(0, int(team.get("score", 0)))
            except Exception:
                team["score"] = 0

    base["screen_mode"] = "fast_money" if base.get("screen_mode") == "fast_money" else "normal"
    base["multiplier"] = int(base.get("multiplier", 1)) if str(base.get("multiplier", 1)).isdigit() else 1
    if base["multiplier"] not in (1, 2, 3):
        base["multiplier"] = 1
    base["revealed"] = sorted({int(x) for x in base.get("revealed", []) if str(x).isdigit() and 0 <= int(x) < MAX_ANSWERS})
    base["errors"] = min(3, max(0, int(base.get("errors", 0) or 0)))
    base["round_points"] = max(0, int(base.get("round_points", 0) or 0))
    base["round_awarded"] = bool(base.get("round_awarded", False))
    phase = str(base.get("round_phase", "review" if base["round_awarded"] else "ready"))
    base["round_phase"] = phase if phase in ("ready", "faceoff", "active", "review") else ("review" if base["round_awarded"] else "ready")
    control_team = base.get("control_team")
    try:
        control_team = int(control_team) if control_team is not None else None
    except Exception:
        control_team = None
    base["control_team"] = control_team if control_team in (0, 1) else None

    timer = base.get("timer") if isinstance(base.get("timer"), dict) else {}
    duration = max(1, min(3600, int(timer.get("duration", 30) or 30)))
    remaining = max(0, min(duration, int(math.ceil(float(timer.get("remaining", duration) or 0)))))
    running = bool(timer.get("running", False))
    end_epoch = timer.get("end_epoch") if running else None
    try:
        end_epoch = float(end_epoch) if end_epoch is not None else None
    except Exception:
        running = False
        end_epoch = None
    base["timer"] = {"duration": duration, "remaining": remaining, "running": running, "end_epoch": end_epoch}

    fm = base.get("fast_money") if isinstance(base.get("fast_money"), dict) else default_fast_money()
    target = max(1, min(9999, int(fm.get("target", 200) or 200)))
    questions = fm.get("questions") if isinstance(fm.get("questions"), list) else []
    normalized = []
    for i in range(5):
        item = questions[i] if i < len(questions) and isinstance(questions[i], dict) else {}
        row = {"question": str(item.get("question") or f"Pregunta {i+1}")[:200]}
        for p in ("p1", "p2"):
            pdata = item.get(p) if isinstance(item.get(p), dict) else {}
            try:
                points = max(0, min(999, int(pdata.get("points", 0) or 0)))
            except Exception:
                points = 0
            row[p] = {
                "answer": str(pdata.get("answer") or "")[:160],
                "points": points,
                "revealed": bool(pdata.get("revealed", False)),
            }
        normalized.append(row)
    base["fast_money"] = {"target": target, "questions": normalized}

    events = base.get("events") if isinstance(base.get("events"), list) else []
    base["events"] = [e for e in events[-MAX_EVENTS:] if isinstance(e, dict) and isinstance(e.get("id"), int)]
    max_event = max([e["id"] for e in base["events"]], default=0)
    try:
        base["next_event_id"] = max(max_event + 1, int(base.get("next_event_id", 1)))
    except Exception:
        base["next_event_id"] = max_event + 1
    return base


def normalize_answer(text: str) -> str:
    text = unicodedata.normalize("NFD", str(text or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def add_event(state: Dict[str, Any], event_type: str, **data: Any) -> Dict[str, Any]:
    event_id = int(state.get("next_event_id", 1))
    state["next_event_id"] = event_id + 1
    event = {"id": event_id, "type": event_type, "ts": time.time(), **data}
    state.setdefault("events", []).append(event)
    state["events"] = state["events"][-MAX_EVENTS:]
    return event


def get_question(bank: List[Dict[str, Any]], question_id: str | None) -> Dict[str, Any] | None:
    if question_id is None:
        return None
    for q in bank:
        if str(q.get("id")) == str(question_id):
            return q
    return None


def set_question(state: Dict[str, Any], bank: List[Dict[str, Any]], question_id: str) -> None:
    question = get_question(bank, question_id)
    if not question:
        raise ValueError("La pregunta seleccionada no existe.")
    state["current_question_id"] = str(question["id"])
    state["revealed"] = []
    state["round_points"] = 0
    state["errors"] = 0
    state["round_awarded"] = False
    state["round_phase"] = "ready"
    state["control_team"] = None
    state["last_award"] = None
    add_event(state, "question_changed", question_id=str(question["id"]))


def set_multiplier(state: Dict[str, Any], bank: List[Dict[str, Any]], multiplier: int) -> None:
    if state.get("round_phase") != "ready":
        raise ValueError("El multiplicador se define antes de iniciar el duelo. Reinicia la ronda si necesitas cambiarlo.")
    multiplier = int(multiplier)
    if multiplier not in (1, 2, 3):
        raise ValueError("El multiplicador debe ser 1, 2 o 3.")
    if state.get("round_awarded"):
        raise ValueError("La ronda ya fue entregada. Inicia otra pregunta para cambiar el multiplicador.")
    state["multiplier"] = multiplier
    recompute_round_points(state, bank)
    add_event(state, "multiplier", value=multiplier)


def recompute_round_points(state: Dict[str, Any], bank: List[Dict[str, Any]]) -> int:
    question = get_question(bank, state.get("current_question_id"))
    if not question:
        state["round_points"] = 0
        return 0
    raw = 0
    answers = question.get("answers", [])
    for idx in state.get("revealed", []):
        if 0 <= idx < len(answers):
            raw += int(answers[idx].get("points", 0))
    state["round_points"] = raw * int(state.get("multiplier", 1))
    return state["round_points"]


def start_round(state: Dict[str, Any], bank: List[Dict[str, Any]]) -> None:
    question = get_question(bank, state.get("current_question_id"))
    if not question:
        raise ValueError("Selecciona una pregunta primero.")
    if state.get("round_awarded") or state.get("round_phase") == "review":
        raise ValueError("La ronda ya terminó. Pasa a la siguiente pregunta.")
    if state.get("round_phase") in ("faceoff", "active"):
        raise ValueError("La ronda ya está en curso.")
    state["round_phase"] = "faceoff"
    state["control_team"] = None
    add_event(state, "round_start", question_id=str(question["id"]))


def set_control_team(state: Dict[str, Any], team_index: int) -> None:
    team_index = int(team_index)
    if team_index not in (0, 1):
        raise ValueError("Equipo no válido.")
    if state.get("round_awarded"):
        raise ValueError("La ronda ya fue entregada.")
    if state.get("round_phase") != "faceoff":
        if state.get("round_phase") == "active":
            raise ValueError("La familia que ganó el duelo ya fue elegida. Usa Deshacer para corregirla.")
        raise ValueError("Primero inicia el duelo de la ronda.")
    state["control_team"] = team_index
    state["round_phase"] = "active"
    add_event(state, "control_team", team=team_index)


def reveal_answer(state: Dict[str, Any], bank: List[Dict[str, Any]], index: int) -> int:
    if state.get("round_phase") not in ("faceoff", "active", "review"):
        raise ValueError("Primero inicia el duelo de la ronda.")
    question = get_question(bank, state.get("current_question_id"))
    if not question:
        raise ValueError("Selecciona una pregunta primero.")
    index = int(index)
    answers = question.get("answers", [])
    if not 0 <= index < len(answers):
        raise ValueError("La respuesta seleccionada no existe.")
    if index in state.get("revealed", []):
        return state.get("round_points", 0)
    state.setdefault("revealed", []).append(index)
    state["revealed"] = sorted(set(state["revealed"]))

    # Después de entregar la ronda permitimos descubrir las respuestas faltantes,
    # pero esos puntos ya no alteran la bolsa ni el marcador adjudicado.
    after_award = bool(state.get("round_awarded"))
    total = int(state.get("round_points", 0)) if after_award else recompute_round_points(state, bank)
    add_event(state, "reveal", index=index, after_award=after_award)
    return total


def add_strike(state: Dict[str, Any]) -> int:
    before = int(state.get("errors", 0))
    state["errors"] = min(3, before + 1)
    if state["errors"] != before:
        add_event(state, "strike", count=state["errors"])
    return state["errors"]


def clear_strikes(state: Dict[str, Any]) -> None:
    state["errors"] = 0
    add_event(state, "clear_strikes")


def award_round(state: Dict[str, Any], team_index: int, reason: str = "ronda") -> int:
    team_index = int(team_index)
    if team_index not in (0, 1):
        raise ValueError("Equipo no válido.")
    if state.get("round_awarded"):
        raise ValueError("Los puntos de esta ronda ya fueron entregados. Usa Deshacer si necesitas corregirlo.")
    points = int(state.get("round_points", 0))
    state["teams"][team_index]["score"] = max(0, int(state["teams"][team_index].get("score", 0)) + points)
    state["round_awarded"] = True
    state["round_phase"] = "review"
    state["last_award"] = {"team": team_index, "points": points, "reason": str(reason or "ronda")[:30]}
    add_event(state, "award", team=team_index, points=points, reason=str(reason or "ronda")[:30])
    return points


def set_team_name(state: Dict[str, Any], team_index: int, name: str) -> None:
    team_index = int(team_index)
    if team_index not in (0, 1):
        raise ValueError("Equipo no válido.")
    name = str(name or "").strip()
    if not name:
        raise ValueError("El nombre del equipo no puede quedar vacío.")
    state["teams"][team_index]["name"] = name[:40]
    add_event(state, "team_name", team=team_index)


def set_team_score(state: Dict[str, Any], team_index: int, score: int) -> None:
    team_index = int(team_index)
    if team_index not in (0, 1):
        raise ValueError("Equipo no válido.")
    score = max(0, int(score))
    state["teams"][team_index]["score"] = score
    add_event(state, "score_corrected", team=team_index, score=score)


def timer_remaining(state: Dict[str, Any], now: float | None = None) -> int:
    timer = state["timer"]
    if not timer.get("running"):
        return max(0, int(math.ceil(float(timer.get("remaining", 0)))))
    now = time.time() if now is None else now
    return max(0, int(math.ceil(float(timer.get("end_epoch", now)) - now)))


def refresh_timer(state: Dict[str, Any], now: float | None = None) -> bool:
    """Returns True only when the timer changes from running to expired."""
    if not state["timer"].get("running"):
        return False
    remaining = timer_remaining(state, now)
    if remaining <= 0:
        state["timer"]["running"] = False
        state["timer"]["remaining"] = 0
        state["timer"]["end_epoch"] = None
        add_event(state, "timer_timeout")
        return True
    return False


def configure_timer(state: Dict[str, Any], seconds: int) -> None:
    seconds = max(1, min(3600, int(seconds)))
    state["timer"] = {"duration": seconds, "remaining": seconds, "running": False, "end_epoch": None}
    add_event(state, "timer_config", seconds=seconds)


def start_timer(state: Dict[str, Any], now: float | None = None) -> None:
    now = time.time() if now is None else now
    remaining = timer_remaining(state, now)
    if remaining <= 0:
        remaining = int(state["timer"].get("duration", 30))
    state["timer"]["remaining"] = remaining
    state["timer"]["running"] = True
    state["timer"]["end_epoch"] = now + remaining
    add_event(state, "timer_start")


def pause_timer(state: Dict[str, Any], now: float | None = None) -> None:
    now = time.time() if now is None else now
    remaining = timer_remaining(state, now)
    state["timer"]["remaining"] = remaining
    state["timer"]["running"] = False
    state["timer"]["end_epoch"] = None
    add_event(state, "timer_pause")


def reset_timer(state: Dict[str, Any]) -> None:
    duration = int(state["timer"].get("duration", 30))
    state["timer"] = {"duration": duration, "remaining": duration, "running": False, "end_epoch": None}
    add_event(state, "timer_reset")


def set_screen_mode(state: Dict[str, Any], mode: str) -> None:
    if mode not in ("normal", "fast_money"):
        raise ValueError("Modo de pantalla no válido.")
    state["screen_mode"] = mode
    add_event(state, "screen_mode", mode=mode)


def update_fast_money(state: Dict[str, Any], payload: Dict[str, Any]) -> List[str]:
    fm = state["fast_money"]
    target = payload.get("target", fm.get("target", 200))
    try:
        fm["target"] = max(1, min(9999, int(target)))
    except Exception:
        raise ValueError("La meta de Dinero rápido debe ser un número entero.")

    rows = payload.get("questions")
    if not isinstance(rows, list) or len(rows) != 5:
        raise ValueError("Dinero rápido requiere exactamente cinco preguntas.")

    for i in range(5):
        row = rows[i] if isinstance(rows[i], dict) else {}
        fm_row = fm["questions"][i]
        fm_row["question"] = str(row.get("question") or f"Pregunta {i+1}")[:200]
        for p in ("p1", "p2"):
            incoming = row.get(p) if isinstance(row.get(p), dict) else {}
            fm_row[p]["answer"] = str(incoming.get("answer") or "")[:160]
            try:
                fm_row[p]["points"] = max(0, min(999, int(incoming.get("points", 0) or 0)))
            except Exception:
                raise ValueError(f"Puntaje inválido en pregunta {i+1}, participante {p[-1]}.")

    warnings = fast_money_duplicate_warnings(state)
    add_event(state, "fast_money_updated")
    return warnings


def fast_money_duplicate_warnings(state: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    rows = state["fast_money"]["questions"]

    # Same question: participant 2 repeats participant 1.
    for i, row in enumerate(rows):
        a1 = normalize_answer(row["p1"].get("answer", ""))
        a2 = normalize_answer(row["p2"].get("answer", ""))
        if a1 and a2 and a1 == a2:
            warnings.append(f"Pregunta {i+1}: el participante 2 repitió la respuesta del participante 1.")

    # Within each participant: repeated answer in two different questions.
    for p in ("p1", "p2"):
        seen: Dict[str, int] = {}
        for i, row in enumerate(rows):
            ans = normalize_answer(row[p].get("answer", ""))
            if not ans:
                continue
            if ans in seen:
                warnings.append(f"Participante {p[-1]}: respuesta repetida en preguntas {seen[ans]+1} y {i+1}.")
            else:
                seen[ans] = i
    return warnings


def fast_money_reveal(state: Dict[str, Any], participant: int, question_index: int) -> None:
    participant = int(participant)
    question_index = int(question_index)
    if participant not in (1, 2) or not 0 <= question_index < 5:
        raise ValueError("Revelado de Dinero rápido no válido.")
    key = f"p{participant}"
    state["fast_money"]["questions"][question_index][key]["revealed"] = True
    add_event(state, "fast_reveal", participant=participant, index=question_index)


def fast_money_hide_all(state: Dict[str, Any]) -> None:
    for row in state["fast_money"]["questions"]:
        row["p1"]["revealed"] = False
        row["p2"]["revealed"] = False
    add_event(state, "fast_hide_all")


def fast_money_totals(state: Dict[str, Any], revealed_only: bool = False) -> Dict[str, int]:
    p1 = p2 = 0
    for row in state["fast_money"]["questions"]:
        if (not revealed_only) or row["p1"].get("revealed"):
            p1 += int(row["p1"].get("points", 0))
        if (not revealed_only) or row["p2"].get("revealed"):
            p2 += int(row["p2"].get("points", 0))
    return {"p1": p1, "p2": p2, "combined": p1 + p2}


def public_state(state: Dict[str, Any], bank: List[Dict[str, Any]], now: float | None = None) -> Dict[str, Any]:
    question = get_question(bank, state.get("current_question_id"))
    answers_public: List[Dict[str, Any]] = []
    if question:
        for idx, ans in enumerate(question.get("answers", [])):
            if idx in state.get("revealed", []):
                answers_public.append({"revealed": True, "text": str(ans.get("text", "")), "points": int(ans.get("points", 0))})
            else:
                answers_public.append({"revealed": False})

    fm_rows = []
    for row in state["fast_money"]["questions"]:
        pub = {"question": row["question"]}
        for p in ("p1", "p2"):
            pdata = row[p]
            pub[p] = (
                {"revealed": True, "answer": pdata["answer"], "points": int(pdata["points"])}
                if pdata.get("revealed")
                else {"revealed": False}
            )
        fm_rows.append(pub)

    timer = copy.deepcopy(state["timer"])
    timer["remaining"] = timer_remaining(state, now)
    timer.pop("end_epoch", None)

    return {
        "teams": copy.deepcopy(state["teams"]),
        "screen_mode": state["screen_mode"],
        "question": None if not question else {"id": str(question["id"]), "text": str(question["question"]), "answer_count": len(question.get("answers", []))},
        "answers": answers_public,
        "multiplier": int(state["multiplier"]),
        "round_points": int(state["round_points"]),
        "errors": int(state["errors"]),
        "round_awarded": bool(state["round_awarded"]),
        "round_phase": str(state.get("round_phase", "ready")),
        "control_team": state.get("control_team"),
        "timer": timer,
        "fast_money": {
            "target": int(state["fast_money"]["target"]),
            "questions": fm_rows,
            "totals": fast_money_totals(state, revealed_only=True),
        },
        "events": copy.deepcopy(state.get("events", [])),
    }
