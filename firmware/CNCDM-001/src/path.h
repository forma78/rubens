// path.h — the path the RUBENS pass follows, and the speed along it.
//
// Plain C++ without Arduino: the same file builds on the Mac for the tests
// (test_host/). Coordinates are machine millimetres: x is the X axis (plus
// towards the top of the picture), y the Y axis (plus to the right). An
// arc's angle turns from +X to +Y.
//
// The path is a queue of lines and arcs. Once a tick (20 ms) the planner
// moves the point along the path and gives its coordinates; the firmware
// makes the steps from them. The speed is a trapezoid: speed up, run, brake.
// One rule: at any moment it can stop at the end of what is already queued.
// At a smooth joint the speed does not drop; at a kink over MAX_TURN_DEG and
// at both ends of a travel (M) it is zero.

#pragma once
#include <math.h>
#include <stdint.h>

namespace path {

static const float MAX_TURN_DEG = 10.0f;   // a sharper kink — stop at the joint

struct Seg {
  char  kind;           // 'L' a line, 'A' an arc, 'M' a travel (a line stopping at both ends)
  float x0, y0, x1, y1; // start and end, mm
  float cx, cy, r;      // arc: centre and radius
  float a0, sweep;      // arc: start angle and signed sweep, rad
  float len;            // length, mm
  float v;              // the speed limit on this piece, mm/s
};

inline Seg line(float x0, float y0, float x1, float y1, float v, char kind = 'L') {
  Seg g = {};
  g.kind = kind; g.x0 = x0; g.y0 = y0; g.x1 = x1; g.y1 = y1; g.v = v;
  g.len = hypotf(x1 - x0, y1 - y0);
  return g;
}

// An arc from (x0, y0) round (cx, cy) to the angle of the point (x1, y1).
// dir > 0 turns from +X to +Y, dir < 0 back. The radius is taken from the
// start and the end is worked out again from the angle: a small rounding
// mismatch does not break the path.
inline Seg arc(float x0, float y0, float cx, float cy, float x1, float y1, int dir, float v) {
  Seg g = {};
  g.kind = 'A'; g.x0 = x0; g.y0 = y0; g.cx = cx; g.cy = cy; g.v = v;
  g.r  = hypotf(x0 - cx, y0 - cy);
  g.a0 = atan2f(y0 - cy, x0 - cx);
  float a1 = atan2f(y1 - cy, x1 - cx), s = a1 - g.a0;
  const float TAU = 6.2831853f;
  if (dir > 0) { while (s <= 0) s += TAU; while (s > TAU) s -= TAU; }
  else         { while (s >= 0) s -= TAU; while (s < -TAU) s += TAU; }
  g.sweep = s;
  g.x1 = cx + g.r * cosf(g.a0 + s);
  g.y1 = cy + g.r * sinf(g.a0 + s);
  g.len = fabsf(s) * g.r;
  return g;
}

// The point on a piece at a distance d from its start.
inline void pointAt(const Seg &g, float d, float *x, float *y) {
  if (g.len <= 0) { *x = g.x1; *y = g.y1; return; }
  float t = d / g.len;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  if (g.kind == 'A') {
    float a = g.a0 + g.sweep * t;
    *x = g.cx + g.r * cosf(a); *y = g.cy + g.r * sinf(a);
  } else {
    *x = g.x0 + (g.x1 - g.x0) * t; *y = g.y0 + (g.y1 - g.y0) * t;
  }
}

// The direction of motion at the start and the end of a piece, a unit vector.
inline void dirAt(const Seg &g, bool end, float *dx, float *dy) {
  if (g.kind == 'A') {
    float a = g.a0 + (end ? g.sweep : 0), k = g.sweep > 0 ? 1.0f : -1.0f;
    *dx = -sinf(a) * k; *dy = cosf(a) * k;
  } else {
    float l = g.len > 0 ? g.len : 1;
    *dx = (g.x1 - g.x0) / l; *dy = (g.y1 - g.y0) / l;
  }
}

// The speed at the joint of pieces a → b.
inline float junction(const Seg &a, const Seg &b) {
  if (a.kind == 'M' || b.kind == 'M') return 0;
  float ax, ay, bx, by;
  dirAt(a, true, &ax, &ay); dirAt(b, false, &bx, &by);
  float c = ax * bx + ay * by;
  if (c < cosf(MAX_TURN_DEG * 3.14159265f / 180)) return 0;
  return a.v < b.v ? a.v : b.v;
}

class Planner {
 public:
  static const int N = 16;          // pieces in the queue

  explicit Planner(float accel) : accel_(accel) {}

  // Where the path ends: the end of the last piece queued, and with the
  // queue empty, where the carriage stands. A new piece starts here.
  void setHere(float x, float y) { if (!count_) { endX_ = x; endY_ = y; } }
  float endX() const { return endX_; }
  float endY() const { return endY_; }

  int  count() const { return count_; }
  int  room() const { return N - count_; }
  bool running() const { return count_ > 0; }
  float speed() const { return v_; }

  bool push(const Seg &g) {
    if (count_ == N) return false;
    q_[(head_ + count_) % N] = g;
    count_++;
    endX_ = g.x1; endY_ = g.y1;
    return true;
  }

  // Stop as soon as possible without leaving the path: a braking distance
  // from where the point is now, in the middle of a piece if need be. The
  // pieces beyond are dropped. (At first only whole pieces after the current
  // one were cut, and on a long line S did not brake — 2026-09-27.)
  void stopSoon() {
    if (!count_) return;
    float need = v_ * v_ / (2 * accel_), d = q_[head_].len - s_;
    int k = 0;
    while (d < need && k + 1 < count_) { k++; d += q_[(head_ + k) % N].len; }
    count_ = k + 1;
    const Seg &last = q_[(head_ + k) % N];   // the path's end is the end of the last piece left
    endX_ = last.x1; endY_ = last.y1;
    limit_ = need;
  }

  // Drop everything: the carriage stands (a hard stop), the path is empty.
  void clear(float x, float y) { count_ = 0; s_ = 0; v_ = 0; limit_ = -1; endX_ = x; endY_ = y; }

  // One tick of length dt: the path's new point into (*x, *y). False — the
  // path has ended, the speed is zero, the point is the path's end.
  bool step(float dt, float *x, float *y) {
    if (!count_) { v_ = 0; limit_ = -1; *x = endX_; *y = endY_; return false; }

    // How fast it may go now: the piece's limit and every joint ahead, up to
    // the end of the queue — each one it can still brake for.
    float vmax = q_[head_].v, d = q_[head_].len - s_;
    for (int k = 0; k < count_; k++) {
      const Seg &a = q_[(head_ + k) % N];
      float vj = k + 1 < count_ ? junction(a, q_[(head_ + k + 1) % N]) : 0;
      float lim = sqrtf(vj * vj + 2 * accel_ * (d > 0 ? d : 0));
      if (lim < vmax) vmax = lim;
      if (k + 1 < count_) d += q_[(head_ + k + 1) % N].len;
    }
    if (limit_ >= 0) {                       // a stop by S: a limit inside the path
      float lim = sqrtf(2 * accel_ * (limit_ > 0 ? limit_ : 0));
      if (lim < vmax) vmax = lim;
    }
    float vn = v_ + accel_ * dt;
    if (vn > vmax) vn = vmax;
    if (vn < 0) vn = 0;

    float ds = 0.5f * (v_ + vn) * dt;
    if (limit_ >= 0) {
      if (ds >= limit_ || limit_ - ds < 0.01f) ds = limit_;
      limit_ -= ds;
    }
    v_ = vn;
    s_ += ds;
    // across the joints
    while (count_ && s_ >= q_[head_].len) {
      s_ -= q_[head_].len;
      head_ = (head_ + 1) % N;
      count_--;
    }
    // the path's end: nearer than 0.01 mm — arrived
    float left = 0;
    for (int k = 0; k < count_; k++) left += q_[(head_ + k) % N].len;
    left -= s_;
    if (!count_ || left < 0.01f) {
      count_ = 0; s_ = 0; v_ = 0; limit_ = -1;
      *x = endX_; *y = endY_;
      return false;
    }
    pointAt(q_[head_], s_, x, y);
    if (limit_ >= 0 && limit_ < 0.01f) {      // stopped by S in the middle of the path
      count_ = 0; s_ = 0; v_ = 0; limit_ = -1;
      endX_ = *x; endY_ = *y;
      return false;
    }
    return true;
  }

 private:
  Seg   q_[N];
  int   head_ = 0, count_ = 0;
  float s_ = 0;         // gone along the first piece, mm
  float v_ = 0;         // speed, mm/s
  float accel_;         // acceleration and braking, mm/s²
  float limit_ = -1;    // a stop by S: how far still to go, mm; -1 — none
  float endX_ = 0, endY_ = 0;
};

}  // namespace path
