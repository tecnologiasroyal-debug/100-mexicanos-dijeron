import copy
import unittest

from game_logic import (
    award_round,
    configure_timer,
    default_state,
    fast_money_duplicate_warnings,
    pause_timer,
    recompute_round_points,
    refresh_timer,
    reveal_answer,
    set_multiplier,
    set_question,
    start_timer,
    timer_remaining,
)

BANK = [
    {
        "id": "T1",
        "question": "Pregunta de prueba",
        "answers": [
            {"text": "Uno", "points": 30},
            {"text": "Dos", "points": 20},
            {"text": "Tres", "points": 10},
        ],
        "example": True,
    }
]


class GameLogicTests(unittest.TestCase):
    def setUp(self):
        self.state = default_state()
        set_question(self.state, BANK, "T1")

    def test_scoring_and_multiplier(self):
        reveal_answer(self.state, BANK, 0)
        reveal_answer(self.state, BANK, 1)
        self.assertEqual(self.state["round_points"], 50)
        set_multiplier(self.state, BANK, 2)
        self.assertEqual(self.state["round_points"], 100)
        set_multiplier(self.state, BANK, 3)
        self.assertEqual(self.state["round_points"], 150)

    def test_award_can_only_happen_once(self):
        reveal_answer(self.state, BANK, 0)
        set_multiplier(self.state, BANK, 2)
        points = award_round(self.state, 0, "ronda")
        self.assertEqual(points, 60)
        self.assertEqual(self.state["teams"][0]["score"], 60)
        with self.assertRaises(ValueError):
            award_round(self.state, 1, "robo")
        self.assertEqual(self.state["teams"][1]["score"], 0)

    def test_timer_start_pause_and_timeout(self):
        configure_timer(self.state, 10)
        start_timer(self.state, now=100.0)
        self.assertEqual(timer_remaining(self.state, now=103.2), 7)
        pause_timer(self.state, now=103.2)
        self.assertEqual(self.state["timer"]["remaining"], 7)
        start_timer(self.state, now=200.0)
        self.assertFalse(refresh_timer(self.state, now=206.0))
        self.assertTrue(refresh_timer(self.state, now=207.1))
        self.assertEqual(self.state["timer"]["remaining"], 0)
        self.assertFalse(self.state["timer"]["running"])

    def test_fast_money_duplicate_warning(self):
        self.state["fast_money"]["questions"][0]["p1"]["answer"] = "La playa"
        self.state["fast_money"]["questions"][0]["p2"]["answer"] = "la playa"
        warnings = fast_money_duplicate_warnings(self.state)
        self.assertTrue(any("repitió" in w for w in warnings))


if __name__ == "__main__":
    unittest.main()
