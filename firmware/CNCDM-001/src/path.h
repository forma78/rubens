// path.h — путь, по которому идёт проход RUBENS, и скорость на нём.
//
// Чистый C++ без Arduino: этот же файл собирается на маке для тестов
// (test_host/). Координаты — миллиметры машины: x — ось X (плюс к верху
// картины), y — ось Y (плюс вправо). Угол дуги считается от +X к +Y.
//
// Путь — очередь отрезков и дуг. Планировщик раз в такт (20 мс) двигает
// точку по пути и отдаёт её координаты; шаги из них делает прошивка.
// Скорость — трапеция: разгон, ход, торможение. Правило одно: в любой
// момент можно остановиться в конце того, что уже лежит в очереди.
// На гладком стыке скорость не падает; на изломе больше MAX_TURN_DEG
// и на обоих концах переезда (M) — ноль.

#pragma once
#include <math.h>
#include <stdint.h>

namespace path {

static const float MAX_TURN_DEG = 10.0f;   // излом круче — стоп на стыке

struct Seg {
  char  kind;           // 'L' — отрезок, 'A' — дуга, 'M' — переезд (отрезок со стопом на концах)
  float x0, y0, x1, y1; // начало и конец, мм
  float cx, cy, r;      // дуга: центр и радиус
  float a0, sweep;      // дуга: начальный угол и размах со знаком, рад
  float len;            // длина, мм
  float v;              // предел скорости на этом куске, мм/с
};

inline Seg line(float x0, float y0, float x1, float y1, float v, char kind = 'L') {
  Seg g = {};
  g.kind = kind; g.x0 = x0; g.y0 = y0; g.x1 = x1; g.y1 = y1; g.v = v;
  g.len = hypotf(x1 - x0, y1 - y0);
  return g;
}

// Дуга от (x0, y0) вокруг (cx, cy) до угла точки (x1, y1). dir > 0 —
// от +X к +Y, dir < 0 — обратно. Радиус берётся по началу, конец
// пересчитывается по углу: мелкое расхождение округления не ломает путь.
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

// Точка на куске на расстоянии d от его начала.
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

// Направление движения в начале и в конце куска, единичный вектор.
inline void dirAt(const Seg &g, bool end, float *dx, float *dy) {
  if (g.kind == 'A') {
    float a = g.a0 + (end ? g.sweep : 0), k = g.sweep > 0 ? 1.0f : -1.0f;
    *dx = -sinf(a) * k; *dy = cosf(a) * k;
  } else {
    float l = g.len > 0 ? g.len : 1;
    *dx = (g.x1 - g.x0) / l; *dy = (g.y1 - g.y0) / l;
  }
}

// Скорость на стыке кусков a → b.
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
  static const int N = 16;          // кусков в очереди

  explicit Planner(float accel) : accel_(accel) {}

  // Где кончается путь: конец последнего куска в очереди, а пустая очередь —
  // там, где стоит каретка. Новый кусок начинается отсюда.
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

  // Остановиться как можно скорее, не сходя с пути: через тормозной путь
  // от того места, где точка сейчас, — хоть посреди куска. Куски дальше
  // выбрасываются. (Сначала обрезались только целые куски за текущим, и на
  // длинной линии S не тормозил — 27.09.2026.)
  void stopSoon() {
    if (!count_) return;
    float need = v_ * v_ / (2 * accel_), d = q_[head_].len - s_;
    int k = 0;
    while (d < need && k + 1 < count_) { k++; d += q_[(head_ + k) % N].len; }
    count_ = k + 1;
    const Seg &last = q_[(head_ + k) % N];   // конец пути — конец последнего оставшегося куска
    endX_ = last.x1; endY_ = last.y1;
    limit_ = need;
  }

  // Бросить всё: каретка стоит (резкий стоп), путь пуст.
  void clear(float x, float y) { count_ = 0; s_ = 0; v_ = 0; limit_ = -1; endX_ = x; endY_ = y; }

  // Один такт длиной dt: новая точка пути в (*x, *y). Ложь — путь кончился,
  // скорость ноль, точка — конец пути.
  bool step(float dt, float *x, float *y) {
    if (!count_) { v_ = 0; limit_ = -1; *x = endX_; *y = endY_; return false; }

    // Сколько можно сейчас: предел куска и каждый стык впереди, до конца
    // очереди включительно, — с которого ещё успеваем затормозить.
    float vmax = q_[head_].v, d = q_[head_].len - s_;
    for (int k = 0; k < count_; k++) {
      const Seg &a = q_[(head_ + k) % N];
      float vj = k + 1 < count_ ? junction(a, q_[(head_ + k + 1) % N]) : 0;
      float lim = sqrtf(vj * vj + 2 * accel_ * (d > 0 ? d : 0));
      if (lim < vmax) vmax = lim;
      if (k + 1 < count_) d += q_[(head_ + k + 1) % N].len;
    }
    if (limit_ >= 0) {                       // стоп по S: предел внутри пути
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
    // через стыки
    while (count_ && s_ >= q_[head_].len) {
      s_ -= q_[head_].len;
      head_ = (head_ + 1) % N;
      count_--;
    }
    // конец пути: ближе 0,01 мм — приехали
    float left = 0;
    for (int k = 0; k < count_; k++) left += q_[(head_ + k) % N].len;
    left -= s_;
    if (!count_ || left < 0.01f) {
      count_ = 0; s_ = 0; v_ = 0; limit_ = -1;
      *x = endX_; *y = endY_;
      return false;
    }
    pointAt(q_[head_], s_, x, y);
    if (limit_ >= 0 && limit_ < 0.01f) {      // встали по S посреди пути
      count_ = 0; s_ = 0; v_ = 0; limit_ = -1;
      endX_ = *x; endY_ = *y;
      return false;
    }
    return true;
  }

 private:
  Seg   q_[N];
  int   head_ = 0, count_ = 0;
  float s_ = 0;         // пройдено по первому куску, мм
  float v_ = 0;         // скорость, мм/с
  float accel_;         // разгон и торможение, мм/с²
  float limit_ = -1;    // стоп по S: сколько ещё проехать, мм; -1 — нет
  float endX_ = 0, endY_ = 0;
};

}  // namespace path
