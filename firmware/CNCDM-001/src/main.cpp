// Пульт машины плюс проход RUBENS (с 27.09.2026; черновик и его история —
// drafts/rubens-pass/). Проверено на машине: квадрат 50 × 50 карандашом
// четыре раза подряд, каретка возвращается в угол до сотых.
//
// Пульт машины: две оси и рука. Плюс проход RUBENS: плата ведёт кончик
// по цепочке отрезков и дуг, X и Y вместе, без остановок на гладких стыках.
//
// Команды приходят по USB, по одной в строке:
//   X <n>     уровень оси X, n от -20 до 20, ноль — стоп
//   Y <n>     то же для оси Y, но n от -9 до 9
//   J <j> <g> сустав j (1 плечо, 2 локоть, 3 кисть) на g градусов от нуля
//   Z         ноль руки здесь: текущая поза становится нулём, не двигаясь
//   S         стоп обеих осей с торможением (руку не трогает, она держит позу)
//   K         резкий стоп обеих осей, без торможения
//   O <X|Y> [n]  ноль оси здесь: каретка стоит, её место становится нулём.
//             С числом n — её место становится координатой n (в шагах)
//   P         пинг (сторож), в ответ — где оси: ok P X <шаги> Y <шаги>
//   V         смотр: есть ли 12 В, отвечают ли серво. Ничего не двигает
//
// Проход RUBENS. Координаты — мм машины от нуля осей (нужны оба нуля),
// кусок начинается там, где кончается предыдущий (или где стоит каретка):
//   F <мм/с>  скорость прохода для L и A, по умолчанию 20
//   T <мм/с>  скорость переезда для M, по умолчанию 100
//   L <x> <y>                отрезок до точки
//   A <cx> <cy> <x> <y> <±1> дуга вокруг центра до угла точки; +1 — от +X к +Y
//   M <x> <y>                переезд по прямой, со стопом на обоих концах
//   G         поехали по тому, что в очереди; досылать можно на ходу
// Ответ на кусок — «ok L n», n — сколько ещё влезет в очередь (16 кусков).
// Кусок за стенкой не берётся: «край». Пока идёт путь, пинг добавляет
// «путь n», команды X, Y, J и O не принимаются. S тормозит, не сходя
// с пути; K встаёт сразу; сторож тормозит, как S.
//
// Уровень n = n × 10 мм/с на обеих осях. У X шкив 20 зубьев, 80 шагов
// на мм: уровень — n × 800 шагов/с, ровно те же 800 шагов, что и шаг
// рисунка в 10 мм. У Y шкив 60 зубьев, 26,667 шага на мм: уровень —
// n × 266,667 шага/с (27.09.2026, до этого Y ехал втрое быстрее).
//
// Концевиков нет. Пока ноль оси не взят командой O, координата
// неизвестна: в пинге вместо числа «?», стенок нет. После O у оси
// работают стенки WALL_MIN и WALL_MAX: каретка тормозит заранее
// и встаёт у края, а в сторону края дальше не едет.
//
// Рельса и рука никогда не работают вместе: команда руке сперва
// останавливает обе оси. Проехал, встал, махнул, встал.
//
// Ноль каждого сустава — та поза, в которой он стоял, когда пришла
// первая команда, плюс смещение из JOINT_OFFSET. Пределы хода взяты
// не из измерений, а из осторожности и из нужд взмаха.

#include <Arduino.h>
#include <FastAccelStepper.h>
#include <SCServo.h>
#include "path.h"

static const int X_DIR = 27, X_STEP = 16;
static const int Y_DIR = 5,  Y_STEP = 4;

// Один уровень = 10 мм/с, в миллигерцах, чтобы у Y не округлять.
// Индекс 0 — X (800 шагов/с), 1 — Y (266,667 шага/с).
static const uint32_t LEVEL_MHZ[2]    = { 800000, 266667 };
static const int      X_LEVEL_MAX     = 20;      // 200 мм/с, поднято 23.09.2026
static const int      Y_LEVEL_MAX     = 9;       // 90 мм/с
static const uint32_t ACCEL           = 20000;   // шагов/с²: у X это 250 мм/с², у Y 750 мм/с²
static const uint32_t WATCHDOG_MS     = 1500;    // молчит дольше — стоп

// Проход RUBENS. Такт 20 мс: за такт каждая ось получает свои шаги
// на одно и то же время (moveTimed), поэтому X и Y идут вместе.
static const float    STEPS_PER_MM[2] = { 80.0f, 3200.0f / 120.0f };  // X 20 зубьев, Y 60
static const uint32_t SLICE_MS        = 20;
static const uint32_t SLICE_TICKS     = 16000000UL / 1000 * SLICE_MS;   // TICKS_PER_S на ESP32
static const float    PATH_ACCEL      = 250.0f;  // мм/с²
// Записей в очереди мотора (всего 32), дальше не подкладываем: медленной оси
// (реже шага в 4 мс) библиотека кладёт один такт до 8 записями, и на него
// всегда должно оставаться место — иначе «занят» (27.09.2026, при 28).
static const uint8_t  QUEUE_ROOM      = 24;
static const uint8_t  SLICES_AHEAD    = 6;       // тактов наперёд в очереди мотора (120 мс)
// Сторож побега: во время пути счёт оси не может уйти за стенку дальше,
// чем запас до упора плюс 2 мм. Ушёл — мотор шагает сам по себе, резкий стоп.
// 27.09.2026 такой побег Y трещал об упор, и остановить его смог только K.
static const int32_t  RUNAWAY_STEPS[2] = { 12 * 80, 12 * 3200 / 120 };
static const uint32_t STOP_WAIT_MS     = 1500;    // S не довёл путь до стопа — K

static const int      S_RXD    = 18;             // шина серво, приём
static const int      S_TXD    = 19;             // шина серво, передача
static const uint32_t BUS_BAUD = 1000000;        // 1 Мбод, иначе серво молчат

static const int     JOINTS      = 3;
static const uint8_t JOINT_ID[JOINTS] = { 1, 2, 3 };   // плечо, локоть, кисть
static const float   TICKS_PER_DEG = 4096.0f / 360.0f; // 11,378 тика на градус
static const uint16_t MOVE_SPEED = 600;          // тиков/с, это ~53 °/с
static const uint8_t  MOVE_ACC   = 30;

// У каждого сустава свой знак, свой предел и своё смещение нуля.
// Схема — `servo direction.png` в корне проекта.
//
// Плечо стоит мордой вниз, диском вверх: вправо у него само собой
// получается минус. Знак −1 это выпрямляет, вправо везде плюс.
// Локоть стоит мордой вверх, выпрямлять нечего.
// Кисть читается как циферблат: минус — против часовой, плюс — по часовой.
//
// Кисти нужен полный размах ±90°: она работает как метла, коротким
// взмахом краску по холсту не разметёшь.
//
// Смещение +5° у плеча и локтя — точка, с которой удобно отлаживать.
// Оно уезжает вправо, то есть уже в выпрямленную сторону.
static const int8_t  JOINT_SIGN[JOINTS]   = { -1, +1, +1 };
static const int16_t JOINT_LIMIT[JOINTS]  = { 45, 45, 90 };
static const int16_t JOINT_OFFSET[JOINTS] = { +5, +5,  0 };

// Стенки в шагах от нуля оси. Индекс 0 — X (80 шагов = 1 мм),
// 1 — Y (26,667 шага = 1 мм). NO_WALL — стенки с этой стороны пока нет.
//
// Решение владельца от 27.09.2026 — как резерв в бензобаке: ноль там,
// где стоит стенка, а запас до упора уже с минусом. Дом — нижний левый
// угол: X вниз до упора, Y влево до упора, на уровне 1, стоп на первом
// звуке. Там ставится X = −756 (−9,45 мм) и Y = −222 (−8,3 мм): так
// упоры отмечены 27.09.2026, когда ноль брали у стенок.
//   X снизу  0 шагов      = 0,0 мм, упор на −9,45
//   X сверху +69200 шагов = +865,0 мм, решение владельца 27.09.2026:
//            упор на +870 (справа, один «тук» у стенки 870), запас 5 мм.
//            Утренний замер слева давал упор на +860,55 (пинг 873,0 минус
//            три «тук» по 0,8 мм) — слева вверху проверить на уровне 1.
//            В тот же вечер было +850,0, +860,0, +870,0
//   Y слева  0 шагов      = 0,0 мм, упор на −8,3
//   Y справа +15160 шагов = +568,5 мм, упор на +578,55 (пинг 590,55 минус
//            пять «тук» у упора, по 2,4 мм). Ход Y между упорами 586,9 мм
static const int32_t NO_WALL_MIN = INT32_MIN / 2;
static const int32_t NO_WALL_MAX = INT32_MAX / 2;
static const int32_t WALL_MIN[2] = { 0, 0 };
static const int32_t WALL_MAX[2] = { +69200, +15160 };

FastAccelStepperEngine engine = FastAccelStepperEngine();
FastAccelStepper *sx = NULL;
FastAccelStepper *sy = NULL;
SMS_STS st;

static bool   axisZero[2] = { false, false };  // ноль взят командой O
static int8_t axisDir[2]  = { 0, 0 };          // куда велено: +1, −1, 0
static bool   axisEdge[2] = { false, false };  // стоит у стенки

static FastAccelStepper *axisOf(int a) { return a == 0 ? sx : sy; }
static bool wallsOn(int a) { return axisZero[a]; }

static uint32_t lastRx   = 0;
static bool     stopped  = true;
static char     buf[64];   // «A cx cy x y ±1» длиннее 32
static int      bufLen   = 0;

static int32_t zeroTick[JOINTS] = { -1, -1, -1 };   // -1 — ноль ещё не взят
static int16_t targetDeg[JOINTS] = { 0, 0, 0 };

static path::Planner planner(PATH_ACCEL);
static bool     pathOn     = false;     // G дан, путь идёт
static bool     pathFirst  = false;     // первый такт: очереди наполнить, потом пустить разом
static bool     pathStopping = false;   // S или сторож: тормозим по пути, новых кусков не берём
static bool     pathDraining = false;   // последний такт отдан, моторы доезжают очередь
static long     cmdSteps[2] = { 0, 0 }; // куда уже велено, шаги
static int32_t  carry[2]    = { 0, 0 }; // недобор времени прошлого такта, тики
static float    paintMMs   = 20.0f;
static float    travelMMs  = 100.0f;
static uint32_t underruns  = 0;         // очередь мотора пустела на ходу
static uint32_t pathFaults = 0;         // путь остановлен сбоем очереди или сторожем побега
static uint32_t stopAt     = 0;         // когда пришёл S во время пути
static uint32_t retries    = 0;         // мотор ответил «занят» или «пауза на смену направления»
// Такт, который ещё не взяли обе оси: шаги каждой, кто уже взял, с какого
// момента ждём, и накопленные паузы на смену направления.
static long     sliceSteps[2]   = { 0, 0 };
static bool     slicePending[2] = { false, false };
static bool     sliceMore       = true;
static uint32_t sliceSince      = 0;
static uint32_t dirPause[2]     = { 0, 0 };
static const uint32_t SLICE_STALL_MS = 100;   // такт так долго не берётся — сбой
static char     lastFault[40] = "нет";  // причина последнего сбоя пути, для осмотра V

// Ложь, если ось упёрлась: к стенке дальше не едем, от неё — пожалуйста.
static bool drive(int a, int level) {
  FastAccelStepper *s = axisOf(a);
  if (s == NULL) return true;
  if (level == 0) { s->stopMove(); axisDir[a] = 0; return true; }

  if (wallsOn(a)) {
    int32_t p = s->getCurrentPosition();
    if ((level > 0 && p >= WALL_MAX[a]) || (level < 0 && p <= WALL_MIN[a])) {
      axisEdge[a] = true;
      return false;
    }
  }

  stopped = false;
  axisDir[a]  = level > 0 ? 1 : -1;
  axisEdge[a] = false;
  s->setSpeedInMilliHz((uint32_t)abs(level) * LEVEL_MHZ[a]);
  if (level > 0) s->runForward();
  else           s->runBackward();
  return true;
}

static void stopAll() {
  if (pathOn) {                                  // тормозим по пути, досылая такты
    if (!pathStopping) { planner.stopSoon(); pathStopping = true; stopAt = millis(); }
    return;
  }
  // куски лежат, а G не было — выбросить, чтобы следующий G не поехал по ним
  if (planner.running() && sx && sy)
    planner.clear(sx->getCurrentPosition() / STEPS_PER_MM[0], sy->getCurrentPosition() / STEPS_PER_MM[1]);
  if (sx) sx->stopMove();
  if (sy) sy->stopMove();
  axisDir[0] = axisDir[1] = 0;
  stopped = true;
}

// Резкий стоп: без торможения, мотор встаёт как вкопанный. Каретка
// по инерции может провернуть ремень на зуб-другой, тогда координата
// разойдётся с железом. Сомнение — взять ноль заново.
static void killAll() {
  if (sx) sx->forceStop();
  if (sy) sy->forceStop();
  if (pathOn || planner.running()) {
    pathOn = false; pathStopping = false; pathDraining = false;
    slicePending[0] = slicePending[1] = false;
    planner.clear(sx ? sx->getCurrentPosition() / STEPS_PER_MM[0] : 0,
                  sy ? sy->getCurrentPosition() / STEPS_PER_MM[1] : 0);
  }
  axisDir[0] = axisDir[1] = 0;
  stopped = true;
}

// Стенки. Тормозной путь известен заранее: как только место остановки
// дотянулось до края, начинаем тормозить и встаём у него, а не за ним.
static void guardWalls() {
  for (int a = 0; a < 2; a++) {
    FastAccelStepper *s = axisOf(a);
    if (s == NULL || axisDir[a] == 0 || !wallsOn(a)) continue;

    int32_t p = s->getCurrentPosition();
    int32_t v = s->getCurrentSpeedInMilliHz();
    int32_t d = (int32_t)s->stepsToStop();
    if ((axisDir[a] > 0 && v > 0 && p + d >= WALL_MAX[a]) ||
        (axisDir[a] < 0 && v < 0 && p - d <= WALL_MIN[a])) {
      s->stopMove();
      axisDir[a]  = 0;
      axisEdge[a] = true;
    }
  }
}

// Ноль оси здесь. Только стоя: на ходу счёт шагов ещё не досчитан.
// С числом — «каретка стоит на координате n»: так ноль переживает
// перезаливку прошивки, пока каретку никто не трогал.
static void zeroAxis(const char *line) {
  const char *p = line + 1;
  while (*p == ' ') p++;
  int a = (*p == 'X' || *p == 'x') ? 0 : (*p == 'Y' || *p == 'y') ? 1 : -1;
  if (a < 0) { Serial.println("? ось"); return; }
  long at = atol(p + 1);

  FastAccelStepper *s = axisOf(a);
  if (s == NULL) { Serial.println("? нет оси"); return; }
  if (s->isRunning()) { Serial.println("? едет, сначала стоп"); return; }

  s->setCurrentPosition((int32_t)at);
  axisZero[a] = true;
  axisEdge[a] = false;
  Serial.printf("ok O %c %ld\n", a == 0 ? 'X' : 'Y', at);
}

// Пинг заодно докладывает, где оси. «?» — ноль не взят, координаты нет.
// «край» — ось стоит у стенки.
static void ping() {
  char out[80];
  int  n = snprintf(out, sizeof(out), "ok P");
  for (int a = 0; a < 2; a++) {
    FastAccelStepper *s = axisOf(a);
    const char *name = a == 0 ? "X" : "Y";
    if (s == NULL || !axisZero[a]) {
      n += snprintf(out + n, sizeof(out) - n, " %s ?", name);
    } else {
      n += snprintf(out + n, sizeof(out) - n, " %s %ld%s", name,
                    (long)s->getCurrentPosition(), axisEdge[a] ? " край" : "");
    }
  }
  if (pathOn) n += snprintf(out + n, sizeof(out) - n, " путь %d", planner.count());
  Serial.println(out);
}

// Ноль берём с той позы, в которой серво стоит сейчас. Пока 12 В нет,
// серво не отвечает: тогда ноль остаётся невзятым и рука не поедет.
static bool takeZero(int j) {
  if (zeroTick[j] >= 0) return true;
  int pos = st.ReadPos(JOINT_ID[j]);
  if (pos < 0) return false;
  zeroTick[j] = pos;
  Serial.printf("ноль сустава %d: %d\n", JOINT_ID[j], pos);
  return true;
}

// Рука ходит одним пакетом на всю шину, даже если сдвинулся один сустав.
static void moveArm() {
  uint8_t ids[JOINTS];
  s16     pos[JOINTS];
  u16     spd[JOINTS];
  u8      acc[JOINTS];
  int     n = 0;

  for (int j = 0; j < JOINTS; j++) {
    if (zeroTick[j] < 0) continue;

    long tick = zeroTick[j] + lroundf(JOINT_SIGN[j] *
                (targetDeg[j] + JOINT_OFFSET[j]) * TICKS_PER_DEG);

    // Счёт позиции у STS идёт 0…4095 и по кругу. Упираемся в край,
    // а не перескакиваем через него на пол-оборота.
    if (tick < 0)    tick = 0;
    if (tick > 4095) tick = 4095;

    ids[n] = JOINT_ID[j];
    pos[n] = (s16)tick;
    spd[n] = MOVE_SPEED;
    acc[n] = MOVE_ACC;
    n++;
  }
  if (n) st.SyncWritePosEx(ids, n, pos, spd, acc);
}

// Ноль здесь. Рука не двигается: мы не командуем позу, а переписываем
// точку отсчёта под ту, в которой она уже стоит. Смещение JOINT_OFFSET
// вычитается, иначе сустав дёрнулся бы на эти градусы сразу после.
static void reZero() {
  stopAll();

  int done = 0;
  for (int j = 0; j < JOINTS; j++) {
    int raw = st.ReadPos(JOINT_ID[j]);
    if (raw < 0) continue;
    zeroTick[j]  = raw - lroundf(JOINT_SIGN[j] * JOINT_OFFSET[j] * TICKS_PER_DEG);
    targetDeg[j] = 0;
    done++;
  }
  Serial.printf("ok Z %d\n", done);
}

static void handleJoint(const char *line) {
  int j = 0, deg = 0;
  if (sscanf(line + 1, "%d %d", &j, &deg) != 2) { Serial.println("?"); return; }
  if (j < 1 || j > JOINTS) { Serial.println("? сустав"); return; }

  const int16_t lim = JOINT_LIMIT[j - 1];
  if (deg >  lim) deg =  lim;
  if (deg < -lim) deg = -lim;

  // Рельса и рука не работают вместе.
  stopAll();

  if (!takeZero(j - 1)) { Serial.printf("нет серво %d\n", j); return; }

  targetDeg[j - 1] = deg;
  moveArm();
  Serial.printf("ok J %d %d\n", j, deg);
}

// Смотр без движения. Серво питаются только от 12 В, от USB они мертвы,
// поэтому сам факт ответа доказывает, что питание на плате есть. Заодно
// серво работают вольтметром: ReadVoltage отдаёт десятые доли вольта.
//
// Ответ одной строкой: мост запоминает только последнюю строку от платы.
static void report() {
  char out[320];
  int  n = snprintf(out, sizeof(out), "ok V | X %s, Y %s | путь: пусто %lu, повторов %lu, сбоев %lu, последний: %s",
                    sx ? sx->driverTypeString() : "НЕТ", sy ? sy->driverTypeString() : "НЕТ",
                    (unsigned long)underruns, (unsigned long)retries, (unsigned long)pathFaults, lastFault);

  for (int j = 0; j < JOINTS; j++) {
    if (n < 0 || n >= (int)sizeof(out)) break;

    int pos = st.ReadPos(JOINT_ID[j]);
    if (pos < 0) {
      n += snprintf(out + n, sizeof(out) - n, " | %d: молчит", JOINT_ID[j]);
      continue;
    }
    int v = st.ReadVoltage(JOINT_ID[j]);
    int t = st.ReadTemper(JOINT_ID[j]);
    n += snprintf(out + n, sizeof(out) - n, " | %d: поза %d, %d,%d В, %d °C",
                  JOINT_ID[j], pos, v / 10, v % 10, t);
  }
  Serial.println(out);
}

// ---------- проход RUBENS ----------

static bool bothZero() { return sx && sy && axisZero[0] && axisZero[1]; }

// Точка внутри стенок, мм. Где стенки нет или ноль не взят — не проверяем.
static bool inside(float x, float y) {
  const float p[2] = { x, y };
  for (int a = 0; a < 2; a++) {
    if (!wallsOn(a)) continue;
    long st = lroundf(p[a] * STEPS_PER_MM[a]);
    if (st < WALL_MIN[a] || st > WALL_MAX[a]) return false;
  }
  return true;
}

// Кусок внутри стенок: конец, а у дуги ещё её крайние точки по осям.
// Начало не проверяем: это место, где каретка уже стоит (или конец
// прошлого куска, он проверен). У стенки после торможения каретка стоит
// чуть за ней, в запасе, и дом тоже в запасе; ехать оттуда внутрь можно.
static bool insideSeg(const path::Seg &g) {
  if (!inside(g.x1, g.y1)) return false;
  if (g.kind != 'A') return true;
  const float TAU = 6.2831853f;
  for (int k = 0; k < 4; k++) {
    float a = k * TAU / 4;
    float d = g.sweep > 0 ? fmodf(a - g.a0 + 2 * TAU, TAU) : fmodf(g.a0 - a + 2 * TAU, TAU);
    if (d < fabsf(g.sweep) && !inside(g.cx + g.r * cosf(a), g.cy + g.r * sinf(a))) return false;
  }
  return true;
}

static void handlePath(char c, const char *line) {
  const char *p = line + 1;
  if (c == 'F' || c == 'T') {
    float v = strtof(p, NULL);
    if (!(v >= 1 && v <= 200)) { Serial.println("? скорость 1…200 мм/с"); return; }
    if (c == 'F') paintMMs = v; else travelMMs = v;
    Serial.printf("ok %c %.1f\n", c, v);
    return;
  }
  if (c == 'G') {
    if (!planner.running()) { Serial.println("? очередь пуста"); return; }
    if (!pathOn) {
      pathOn = true; pathFirst = true; pathStopping = false; pathDraining = false; stopped = false;
      slicePending[0] = slicePending[1] = false; dirPause[0] = dirPause[1] = 0;
      cmdSteps[0] = sx->getCurrentPosition(); cmdSteps[1] = sy->getCurrentPosition();
      carry[0] = carry[1] = 0;
    }
    Serial.println("ok G");
    return;
  }
  // L, A, M — кусок в очередь
  if (!bothZero()) { Serial.println("? нет нуля осей"); return; }
  if (pathStopping) { Serial.println("? тормозим"); return; }
  if (!pathOn && (sx->isRunning() || sy->isRunning())) { Serial.println("? едет, сначала стоп"); return; }
  if (!planner.running())
    planner.setHere(sx->getCurrentPosition() / STEPS_PER_MM[0], sy->getCurrentPosition() / STEPS_PER_MM[1]);

  float v[5]; int n = 0;
  while (n < 5) { char *e; float f = strtof(p, &e); if (e == p) break; v[n++] = f; p = e; }
  const float x0 = planner.endX(), y0 = planner.endY();
  path::Seg g;
  if ((c == 'L' || c == 'M') && n == 2)
    g = path::line(x0, y0, v[0], v[1], c == 'L' ? paintMMs : travelMMs, c);
  else if (c == 'A' && n == 5 && (v[4] == 1 || v[4] == -1))
    g = path::arc(x0, y0, v[0], v[1], v[2], v[3], (int)v[4], paintMMs);
  else { Serial.println("?"); return; }

  if (g.len < 0.001f) { Serial.printf("ok %c %d\n", c, planner.room()); return; }   // пустой кусок
  if (!insideSeg(g))   { Serial.printf("край %c\n", c); return; }
  if (!planner.push(g)) { Serial.println("? очередь полна"); return; }
  Serial.printf("ok %c %d\n", c, planner.room());
}

// Такт пути. Пока в очередях моторов меньше трёх тактов вперёд, подкладываем
// следующий: точка пути → шаги каждой оси → moveTimed на одно время.
// Недобор времени (целые тики) переносим в следующий такт своей оси.
// Строк без спроса плата не пишет: мост помнит только последнюю строку;
// что путь кончился, видно по пингу.
// Сбой пути: встать сразу и сказать, почему. Строка без спроса — исключение:
// её увидит тот, кто пингует, а мост её запомнит.
static void pathFault(const char *why, int code) {
  killAll();
  pathFaults++;
  snprintf(lastFault, sizeof(lastFault), "%s %d", why, code);
  Serial.printf("? путь: %s %d\n", why, code);
}

static void pathTick() {
  if (!pathOn) return;
  FastAccelStepper *s[2] = { sx, sy };
  // Сторож побега: счёт не может уйти за стенку дальше запаса.
  for (int a = 0; a < 2; a++) {
    int32_t p = s[a]->getCurrentPosition();
    if (p < WALL_MIN[a] - RUNAWAY_STEPS[a] || p > WALL_MAX[a] + RUNAWAY_STEPS[a]) {
      pathFault(a == 0 ? "побег X" : "побег Y", (int)p);
      return;
    }
  }
  // S не довёл путь до стопа за разумное время — резкий стоп.
  if (pathStopping && millis() - stopAt > STOP_WAIT_MS) { pathFault("S не остановил", 0); return; }
  // Путь кончается, когда моторы доехали, а не когда отдан последний такт:
  // до этого пинг держит «путь», а рука и ползунки ждут.
  if (pathDraining) {
    if (!sx->isRunning() && !sy->isRunning()) {
      pathOn = false; pathDraining = false; pathStopping = false; stopped = true;
    }
    return;
  }
  // Подкладываем такты, пока у обеих осей меньше SLICES_AHEAD наперёд.
  // С FastAccelStepper 1.2.8 moveTimed() кладёт такт атомарно: целиком или
  // никак. Поэтому «занят», «не готов» и «пауза на смену направления» —
  // повторить тот же такт (паузу учесть во времени оси), и только ту ось,
  // что его ещё не взяла. План ждёт, пока возьмут обе. Такт, который не
  // берётся дольше SLICE_STALL_MS, и любая ошибка — резкий стоп.
  for (int n = 0; n < 8; n++) {
    if (!slicePending[0] && !slicePending[1]) {
      if (sx->ticksInQueue() >= SLICES_AHEAD * SLICE_TICKS || sy->ticksInQueue() >= SLICES_AHEAD * SLICE_TICKS ||
          sx->queueEntries() >= QUEUE_ROOM || sy->queueEntries() >= QUEUE_ROOM) return;
      float x, y;
      sliceMore = planner.step(SLICE_MS / 1000.0f, &x, &y);
      const long t[2] = { lroundf(x * STEPS_PER_MM[0]), lroundf(y * STEPS_PER_MM[1]) };
      for (int a = 0; a < 2; a++) {
        sliceSteps[a] = t[a] - cmdSteps[a];
        cmdSteps[a] = t[a];
        slicePending[a] = true;
      }
      sliceSince = millis();
    }
    for (int a = 0; a < 2; a++) {
      for (int k = 0; k < 4 && slicePending[a]; k++) {
        int32_t w = (int32_t)SLICE_TICKS + carry[a];
        uint32_t want = w > (int32_t)(SLICE_TICKS / 2) ? (uint32_t)w : SLICE_TICKS / 2, got = 0;
        MoveTimedResultCode r = s[a]->moveTimed((int16_t)sliceSteps[a], want, &got, !pathFirst);
        if (r == MoveTimedResultCode::DirChangePauseInjected || r == MoveTimedResultCode::DirPin2msPauseAdded) {
          dirPause[a] += got; retries++;           // пауза легла, такт — ещё нет: повторить сразу
          continue;
        }
        if (r == MOVE_TIMED_OK || r == MOVE_TIMED_EMPTY) {
          if (r == MOVE_TIMED_EMPTY && !pathFirst) underruns++;
          carry[a] = (int32_t)want - (int32_t)(got + dirPause[a]);
          dirPause[a] = 0;
          slicePending[a] = false;
          break;
        }
        if ((int8_t)r > 0) { retries++; break; }   // занят, не готов: на следующем круге
        pathFault(a == 0 ? "moveTimed X" : "moveTimed Y", (int)(int8_t)r);
        return;
      }
    }
    if (slicePending[0] || slicePending[1]) {
      if (millis() - sliceSince > SLICE_STALL_MS) pathFault("такт не берётся", slicePending[0] ? 0 : 1);
      return;
    }
    if (pathFirst) {               // обе очереди наполнены — пускаем разом
      sx->moveTimed(0, 0, NULL, true);
      sy->moveTimed(0, 0, NULL, true);
      pathFirst = false;
    }
    if (!sliceMore) { pathDraining = true; return; }
  }
}

static void handle(const char *line) {
  lastRx = millis();

  char c = line[0];
  if (c == 'S' || c == 's') { stopAll(); Serial.println("ok S"); return; }
  if (c == 'K' || c == 'k') { killAll(); Serial.println("ok K"); return; }
  if (c == 'P' || c == 'p') { ping(); return; }
  if (pathOn && (c == 'O' || c == 'o')) { Serial.println("? идёт путь, сначала S"); return; }
  if (c == 'O' || c == 'o') { zeroAxis(line); return; }
  if (c == 'V' || c == 'v') { report(); return; }
  if (strchr("FfTtLlAaMmGg", c)) { handlePath((char)toupper(c), line); return; }
  // Пока идёт путь: ни ползунков, ни руки, ни нулей. Сначала S.
  if (pathOn && strchr("XxYyJjOo", c)) { Serial.println("? идёт путь, сначала S"); return; }
  if (c == 'J' || c == 'j') { handleJoint(line); return; }
  if (c == 'Z' || c == 'z') { reZero(); return; }

  if (c == 'X' || c == 'x' || c == 'Y' || c == 'y') {
    int level = atoi(line + 1);
    const int lim = (c == 'X' || c == 'x') ? X_LEVEL_MAX : Y_LEVEL_MAX;
    if (level >  lim) level =  lim;
    if (level < -lim) level = -lim;

    const int  a    = (c == 'X' || c == 'x') ? 0 : 1;
    const char name = a == 0 ? 'X' : 'Y';
    if (drive(a, level)) Serial.printf("ok %c %d\n", name, level);
    else                 Serial.printf("край %c\n", name);
    return;
  }

  Serial.println("?");
}

void setup() {
  Serial.begin(115200);
  delay(300);

  engine.init();

  // Драйвер шагов — явно MCPWM/PCNT: на нём всё проверено, и его чинили в
  // FastAccelStepper 1.3.x; RMT считает шаги на ходу грубее.
  sx = engine.stepperConnectToPin(X_STEP, DRIVER_MCPWM_PCNT);
  // DIR у X перевёрнут 23.09.2026: без этого плюс вёз каретку назад.
  // Теперь плюс — вперёд, и счёт шагов растёт вперёд. Провода не трогали.
  if (sx) { sx->setDirectionPin(X_DIR, false); sx->setAcceleration(ACCEL); }

  sy = engine.stepperConnectToPin(Y_STEP, DRIVER_MCPWM_PCNT);
  if (sy) { sy->setDirectionPin(Y_DIR); sy->setAcceleration(ACCEL); }

  Serial1.begin(BUS_BAUD, SERIAL_8N1, S_RXD, S_TXD);
  st.pSerial = &Serial1;
  delay(200);

  lastRx = millis();

  Serial.println();
  Serial.println("Motor Brush — пульт машины");
  Serial.printf("X: STEP %d DIR %d  %s %s\n", X_STEP, X_DIR, sx ? "готов" : "НЕ ПОДКЛЮЧЁН", sx ? sx->driverTypeString() : "");
  Serial.printf("Y: STEP %d DIR %d  %s %s\n", Y_STEP, Y_DIR, sy ? "готов" : "НЕ ПОДКЛЮЧЁН", sy ? sy->driverTypeString() : "");
  Serial.printf("рука: шина на %d и %d\n", S_RXD, S_TXD);
  for (int j = 0; j < JOINTS; j++) {
    Serial.printf("  ID %d: знак %+d, предел +-%d, ноль смещён на %+d\n",
                  JOINT_ID[j], JOINT_SIGN[j], JOINT_LIMIT[j], JOINT_OFFSET[j]);
  }
  Serial.println("команды: X <-20..20>, Y <-9..9>, J <1..3> <град>, Z — ноль руки, O <X|Y> — ноль оси, S — стоп, K — резкий стоп");
  Serial.println("проход: F/T <мм/с>, L x y, A cx cy x y ±1, M x y, G — поехали");
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (bufLen) { buf[bufLen] = 0; handle(buf); bufLen = 0; }
    } else if (bufLen < (int)sizeof(buf) - 1) {
      buf[bufLen++] = ch;
    }
  }

  // Сторож: браузер закрыли, кабель выдернули, страница подвисла —
  // моторы не должны остаться крутиться сами по себе. Руку сторож не
  // трогает: серво держит позу, ронять её на холст нельзя.
  pathTick();
  guardWalls();

  if (!stopped && !pathStopping && millis() - lastRx > WATCHDOG_MS) {
    stopAll();
    Serial.println("стоп по сторожу");
  }
}
