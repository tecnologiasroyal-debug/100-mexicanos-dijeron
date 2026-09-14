from pathlib import Path

import app
from game_logic import default_state, scheduled_multiplier

ROOT = Path(__file__).resolve().parents[1]


def test_classic_multiplier_schedule():
    assert [scheduled_multiplier(i) for i in range(1, 7)] == [1, 1, 1, 2, 3, 3]


def test_faceoff_miss_does_not_increment_strikes():
    with app.APP.lock:
        original_state = app.copy.deepcopy(app.APP.state)
        original_bank = app.copy.deepcopy(app.APP.bank)
        original_usage = app.copy.deepcopy(app.APP.usage)
        original_history = app.copy.deepcopy(app.APP.history)
        try:
            app.APP.state = default_state()
            app.APP.state["current_question_id"] = str(app.APP.bank[0]["id"])
            app.start_round(app.APP.state, app.APP.bank)
            before = app.APP.state["errors"]
            app.APP.action("faceoff_miss", {})
            assert app.APP.state["errors"] == before
            assert app.APP.state["events"][-1]["type"] == "faceoff_miss"
        finally:
            app.APP.state = original_state
            app.APP.bank = original_bank
            app.APP.usage = original_usage
            app.APP.history = original_history
            app.APP.save_all()


def test_public_has_miss_overlay_and_double_label():
    html = (ROOT / "static" / "public.html").read_text(encoding="utf-8")
    js = (ROOT / "static" / "public.js").read_text(encoding="utf-8")
    assert 'id="missOverlay"' in html
    assert 'id="multiplierLabel"' in html
    assert "faceoff_miss" in js
    assert "PUNTOS AL DOBLE" in js


def test_control_has_faceoff_miss_and_auto_schedule():
    html = (ROOT / "static" / "control.html").read_text(encoding="utf-8")
    js = (ROOT / "static" / "control.js").read_text(encoding="utf-8")
    assert 'id="faceoffMissBtn"' in html
    assert 'id="roundScheduleBadge"' in html
    assert "faceoff_miss" in js
    assert "PUNTOS AL DOBLE" in js
