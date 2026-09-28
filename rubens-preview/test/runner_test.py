"""The job runner in rubens.py, against a fake board — no bridge, no machine.

    cd rubens-preview && python3 -m unittest discover -s test -p '*_test.py'
"""
import json
import os
import sys
import tempfile
import time
import unittest
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from rubens import STEPS_PER_MM, Park, Runner, block_end, in_english, parse_ping, piece_at, rest_of  # noqa: E402


class FakeBoard:
    """Answers like the draft firmware behind the bridge. Time passes only in
    sleep(): a running path eats `rate` pieces per 0.2 s."""

    def __init__(self, zero=True, rate=3, edge_on=None, paths=True, stuck_x=False):
        self.log, self.queue, self.running = [], [], False
        self.zero, self.rate, self.edge_on, self.paths = zero, rate, edge_on, paths
        self.stuck_x = stuck_x                 # X does not move: the path ends early
        self.max_queue, self.on_sleep = 0, None
        self.x, self.y = 800, 267
        self.goal = None                       # where the queued pieces end, steps

    def send(self, path):
        u = urlparse(path)
        q = parse_qs(u.query)
        if u.path == "/ping":
            xy = f"X {self.x} Y {self.y}" if self.zero else "X ? Y ?"
            return f"ok P {xy}" + (f" путь {len(self.queue)}" if self.running else "")
        if u.path in ("/origin/x", "/origin/y"):
            a, at = u.path[-1].upper(), int(q["at"][0])
            self.log.append(f"O {a} {at}")
            setattr(self, a.lower(), at)
            self.zero = True                   # the fake keeps one flag for both axes
            return f"ok O {a} {at}"
        if u.path == "/servo":
            self.log.append(f"J 3 {q['d'][0]}")
            return f"ok J 3 {q['d'][0]}"
        if u.path == "/cmd":
            a = q["a"][0]
            self.log.append(a)
            if a == "S" and self.running and self.queue and self.queue[0][0] == "L":
                # braking on the line: the carriage stops halfway along the piece it is on
                end = block_end([self.queue[0]])
                self.x = round((self.x + end[0] * STEPS_PER_MM[0]) / 2)
                self.y = round((self.y + end[1] * STEPS_PER_MM[1]) / 2)
            self.running, self.queue = False, []
            return f"ok {a}"
        if u.path == "/raw":
            if not self.paths:                 # the old bridge: no /raw at all
                return "bridge answers 404 to /raw"
            c = unquote(q["c"][0])
            if c[0] in "FT":
                self.log.append(c)
                return f"ok {c[0]} {float(c.split()[1]):.1f}"
            if c == "G":
                self.log.append("G")
                if not self.queue:
                    return "? очередь пуста"
                self.running = True
                return "ok G"
            if self.edge_on and self.edge_on in c:
                return f"край {c[0]}"
            if len(self.queue) >= 16:
                return "? очередь полна"
            self.queue.append(c)
            self.log.append(c)
            end = block_end([c])
            self.goal = (round(end[0] * STEPS_PER_MM[0]), round(end[1] * STEPS_PER_MM[1]))
            self.max_queue = max(self.max_queue, len(self.queue))
            return f"ok {c[0]} {16 - len(self.queue)}"
        return "?"

    def sleep(self, dt):
        if self.on_sleep:
            self.on_sleep()
        if self.running:
            done, self.queue = self.queue[:self.rate], self.queue[self.rate:]
            if self.stuck_x:                   # the board stops the path on the fault
                self.queue = []
                self.y = self.goal[1]
            elif done:                         # the carriage is at the end of the last piece run
                end = block_end([done[-1]])
                self.x, self.y = round(end[0] * STEPS_PER_MM[0]), round(end[1] * STEPS_PER_MM[1])
            if not self.queue:
                self.running = False


def run(board, blocks, **kw):
    r = Runner(board.send, sleep=board.sleep, swing_s=0.4, **kw)
    ok, _ = r.start(blocks)
    assert ok
    r.thread.join(10)
    return r


def arm(off):
    return {"kind": "arm", "cmd": f"J 3 {90 if off else 0}", "off": off}


def travel(x, y):
    return {"kind": "move", "cmds": ["T 100", f"M {x} {y}", "G"], "paintMM": 0}


def paint(n, mm=100.0):
    return {"kind": "move", "cmds": ["F 20"] + [f"L {i}.00 50.00" for i in range(1, n + 1)] + ["G"], "paintMM": mm}


class RunnerTest(unittest.TestCase):
    def test_a_job_runs_in_order(self):
        b = FakeBoard()
        r = run(b, [arm(True), travel(10, 20), arm(False), paint(5), arm(True)])
        self.assertEqual(r.state, "done", r.message)
        self.assertEqual(b.log, ["T 100", "J 3 90", "T 100", "M 10 20", "G", "J 3 0", "F 20"]
                         + [f"L {i}.00 50.00" for i in range(1, 6)] + ["G", "J 3 90"])
        self.assertEqual(r.status()["percent"], 100.0)
        self.assertFalse(r.brush_on)

    def test_long_pass_streams_through_a_queue_of_16(self):
        b = FakeBoard()
        r = run(b, [paint(40)])
        self.assertEqual(r.state, "done", r.message)
        sent = [c for c in b.log if c.startswith("L")]
        self.assertEqual(sent, [f"L {i}.00 50.00" for i in range(1, 41)])
        self.assertEqual(b.log.count("G"), 1)
        self.assertLessEqual(b.max_queue, 16)

    def test_a_piece_past_the_wall_stops_everything(self):
        b = FakeBoard(edge_on="L 3.00")
        r = run(b, [arm(False), paint(5)])
        self.assertEqual(r.state, "error")
        self.assertIn("past a wall", r.message)
        self.assertEqual(b.log[-1], "S")

    def test_stop_brakes_and_says_the_brush_is_down(self):
        b = FakeBoard(rate=1)
        r = Runner(b.send, sleep=b.sleep, swing_s=0.2)
        ticks = {"n": 0}

        def later():
            ticks["n"] += 1
            if ticks["n"] == 5:
                r.stop()
        b.on_sleep = later
        r.start([arm(False), paint(30), arm(True), paint(5)])
        r.thread.join(10)
        self.assertEqual(r.state, "stopped")
        self.assertIn("S", b.log)
        self.assertNotIn("J 3 90", b.log)          # the next blocks never ran
        self.assertIn("brush on the canvas", r.message)

    def test_hard_stop_after_stop_still_reaches_the_board(self):
        b = FakeBoard(rate=1)
        r = Runner(b.send, sleep=b.sleep, swing_s=0.2)
        ticks = {"n": 0}

        def later():
            ticks["n"] += 1
            if ticks["n"] == 5:
                r.stop()
                r.stop(hard=True)
        b.on_sleep = later
        r.start([arm(False), paint(30)])
        r.thread.join(10)
        self.assertEqual([c for c in b.log if c in "SK"][:2], ["S", "K"])

    def test_a_stop_goes_to_the_board_even_when_idle(self):
        b = FakeBoard()
        r = Runner(b.send, sleep=b.sleep)
        r.stop(hard=True)
        self.assertEqual(b.log, ["K"])

    def test_a_stop_from_a_page_ends_the_job_too(self):
        # 2026-09-28: STOP on the Calibration tab goes to the board, not to
        # the runner; the runner took the end of the path for the end of the
        # block and would have run the next one.
        b = FakeBoard(rate=1)
        r = Runner(b.send, sleep=b.sleep, swing_s=0.2)
        ticks = {"n": 0}

        def later():
            ticks["n"] += 1
            if ticks["n"] == 5:
                r.board_stopped()          # what rubens.py does as S passes by
                b.send("/cmd?a=S&n=0")     # and the S itself reaches the board
        b.on_sleep = later
        r.start([arm(False), paint(30), arm(True), travel(10, 20), arm(False), paint(5)])
        r.thread.join(10)
        self.assertEqual(r.state, "stopped")
        self.assertNotIn("M 10 20", b.log)
        self.assertNotIn("J 3 90", b.log)

    def test_a_hard_stop_from_a_page_is_not_softened(self):
        b = FakeBoard(rate=1)
        r = Runner(b.send, sleep=b.sleep, swing_s=0.2)
        ticks = {"n": 0}

        def later():
            ticks["n"] += 1
            if ticks["n"] == 5:
                r.board_stopped(hard=True)
                r.board_stopped()
        b.on_sleep = later
        r.start([arm(False), paint(30)])
        r.thread.join(10)
        self.assertEqual(r._stop, "K")

    def test_a_runaway_past_a_wall_is_hard_stopped(self):
        b = FakeBoard(rate=0)                   # the path never ends by itself
        ticks = {"n": 0}

        def run_away():                         # Y counts on and on, like on 2026-09-27
            ticks["n"] += 1
            b.y = 267 + 2000 * ticks["n"]
        b.on_sleep = run_away
        r = run(b, [arm(False), paint(3)])
        self.assertEqual(r.state, "error")
        self.assertIn("runaway: Y", r.message)
        self.assertIn("K", b.log)

    def test_a_job_starts_from_home_in_the_reserve(self):
        # home is past both walls, at the stops: X −9.45 mm, Y −8.3 mm
        b = FakeBoard()
        b.x, b.y = -756, -222
        r = run(b, [arm(True), travel(10, 20), arm(False), paint(3)])
        self.assertEqual(r.state, "done", r.message)

    def test_no_zero_no_motion(self):
        b = FakeBoard(zero=False)
        r = run(b, [arm(True), travel(10, 20)])
        self.assertEqual(r.state, "error")
        self.assertIn("zero", r.message)
        self.assertEqual([c for c in b.log if c != "S"], [])

    def test_without_the_pass_firmware_nothing_moves(self):
        b = FakeBoard(paths=False)
        r = run(b, [arm(True), travel(10, 20), arm(False), paint(5)])
        self.assertEqual(r.state, "error")
        self.assertIn("cannot run a path", r.message)
        self.assertEqual([c for c in b.log if c != "S"], [])   # not even the brush

    def test_a_travel_to_where_the_carriage_is_is_skipped(self):
        b = FakeBoard()
        empty = {"kind": "move", "cmds": ["T 100", "G"], "paintMM": 0}   # its M was too short to queue
        r = run(b, [arm(True), empty, arm(False), paint(3)])
        self.assertEqual(r.state, "done", r.message)
        self.assertIn("L 3.00 50.00", b.log)

    def test_a_path_the_board_stopped_is_not_taken_for_done(self):
        # 2026-09-28: X stuck after a HARD STOP; the board stopped each path,
        # the runner went on, lowered the pencil and ran along Y only
        b = FakeBoard(stuck_x=True)             # the carriage stands at X 10 mm
        r = run(b, [arm(True), travel(100, 20), arm(False), paint(5)])
        self.assertEqual(r.state, "error")
        self.assertIn("did not get there", r.message)
        self.assertNotIn("J 3 0", b.log)       # the brush never went down
        self.assertIn("K", b.log)

    def test_board_words_in_english(self):
        self.assertEqual(in_english("край A"), "past a wall")
        self.assertIn("restart the board", in_english("? путь: такт не берётся 0"))
        self.assertEqual(in_english("ok L 12"), "ok L 12")

    def test_block_end(self):
        self.assertEqual(block_end(["F 20", "L 1 2", "A 0 0 3.5 4 -1", "G"]), (3.5, 4.0))
        self.assertEqual(block_end(["T 100", "M 10 20", "G"]), (10.0, 20.0))
        self.assertIsNone(block_end(["T 100", "G"]))

    def test_parse_ping(self):
        self.assertEqual(parse_ping("ok P X 800 Y 267 путь 3"), {"x": 800, "y": 267, "path": 3})
        self.assertEqual(parse_ping("ok P X 0 край Y ? "), {"x": 0, "y": None, "path": None})
        self.assertIsNone(parse_ping("нет платы"))


class PauseTest(unittest.TestCase):
    """Pause and Continue (the owner, 2026-09-28: a blunt pencil, sharpened
    without starting the job over)."""

    def paused_run(self, blocks, when, then=None):
        # Pause on tick `when`; `then(r, b)` runs once the runner is paused,
        # and by default presses Continue.
        b = FakeBoard(rate=1)
        r = Runner(b.send, sleep=b.sleep, swing_s=0.2)
        ticks = {"n": 0, "done": False}

        def later():
            ticks["n"] += 1
            if ticks["n"] == when:
                self.assertTrue(r.pause())
            if r.state == "paused" and not ticks["done"]:
                ticks["done"] = True
                (then or (lambda r, b: r.resume()))(r, b)
        b.on_sleep = later
        r.start(blocks)
        r.thread.join(10)
        return r, b

    def test_a_pass_brakes_the_brush_lifts_and_the_rest_goes_on_from_that_point(self):
        r, b = self.paused_run([arm(False), paint(12)], when=4)
        self.assertEqual(r.state, "done", r.message)
        i = b.log.index("S")
        self.assertEqual(b.log[i + 1:i + 3], ["J 3 90", "J 3 0"])      # off the canvas, and back
        after = [c for c in b.log[i:] if c.startswith("L")]
        before = [c for c in b.log[:i] if c.startswith("L")]
        self.assertEqual(after[-1], "L 12.00 50.00")                    # the pass is finished
        first = int(after[0].split()[1].split(".")[0])
        self.assertEqual(after, [f"L {k}.00 50.00" for k in range(first, 13)])   # nothing skipped
        ran = [c for c in before if int(c.split()[1].split(".")[0]) < first]
        self.assertTrue(ran, "some of the pass ran before the pause")
        self.assertNotIn("K", b.log)
        self.assertEqual(r.status()["percent"], 100.0)

    def test_a_travel_ends_first_then_the_pause(self):
        r, b = self.paused_run([arm(True), travel(100, 20), arm(False), paint(3)], when=2)
        self.assertEqual(r.state, "done", r.message)
        self.assertNotIn("S", b.log)                                    # the travel was not braked
        self.assertLess(b.log.index("M 100 20"), b.log.index("J 3 0"))

    def test_stop_while_paused_ends_the_job(self):
        r, b = self.paused_run([arm(False), paint(12), arm(True), travel(10, 20)], when=4,
                               then=lambda r, b: r.stop())
        self.assertEqual(r.state, "stopped")
        self.assertNotIn("M 10 20", b.log)
        self.assertEqual(b.log.count("J 3 0"), 1)                       # the brush stays off

    def test_hard_stop_while_paused_reaches_the_board(self):
        r, b = self.paused_run([arm(False), paint(12)], when=4, then=lambda r, b: r.stop(hard=True))
        self.assertEqual(r.state, "stopped")
        self.assertEqual(b.log[-1], "K")

    def test_continue_only_when_paused_and_no_new_start_meanwhile(self):
        r = Runner(FakeBoard().send)
        self.assertFalse(r.resume())
        self.assertFalse(r.pause())                                     # idle: nothing to pause
        with r.lock:
            r.state = "paused"
        ok, _ = r.start([arm(True)])
        self.assertFalse(ok)                                            # a paused job is still a job

    def test_after_a_pause_the_turn_stays_slow(self):
        cmds = ["F 80", "L 10 0", "F 37", "A 10 5 10 10 1", "F 80", "L 0 10", "G"]
        self.assertEqual(rest_of(cmds, 0), cmds)
        self.assertEqual(rest_of(cmds, 1), ["F 37", "A 10 5 10 10 1", "F 80", "L 0 10", "G"])
        self.assertEqual(rest_of(cmds, 2), ["F 80", "L 0 10", "G"])

    def test_piece_at_finds_the_piece_on_lines_and_arcs(self):
        path = ["L 10 0", "A 10 5 10 10 1", "L 0 10"]                   # a U: right, a half circle up, back left
        self.assertEqual(piece_at((0, 0), path, (4, 0)), 0)
        self.assertEqual(piece_at((0, 0), path, (15, 5)), 1)            # the far side of the half circle
        self.assertIsNone(piece_at((0, 0), path, (5, 5)))               # inside the U: on no piece
        self.assertEqual(piece_at((0, 0), path, (6, 10)), 2)
        self.assertEqual(piece_at((0, 0), path, (10, 0), first=1), 1)  # a joint: the later piece, if asked


class ParkTest(unittest.TestCase):
    """Shut down before the 12 V goes off, restore after power-on (2026-09-28)."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "park.json")

    def tearDown(self):
        self.dir.cleanup()

    def park(self, b):
        return Park(self.path, b.send, sleep=b.sleep)

    def test_shut_down_hard_stops_and_saves_where_the_carriage_stands(self):
        b = FakeBoard()
        b.x, b.y = 41234, 9876
        ok, msg, park = self.park(b).shut_down(Runner(b.send, sleep=b.sleep))
        self.assertTrue(ok, msg)
        self.assertEqual(b.log, ["K"])
        with open(self.path) as f:
            saved = json.load(f)
        self.assertEqual((saved["x"], saved["y"], saved["used"]), (41234, 9876, False))

    def test_shut_down_stops_a_running_job(self):
        b = FakeBoard(rate=0)                   # the path never ends by itself
        r = Runner(b.send, sleep=b.sleep, swing_s=0.2)
        r.start([arm(False), paint(30)])
        deadline = time.time() + 5
        while "F 20" not in b.log and time.time() < deadline:   # the pass is under way
            time.sleep(0.001)
        ok, msg, _ = self.park(b).shut_down(r)
        r.thread.join(10)
        self.assertEqual(r.state, "stopped")
        self.assertIn("K", b.log)

    def test_shut_down_without_a_zero_saves_nothing_but_still_stops(self):
        b = FakeBoard(zero=False)
        ok, msg, park = self.park(b).shut_down(Runner(b.send, sleep=b.sleep))
        self.assertFalse(ok)
        self.assertEqual(b.log, ["K"])
        self.assertFalse(os.path.exists(self.path))

    def test_restore_puts_the_place_back_once(self):
        b = FakeBoard()
        b.x, b.y = 41234, 9876
        self.park(b).shut_down(Runner(b.send, sleep=b.sleep))
        after = FakeBoard(zero=False)           # power-on: no zero
        ok, msg, _ = self.park(after).restore()
        self.assertTrue(ok, msg)
        self.assertEqual(after.log, ["O X 41234", "O Y 9876"])
        again = FakeBoard(zero=False)           # the next power-on without Shut down
        ok, msg, _ = self.park(again).restore()
        self.assertFalse(ok)
        self.assertEqual(again.log, [])

    def test_restore_never_overwrites_a_zero_the_board_has(self):
        b = FakeBoard()
        self.park(b).shut_down(Runner(b.send, sleep=b.sleep))
        live = FakeBoard()
        ok, msg, _ = self.park(live).restore()
        self.assertFalse(ok)
        self.assertEqual(live.log, [])

    def test_a_jog_or_a_new_home_uses_the_place_up(self):
        b = FakeBoard()
        self.park(b).shut_down(Runner(b.send, sleep=b.sleep))
        self.park(b).forget()
        ok, msg, _ = self.park(FakeBoard(zero=False)).restore()
        self.assertFalse(ok)
        self.assertIn("find home", msg)


if __name__ == "__main__":
    unittest.main()
