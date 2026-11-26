// Arduino Radar
// A servo swings an ultrasonic sensor back and forth like a radar dish. At every step the sensor
// measures how far away the nearest thing is, and the Arduino sends it to the computer as a line
// of text: "angle,distance" (degrees, centimeters; 0 means nothing was found).
// Open the Radar page on the site in Chrome or Edge, press "Connect", and watch the screen.
//
// Wiring (the full guide is on the Radar page):
//   HC-SR04 sensor: VCC -> 5V, GND -> GND, Trig -> pin 10, Echo -> pin 11
//   SG90 servo:     brown -> GND, red -> 5V, orange -> pin 12
//   Buzzer (kit):   + (longer leg) -> pin 8, - -> GND                 (optional)
//   Red LED (kit):  long leg -> 220 ohm resistor -> pin 7, short leg -> GND   (optional)

#include <Servo.h>

// ✏️ EDIT: pins
const int TRIG_PIN   = 10;
const int ECHO_PIN   = 11;
const int SERVO_PIN  = 12;
const int BUZZER_PIN = 8;
const int LED_PIN    = 7;

// ✏️ EDIT: how it sweeps
const int MIN_ANGLE     = 15;   // the servo turns from here...
const int MAX_ANGLE     = 165;  // ...to here and back
const int STEP          = 2;    // degrees per step
const int STEP_DELAY_MS = 30;   // time for the servo to move one step (smaller = faster sweep)
const int MAX_CM        = 400;  // the HC-SR04 can't see further than about 4 meters

int alarmCm = 50;               // beep and light the LED when something is this close (the page can change it)
bool beepOn = true;             // the page can turn the beeping off

Servo servo;
int angle = MIN_ANGLE;
int dir = 1;

// Send a sound pulse and time how long the echo takes to come back
int readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);  // give up after 25 ms (about 4.3 m)
  if (us == 0) return 0;                                // no echo: nothing there
  int cm = us / 58;                                     // sound goes there and back at about 343 m/s
  if (cm < 2 || cm > MAX_CM) return 0;
  return cm;
}

// Messages from the Radar page: "A30" sets the alarm to 30 cm, "B0" / "B1" turns beeping off / on
void readCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'A') {
      int v = Serial.parseInt();
      if (v >= 0 && v <= MAX_CM) alarmCm = v;
    } else if (c == 'B') {
      beepOn = Serial.parseInt() != 0;
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  servo.attach(SERVO_PIN);
  servo.write(angle);
  delay(500);
  Serial.println("# Arduino Radar ready");
}

void loop() {
  readCommands();

  servo.write(angle);
  delay(STEP_DELAY_MS);
  int cm = readDistanceCm();

  Serial.print(angle);
  Serial.print(',');
  Serial.println(cm);

  bool isClose = cm > 0 && cm <= alarmCm;
  digitalWrite(LED_PIN, isClose ? HIGH : LOW);
  if (isClose && beepOn) tone(BUZZER_PIN, 1800, 25);

  // next step, turning around at the ends
  angle += STEP * dir;
  if (angle >= MAX_ANGLE) { angle = MAX_ANGLE; dir = -1; }
  if (angle <= MIN_ANGLE) { angle = MIN_ANGLE; dir = 1; }
}
