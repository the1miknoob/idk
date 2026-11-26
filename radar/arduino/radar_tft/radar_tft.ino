// Portable Radar: a handheld, military-style radar on a 2.8" TFT screen shield
// (the ELEGOO 2.8" touch screen, or any "MCUFRIEND" style 2.8" shield with an ILI9341 chip).
//
// What it does:
//   - a servo sweeps an ultrasonic sensor across 150 degrees, painting a green radar picture
//   - echoes that belong together become numbered TRACKS (T01, T02...) with a square symbol
//   - it works out if each track is CLOSING (coming at you), OPENING (moving away) or HOLDING
//   - a track inside the alarm ring, or closing in near it, becomes a THREAT: red diamond + alarm beeps
//   - LOCK-ON: the most important track gets ACQUIRED (slow beeps), then LOCKED (fast, almost solid
//     tone and red brackets around it on the screen), like a fighter jet's radar
//   - a push button changes the range (50 cm / 1 m / 2 m / 4 m)
//   - it also sends "angle,distance" lines over USB, so the Radar page on the site works with it too
//
// Libraries (Arduino IDE: Tools -> Manage Libraries...): "MCUFRIEND_kbv" and "Adafruit GFX Library".
//
// The screen uses almost every pin, so the radar parts go on the few that are left.
// Reach them with a Proto Screw Shield between the Uno and the screen (each pin has a screw terminal):
//   HC-SR04 sensor:     VCC -> 5V, GND -> GND, Trig -> pin 11, Echo -> pin 12
//   SG90 servo:         brown -> GND, red -> 5V, orange -> pin 10
//   Buzzer (kit):       + -> pin 13, - -> GND
//   Push button (kit):  one side -> A5, the other side -> GND   (changes the range)
// Pins 10-13 are the screen's SD card slot, so leave the SD card out.
// A sweep takes about 5 seconds here (drawing the screen takes time), so tracks are kept a bit longer.
// Power it with a USB power bank (best) or a 9V battery on the barrel jack, so it's portable.

#include <Adafruit_GFX.h>
#include <MCUFRIEND_kbv.h>
#include <Servo.h>

// ✏️ EDIT: pins
const int SERVO_PIN  = 10;
const int TRIG_PIN   = 11;
const int ECHO_PIN   = 12;
const int BUZZER_PIN = 13;   // pin 13 also goes to the screen's SD slot, which is fine for an output
const int BUTTON_PIN = A5;   // A5 is the one pin the screen doesn't touch at all, so the button reads cleanly

// ✏️ EDIT: how it sweeps and warns
const int MIN_ANGLE     = 15;
const int MAX_ANGLE     = 165;
const int STEP          = 2;
const int STEP_DELAY_MS = 30;
const int ALARM_CM      = 50;     // a track this close is a THREAT
const bool SOUND        = true;
const int LOCK_CM       = 100;    // a confirmed track this close (or any THREAT) gets LOCKED
// The kit's buzzer is an "active" one (one fixed pitch): leave this true.
// With a passive buzzer (it can play different pitches) set it to false for real lock-on tones.
const bool ACTIVE_BUZZER = true;
const int RANGES[]      = { 50, 100, 200, 400 };   // the button steps through these (cm)
int rangeIdx            = 2;                        // start at 2 m

// Colors (RGB565)
const uint16_t COL_BLACK  = 0x0000;
const uint16_t COL_GREEN  = 0x07E0;
const uint16_t COL_TEXT   = 0x2FE6;
const uint16_t COL_DIM    = 0x0180;  // the painted area behind the sweep
const uint16_t COL_RING   = 0x0420;
const uint16_t COL_RED    = 0xF800;
const uint16_t COL_ORANGE = 0xFB00;
const uint16_t COL_YELLOW = 0xFFE0;
const uint16_t COL_WHITE  = 0xFFFF;

// Where the radar sits on the 320x240 screen
const int CX = 160, CY = 226, R = 150;

MCUFRIEND_kbv tft;
Servo servo;

const int STEPS = (MAX_ANGLE - MIN_ANGLE) / STEP + 1;
int dist[STEPS];               // the last reading at every step (0 = nothing)
int idx = 0, dir = 1;

// ---------- Tracks ----------
struct Track { bool used; uint8_t id; float x, y, vx, vy; unsigned long t; uint8_t hits; };
const int MAX_TRACKS = 6;
Track tracks[MAX_TRACKS];
uint8_t nextId = 1;

// Lock-on: SEARCH (nothing to follow), ACQUIRE (following a track), LOCKED (locked on)
enum LockState { SEARCH, ACQUIRE, LOCKED };
LockState lockState = SEARCH;
uint8_t lockId = 0;

// a blob = echoes next to each other in one sweep (one object)
bool inBlob = false;
float blobSumA = 0, blobSumCm = 0; int blobN = 0, blobLast = 0, blobMin = 0;

int rangeCm() { return RANGES[rangeIdx]; }

int readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);
  if (us == 0) return 0;
  int cm = us / 58;
  if (cm < 2 || cm > 400) return 0;
  return cm;
}

// A point on the radar: angle in degrees (0 = right, 90 = straight ahead), r in pixels
int px(float deg, float r) { return CX + (int)round(r * cos(deg * DEG_TO_RAD)); }
int py(float deg, float r) { return CY - (int)round(r * sin(deg * DEG_TO_RAD)); }

// Fill the slice of the radar between radius r0 and r1 around one angle
void wedge(float deg, float r0, float r1, uint16_t color) {
  float a = deg - STEP / 2.0 - 0.3, b = deg + STEP / 2.0 + 0.3;
  int x1 = px(a, r0), y1 = py(a, r0), x2 = px(b, r0), y2 = py(b, r0);
  int x3 = px(b, r1), y3 = py(b, r1), x4 = px(a, r1), y4 = py(a, r1);
  tft.fillTriangle(x1, y1, x2, y2, x3, y3, color);
  tft.fillTriangle(x1, y1, x3, y3, x4, y4, color);
}

// Redraw one step of the radar from what the sensor found there
void paintStep(int i) {
  float deg = MIN_ANGLE + i * STEP;
  int d = dist[i];
  if (d == 0 || d > rangeCm()) {
    wedge(deg, 0, R, COL_DIM);
  } else {
    float rd = (float)d * R / rangeCm();
    wedge(deg, 0, rd, COL_DIM);
    wedge(deg, rd, R, d <= ALARM_CM ? COL_RED : COL_ORANGE);   // the area hidden behind the object
  }
  // put the range rings (and the dashed alarm ring) back where the slice covered them
  for (int k = 1; k <= 4; k++) {
    float rr = R * k / 4.0;
    for (float t = deg - STEP / 2.0 - 0.3; t <= deg + STEP / 2.0 + 0.3; t += 0.4)
      tft.drawPixel(px(t, rr), py(t, rr), COL_RING);
  }
  if (ALARM_CM < rangeCm() && ((int)deg / 4) % 2 == 0) {
    float ra = (float)ALARM_CM * R / rangeCm();
    for (float t = deg - STEP / 2.0; t <= deg + STEP / 2.0; t += 0.5) tft.drawPixel(px(t, ra), py(t, ra), COL_RED);
  }
}

void drawFrame() {
  tft.fillScreen(COL_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(COL_RING);
  for (int k = 1; k <= 4; k++) {
    float rr = R * k / 4.0;
    for (float t = 0; t <= 180; t += 0.25) tft.drawPixel(px(t, rr), py(t, rr), COL_RING);
    int v = rangeCm() * k / 4;
    tft.setCursor(CX + (int)rr - 12, CY + 4);
    if (v >= 100 && v % 100 == 0) { tft.print(v / 100); tft.print("m"); } else { tft.print(v); tft.print("cm"); }
  }
  tft.drawFastHLine(CX - R, CY, 2 * R + 1, COL_RING);
  for (int a = 30; a <= 150; a += 30) tft.drawLine(CX, CY, px(a, R), py(a, R), COL_RING);
  // title bar
  tft.fillRect(0, 0, 320, 18, 0x0120);
  tft.setTextSize(2);
  tft.setTextColor(COL_GREEN);
  tft.setCursor(4, 2);
  tft.print("PORTABLE RADAR");
  tft.setTextSize(1);
  tft.setTextColor(COL_TEXT, 0x0120);
  tft.setCursor(250, 6);
  tft.print("RNG ");
  if (rangeCm() >= 100) { tft.print(rangeCm() / 100); tft.print("M  "); } else { tft.print(rangeCm()); tft.print("CM"); }
}

// ---------- Tracking ----------
void drawTrackSymbol(Track &t, bool threat) {
  float d = sqrt(t.x * t.x + t.y * t.y);
  if (d > rangeCm()) return;
  float ang = atan2(t.y, t.x) * RAD_TO_DEG;
  if (ang < 0 || ang > 180) return;
  int x = px(ang, d * R / rangeCm()), y = py(ang, d * R / rangeCm());
  uint16_t c = threat ? COL_RED : (t.hits < 2 ? COL_TEXT : COL_YELLOW);
  if (threat) {
    tft.drawLine(x, y - 8, x + 8, y, c); tft.drawLine(x + 8, y, x, y + 8, c);
    tft.drawLine(x, y + 8, x - 8, y, c); tft.drawLine(x - 8, y, x, y - 8, c);
  } else {
    tft.drawRect(x - 6, y - 6, 13, 13, c);
  }
  if (lockState == LOCKED && t.id == lockId) {   // lock brackets: four red corners around the target
    const int b = 12, l = 5;
    tft.drawFastHLine(x - b, y - b, l, COL_RED); tft.drawFastVLine(x - b, y - b, l, COL_RED);
    tft.drawFastHLine(x + b - l + 1, y - b, l, COL_RED); tft.drawFastVLine(x + b, y - b, l, COL_RED);
    tft.drawFastHLine(x - b, y + b, l, COL_RED); tft.drawFastVLine(x - b, y + b - l + 1, l, COL_RED);
    tft.drawFastHLine(x + b - l + 1, y + b, l, COL_RED); tft.drawFastVLine(x + b, y + b - l + 1, l, COL_RED);
  }
  tft.setTextSize(1);
  tft.setTextColor(c);
  tft.setCursor(x + 14, y - 3);
  tft.print('T');
  if (t.id < 10) tft.print('0');
  tft.print(t.id);
}

// moving toward you (cm/s, negative = closer)
float radialSpeed(Track &t) {
  float d = sqrt(t.x * t.x + t.y * t.y);
  return d > 0 ? (t.x * t.vx + t.y * t.vy) / d : 0;
}
bool isThreat(Track &t) {
  if (t.hits < 2) return false;
  float d = sqrt(t.x * t.x + t.y * t.y);
  return d <= ALARM_CM || (radialSpeed(t) < -10 && d <= ALARM_CM * 2.5);
}

void blobEnd();   // below

void blobFeed(float deg, int cm) {
  bool hit = cm > 0;
  if (inBlob && (!hit || abs(cm - blobLast) > 30)) blobEnd();
  if (hit) {
    if (!inBlob) { inBlob = true; blobSumA = 0; blobSumCm = 0; blobN = 0; blobMin = cm; }
    blobSumA += deg; blobSumCm += cm; blobN++; blobLast = cm;
    if (cm < blobMin) blobMin = cm;
  }
}

void blobEnd() {
  if (!inBlob) return;
  inBlob = false;
  if (blobN < 1) return;
  float a = blobSumA / blobN * DEG_TO_RAD, cm = (blobSumCm / blobN + blobMin) / 2;
  float x = cm * cos(a), y = cm * sin(a);
  unsigned long now = millis();
  // match it to the closest predicted track
  int best = -1; float bd = 70;
  for (int i = 0; i < MAX_TRACKS; i++) {
    if (!tracks[i].used) continue;
    float dt = (now - tracks[i].t) / 1000.0;
    float ex = tracks[i].x + tracks[i].vx * dt, ey = tracks[i].y + tracks[i].vy * dt;
    float d = sqrt((ex - x) * (ex - x) + (ey - y) * (ey - y));
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) {
    Track &t = tracks[best];
    float dt = (now - t.t) / 1000.0;
    if (dt < 0.4) { t.x = (t.x + x) / 2; t.y = (t.y + y) / 2; t.t = now; }
    else {
      float ex = t.x + t.vx * dt, ey = t.y + t.vy * dt, rx = x - ex, ry = y - ey;
      t.x = ex + 0.65 * rx; t.y = ey + 0.65 * ry;
      t.vx = constrain(t.vx + 0.35 * rx / dt, -300, 300);
      t.vy = constrain(t.vy + 0.35 * ry / dt, -300, 300);
      t.t = now; if (t.hits < 250) t.hits++;
    }
    drawTrackSymbol(t, isThreat(t));
  } else {
    for (int i = 0; i < MAX_TRACKS; i++) {
      if (tracks[i].used) continue;
      tracks[i] = { true, nextId, x, y, 0, 0, now, 1 };
      nextId = nextId % 99 + 1;
      drawTrackSymbol(tracks[i], false);
      break;
    }
  }
}

void dropOldTracks() {
  unsigned long now = millis();
  for (int i = 0; i < MAX_TRACKS; i++)
    if (tracks[i].used && now - tracks[i].t > (tracks[i].hits < 2 ? 12000UL : 16000UL)) tracks[i].used = false;
}

// ---------- Buzzer ----------
// Works with the kit's active buzzer (switch it on and off) or a passive one (play a pitch).
bool buzzOn = false;
unsigned long buzzAt = 0, beepOffAt = 0;
void buzz(bool on, int freq) {
  if (!SOUND) on = false;
  if (on == buzzOn) return;
  buzzOn = on; buzzAt = millis();
  if (ACTIVE_BUZZER) digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
  else if (on) tone(BUZZER_PIN, freq); else noTone(BUZZER_PIN);
}
void beep(int ms, int freq) { buzz(true, freq); beepOffAt = millis() + ms; }

// called every step: the lock-on sounds
void lockSound() {
  unsigned long now = millis();
  if (beepOffAt && now >= beepOffAt) { beepOffAt = 0; buzz(false, 0); }
  if (beepOffAt) return;                                   // a one-off beep is playing
  if (lockState == ACQUIRE) {                              // slow beeps: following a target
    if (!buzzOn && now - buzzAt >= 500) beep(60, 1000);
  } else if (lockState == LOCKED) {                        // fast, almost solid tone: locked on
    if (buzzOn && now - buzzAt >= 250) buzz(false, 0);
    else if (!buzzOn && now - buzzAt >= 40) buzz(true, 1800);
  } else if (buzzOn) buzz(false, 0);
}

float trackDist(Track &t) { return sqrt(t.x * t.x + t.y * t.y); }

// Pick the track to follow (threats first, then the closest confirmed one) and work out the lock state
int updateLock() {
  int target = -1; float best = 1e9;
  for (int i = 0; i < MAX_TRACKS; i++) {
    if (!tracks[i].used || tracks[i].hits < 2 || trackDist(tracks[i]) > rangeCm()) continue;
    float score = trackDist(tracks[i]) - (isThreat(tracks[i]) ? 10000 : 0) - (tracks[i].id == lockId ? 30 : 0);   // stick with the current target
    if (score < best) { best = score; target = i; }
  }
  LockState was = lockState;
  if (target < 0) lockState = SEARCH;
  else {
    Track &t = tracks[target];
    lockId = t.id;
    lockState = (isThreat(t) || (t.hits >= 3 && trackDist(t) <= LOCK_CM)) ? LOCKED : ACQUIRE;
  }
  if (lockState == LOCKED && was != LOCKED) {
    Serial.print("# LOCK T"); Serial.println(lockId);
    drawTrackSymbol(tracks[target], isThreat(tracks[target]));   // draw the brackets straight away
  }
  if (was == LOCKED && lockState != LOCKED) { buzz(false, 0); beep(200, 400); Serial.println("# LOCK LOST"); }   // low beep: lock lost
  return target;
}

// ---------- The text lines at the top ----------
void drawInfo(int deg, int d) {
  char buf[60];
  int count = 0;
  for (int i = 0; i < MAX_TRACKS; i++) if (tracks[i].used) count++;
  int target = updateLock();

  tft.setTextSize(1);
  tft.setTextColor(COL_TEXT, COL_BLACK);
  tft.setCursor(4, 24);
  snprintf(buf, sizeof buf, "BRG %03d   ECHO ", deg);
  tft.print(buf);
  if (d > 0) snprintf(buf, sizeof buf, "%3dCM", d); else snprintf(buf, sizeof buf, " --- ");
  tft.print(buf);
  snprintf(buf, sizeof buf, "   TRK %d ", count);
  tft.print(buf);

  // lock status (blinks when locked)
  tft.setCursor(226, 24);
  if (lockState == LOCKED) {
    snprintf(buf, sizeof buf, ">> LOCK T%02d <<", lockId);
    if ((millis() / 300) % 2 == 0) tft.setTextColor(COL_WHITE, COL_RED); else tft.setTextColor(COL_RED, COL_BLACK);
  } else if (lockState == ACQUIRE) {
    snprintf(buf, sizeof buf, " ACQUIRE T%02d  ", lockId);
    tft.setTextColor(COL_YELLOW, COL_BLACK);
  } else {
    snprintf(buf, sizeof buf, "  SEARCHING   ");
    tft.setTextColor(COL_TEXT, COL_BLACK);
  }
  tft.print(buf);

  // the target (or "scanning")
  tft.setCursor(4, 38);
  if (target >= 0) {
    Track &t = tracks[target];
    float dd = trackDist(t), rs = radialSpeed(t), sp = sqrt(t.vx * t.vx + t.vy * t.vy);
    const char *st = rs < -10 ? "CLOSING " : rs > 10 ? "OPENING " : sp > 10 ? "CROSSING" : "HOLDING ";
    int brg = (int)(atan2(t.y, t.x) * RAD_TO_DEG);
    snprintf(buf, sizeof buf, "T%02d %s RNG %3dCM BRG %03d SPD %3dCM/S  ", t.id, st, (int)dd, brg, (int)sp);
    tft.setTextColor(isThreat(t) ? COL_RED : COL_YELLOW, COL_BLACK);
  } else {
    snprintf(buf, sizeof buf, "SCANNING... NO TRACKS                          ");
    tft.setTextColor(COL_TEXT, COL_BLACK);
  }
  tft.print(buf);
  lockSound();
}

// ---------- Range button ----------
bool lastBtn = HIGH; unsigned long btnAt = 0;
void checkButton() {
  bool b = digitalRead(BUTTON_PIN);
  if (b != lastBtn && millis() - btnAt > 60) {
    btnAt = millis(); lastBtn = b;
    if (b == LOW) {
      rangeIdx = (rangeIdx + 1) % 4;
      for (int i = 0; i < STEPS; i++) dist[i] = 0;
      drawFrame();
      beep(30, 2400);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);

  uint16_t id = tft.readID();
  if (id == 0xD3D3) id = 0x9486;                    // some shields can't be read; this is the usual fix
  if (id == 0x0000 || id == 0xFFFF) id = 0x9341;    // couldn't tell: the ELEGOO 2.8" screen uses an ILI9341
  tft.begin(id);
  tft.setRotation(1);              // landscape: 320 x 240
  drawFrame();

  servo.attach(SERVO_PIN);
  servo.write(MIN_ANGLE);
  delay(500);
  Serial.println("# Portable Radar ready");
}

void loop() {
  checkButton();

  int deg = MIN_ANGLE + idx * STEP;
  servo.write(deg);
  delay(STEP_DELAY_MS);
  lockSound();
  int d = readDistanceCm();
  dist[idx] = d;

  Serial.print(deg);
  Serial.print(',');
  Serial.println(d);

  // repaint the last step (this rubs out the old bright sweep line), then this step, then the new sweep line
  int prev = idx - dir;
  if (prev >= 0 && prev < STEPS) paintStep(prev);
  paintStep(idx);
  tft.drawLine(CX, CY, px(deg, R), py(deg, R), COL_GREEN);

  blobFeed(deg, d);
  dropOldTracks();
  drawInfo(deg, d);

  idx += dir;
  if (idx >= STEPS - 1) { idx = STEPS - 1; dir = -1; blobEnd(); }
  if (idx <= 0) { idx = 0; dir = 1; blobEnd(); }
}
