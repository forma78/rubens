// The test of path.h on the Mac, no board:
//   c++ -std=c++17 -O1 -o /tmp/path_test path_test.cpp && /tmp/path_test
// Runs the planner in 20 ms ticks and checks: the point is always on the
// path, the speed never above the limit and changing no faster than the
// acceleration, the path ends exactly at its end point, the speed does not
// drop at a smooth joint, and is zero at a kink and at a travel.

#include <cstdio>
#include <cmath>
#include <vector>
#include <functional>
#include "../src/path.h"

using namespace path;

static int fails = 0;
#define CHECK(cond, ...) do { if (!(cond)) { fails++; printf("  FAIL %s:%d  ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static const float DT = 0.02f, ACC = 250.0f;

struct Tick { float x, y, v; };

// Runs to the end of the path; before(i) may send more pieces on the way.
static std::vector<Tick> run(Planner &p, std::function<void(int)> before = nullptr, int limit = 100000) {
  std::vector<Tick> out;
  for (int i = 0; i < limit; i++) {
    if (before) before(i);
    float x, y;
    bool more = p.step(DT, &x, &y);
    out.push_back({x, y, p.speed()});
    if (!more) break;
  }
  return out;
}

static float distToSeg(const Seg &g, float x, float y) {
  if (g.kind == 'A') {
    return fabsf(hypotf(x - g.cx, y - g.cy) - g.r);   // to the circle; the arc is not cut by angle
  }
  float dx = g.x1 - g.x0, dy = g.y1 - g.y0, L2 = dx * dx + dy * dy;
  float t = L2 > 0 ? ((x - g.x0) * dx + (y - g.y0) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return hypotf(x - (g.x0 + dx * t), y - (g.y0 + dy * t));
}
static float distToPath(const std::vector<Seg> &segs, float x, float y) {
  float d = 1e9f;
  for (auto &g : segs) { float e = distToSeg(g, x, y); if (e < d) d = e; }
  return d;
}

static void checkRun(const char *name, const std::vector<Seg> &segs, const std::vector<Tick> &t, float vlim) {
  printf("%s: %zu ticks, %.2f s\n", name, t.size(), t.size() * DT);
  float prev = 0, worst = 0;
  for (size_t i = 0; i < t.size(); i++) {
    float e = distToPath(segs, t[i].x, t[i].y);
    if (e > worst) worst = e;
    CHECK(t[i].v <= vlim + 1e-3f, "tick %zu speed %.3f > %.3f", i, t[i].v, vlim);
    CHECK(t[i].v - prev <= ACC * DT + 1e-3f, "tick %zu speeds up too fast: %.3f → %.3f", i, prev, t[i].v);
    prev = t[i].v;
  }
  CHECK(worst < 0.01f, "off the path by %.4f mm", worst);
  const Seg &last = segs.back();
  CHECK(hypotf(t.back().x - last.x1, t.back().y - last.y1) < 1e-3f, "ends at %.3f %.3f, not %.3f %.3f", t.back().x, t.back().y, last.x1, last.y1);
  CHECK(t.back().v == 0, "does not stop at the end");
}

int main() {
  // 1. A 100 mm line at 20 mm/s: 5 s of run plus v/a to speed up and brake.
  {
    Planner p(ACC); p.setHere(0, 0);
    std::vector<Seg> segs = { line(0, 0, 100, 0, 20) };
    for (auto &g : segs) p.push(g);
    auto t = run(p);
    checkRun("line 100 mm", segs, t, 20);
    float T = t.size() * DT;
    CHECK(fabsf(T - (100.0f / 20 + 20.0f / ACC)) < 0.1f, "took %.3f s", T);
  }
  // 2. A line, a tangent semicircle, a line — smooth: the speed does not drop.
  {
    Planner p(ACC); p.setHere(0, 0);
    Seg a = line(0, 0, 200, 0, 20);
    Seg b = arc(200, 0, 200, 12, 200, 24, +1, 20);         // from +X to +Y: a semicircle of radius 12
    Seg c = line(b.x1, b.y1, 0, 24, 20);
    std::vector<Seg> segs = { a, b, c };
    for (auto &g : segs) p.push(g);
    CHECK(fabsf(b.sweep - 3.14159265f) < 1e-4f, "semicircle sweep %.5f", b.sweep);
    CHECK(junction(a, b) == 20 && junction(b, c) == 20, "smooth joints must keep the speed");
    auto t = run(p);
    checkRun("line, semicircle, line", segs, t, 20);
    float vmin = 1e9f;
    for (size_t i = t.size() / 5; i < t.size() * 4 / 5; i++) vmin = fminf(vmin, t[i].v);
    CHECK(vmin > 19.9f, "slows down at a smooth joint to %.2f", vmin);
  }
  // 3. A 90° kink: a stop at the corner.
  {
    Planner p(ACC); p.setHere(0, 0);
    std::vector<Seg> segs = { line(0, 0, 50, 0, 20), line(50, 0, 50, 50, 20) };
    for (auto &g : segs) p.push(g);
    auto t = run(p);
    checkRun("corner 90°", segs, t, 20);
    float vcorner = 1e9f;
    for (auto &k : t) if (hypotf(k.x - 50, k.y) < 0.5f) vcorner = fminf(vcorner, k.v);
    CHECK(vcorner < ACC * DT * 2, "passes the corner at %.2f mm/s", vcorner);
  }
  // 4. A travel M: a stop at both ends, even on a straight line.
  {
    Planner p(ACC); p.setHere(0, 0);
    std::vector<Seg> segs = { line(0, 0, 50, 0, 20), line(50, 0, 150, 0, 100, 'M'), line(150, 0, 200, 0, 20) };
    for (auto &g : segs) p.push(g);
    auto t = run(p);
    checkRun("pass, travel, pass", segs, t, 100);
    for (float xs : {50.0f, 150.0f}) {
      float v = 1e9f;
      for (auto &k : t) if (fabsf(k.x - xs) < 0.3f) v = fminf(v, k.v);
      CHECK(v < ACC * DT * 2, "does not stop at x = %.0f (%.2f mm/s)", xs, v);
    }
  }
  // 5. Sending on the way: while the queue does not run empty, the pass does not brake.
  {
    Planner p(ACC); p.setHere(0, 0);
    std::vector<Seg> segs;
    for (int i = 0; i < 40; i++) segs.push_back(line(i * 10.0f, 0, (i + 1) * 10.0f, 0, 20));
    size_t sent = 0;
    auto t = run(p, [&](int) { while (sent < segs.size() && p.room() > 0) p.push(segs[sent++]); });
    checkRun("streamed 40 × 10 mm", segs, t, 20);
    float vmin = 1e9f;
    for (size_t i = t.size() / 10; i < t.size() * 9 / 10; i++) vmin = fminf(vmin, t[i].v);
    CHECK(vmin > 19.9f, "slows down while streaming to %.2f", vmin);
  }
  // 6. A stop on the move: brakes without leaving the path, in v/a.
  {
    Planner p(ACC); p.setHere(0, 0);
    std::vector<Seg> segs;
    for (int i = 0; i < 10; i++) segs.push_back(line(i * 20.0f, 0, (i + 1) * 20.0f, 0, 50));
    for (auto &g : segs) p.push(g);
    int stopAt = 60;
    auto t = run(p, [&](int i) { if (i == stopAt) p.stopSoon(); });
    float xStop = t[stopAt].x, xEnd = t.back().x;
    printf("stop soon: at x %.1f, stands at x %.1f\n", xStop, xEnd);
    CHECK(xEnd - xStop <= 50.0f * 50.0f / (2 * ACC) + 20.0f + 0.5f, "runs on %.1f mm after STOP", xEnd - xStop);
    CHECK(t.back().v == 0, "does not stop");
    for (auto &k : t) CHECK(fabsf(k.y) < 1e-4f, "leaves the path while stopping");
  }
  // 6b. A stop on one long piece: brakes inside the piece, in v²/2a.
  {
    Planner p(ACC); p.setHere(0, 0);
    p.push(line(0, 0, 400, 0, 30));
    int stopAt = 100;
    auto t = run(p, [&](int i) { if (i == stopAt) p.stopSoon(); });
    float xStop = t[stopAt].x, xEnd = t.back().x;
    printf("stop on one long line: at x %.2f, stands at x %.2f, %zu ticks later\n", xStop, xEnd, t.size() - stopAt);
    CHECK(xEnd - xStop < 30.0f * 30.0f / (2 * ACC) + 0.7f, "runs on %.2f mm after STOP", xEnd - xStop);
    CHECK(xEnd < 399, "went to the end of the line");
    CHECK(t.back().v == 0, "does not stop");
    Planner q(ACC); q.setHere(0, 0); q.push(line(0, 0, 10, 0, 10)); float x, y; q.step(DT, &x, &y);
    CHECK(q.running(), "a stopped planner must take new pieces again");
  }
  // 7. Steps: X 80 a mm, Y 26.667 a mm; no more in a tick than fits the queue.
  {
    Planner p(ACC); p.setHere(0, 0);
    Seg g = line(0, 0, 300, 200, 200);    // fast and on the diagonal
    p.push(g);
    const float KX = 80, KY = 3200.0f / 120;
    long cx = 0, cy = 0, worst = 0;
    float x, y;
    bool more = true;
    while (more) {
      more = p.step(DT, &x, &y);
      long tx = lroundf(x * KX), ty = lroundf(y * KY);
      long dx = labs(tx - cx), dy = labs(ty - cy);
      if (dx > worst) worst = dx;
      if (dy > worst) worst = dy;
      cx = tx; cy = ty;
    }
    printf("steps: at most %ld per tick, ends at %ld %ld\n", worst, cx, cy);
    CHECK(worst <= 8160, "too many steps for one tick: %ld", worst);
    CHECK(cx == 24000 && cy == 5333, "ends at %ld %ld", cx, cy);
  }

  if (fails) { printf("\n%d FAILED\n", fails); return 1; }
  printf("\nall passed\n");
  return 0;
}
