import re
from pathlib import Path

import app
from game_logic import default_state, set_question, start_round, set_control_team

ROOT = Path(__file__).resolve().parents[1]

def test_frontend_action_contract_matches_backend():
    js = (ROOT / "static" / "control.js").read_text(encoding="utf-8")
    actions = set(re.findall(r"apiAction\(['\"]([^'\"]+)", js))
    assert actions <= app.SUPPORTED_ACTIONS

def test_v8_version_is_exposed_in_control_payload():
    payload = app.APP.control_payload()
    assert payload["app_version"] == "8.0.0"
    assert "set_control_team" in payload["supported_actions"]

def test_faceoff_aliases_are_supported():
    for alias in ("faceoff_winner", "duel_winner", "choose_control_team", "set_family_control"):
        assert app.ACTION_ALIASES[alias] == "set_control_team"

def test_cannot_change_duel_winner_after_family_started():
    state = default_state()
    bank = [{"id":"Q","question":"Q","answers":[{"text":"A","points":10}]}]
    set_question(state, bank, "Q")
    start_round(state, bank)
    set_control_team(state, 0)
    try:
        set_control_team(state, 1)
    except ValueError as exc:
        assert "Deshacer" in str(exc)
    else:
        raise AssertionError("Debe impedir cambiar la familia en control sin deshacer")
