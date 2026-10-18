#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================================
;  TDS Boomerang Hardcore macro - Tower Defense Simulator (Roblox)
;
;  Plays the "Boomerang Hardcore wave 29" gem / tower EXP grind on
;  Wretched Front (Hardcore) again and again:
;    3 farms -> boomerang -> 10 lvl 3 farms -> 5 crook bosses (lvl 2)
;    -> 5 lvl 3 boomerangs -> 3 lvl 3 crook bosses -> max the boomerangs
;  until you lose (around wave 29), then it starts the next run.
;
;  In Roblox:
;    F1  setup (show the macro where everything is)   F2  start
;    F3  pause / resume                               F4  stop
;    F6  save the end screen's "play again" button    (Shift+F6: a 2nd button)
;    F7  show the saved spots                         Ctrl+F4  close the macro
;
;  Hotbar like in the video: 1 = Boomerang, 2 = Crook Boss, 3 = Farm.
;  Keys and timings can be changed in tds_boomerang_macro.ini (made on first run).
; ============================================================================

GroupAdd "Roblox", "ahk_exe RobloxPlayerBeta.exe"
GroupAdd "Roblox", "ahk_exe Windows10Universal.exe"

CoordMode "Mouse", "Client"
CoordMode "Pixel", "Client"
SetDefaultMouseSpeed 0
A_IconTip := "TDS Boomerang Hardcore macro"

INI_FILE := A_ScriptDir "\tds_boomerang_macro.ini"
LOG_FILE := A_ScriptDir "\tds_boomerang_macro_log.txt"

TOWERS := Map("farm", "Farm", "boomerang", "Boomerang", "crook", "Crook Boss")
TOWER_ORDER := ["farm", "boomerang", "crook"]
SPOT_COUNT := Map("farm", 10, "boomerang", 5, "crook", 5)
HOTBAR_SETTING := Map("farm", "FarmKey", "boomerang", "BoomerangKey", "crook", "CrookKey")
MARKER_COLOR := Map("farm", "1E7D46", "boomerang", "B03A2E", "crook", "6C3483")
MARKER_TAG := Map("farm", "F", "boomerang", "B", "crook", "C")
SPOT_HINT := Map(
    "farm", "Farms can go anywhere off the path - a tidy block (2 rows of 5) like in the video works well.",
    "boomerang", "Put Boomerangs right next to the path, where it bends a lot (the middle of the map).",
    "crook", "Put Crook Bosses next to the path too. They're big, so leave room around them."
)

DEFAULTS := Map(
    "BoomerangKey", "1",
    "CrookKey", "2",
    "FarmKey", "3",
    "UpgradeKey", "e",
    "CancelKey", "q",
    "SpeedClicks", "1",
    "ZoomOutNotches", "0",
    "StepTimeoutSec", "240",
    "RestartDelaySec", "3"
)

; Pixels checked around every saved point (a small plus shape)
CROSS := [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]

; ----------------------------------------------------------------------------
;  The strategy, top to bottom. Each step waits until you can afford it.
;    speed                         click the game speed button (x2)
;    ready                         press READY (starts wave 1)
;    place <tower> <n>             place tower n on its saved spot
;    upgrade <tower> <n> <level>   upgrade tower n up to that level
;    max <tower> [<tower> ...]     keep upgrading these until the run ends
;    wait <seconds>
;  <tower> is farm, boomerang or crook.
; ----------------------------------------------------------------------------
BUILD_ORDER := "
(
; wave 0: x2 speed and 3 farms, then start
speed
place farm 1
place farm 2
place farm 3
ready

; waves 1-6: farms to lvl 1-2 and the first boomerang
upgrade farm 1 1
upgrade farm 2 1
upgrade farm 3 1
upgrade farm 1 2
upgrade farm 2 2
place boomerang 1
upgrade farm 3 2
upgrade boomerang 1 1
place farm 4
upgrade farm 4 2
upgrade boomerang 1 2
place farm 5
upgrade farm 5 1

; waves 7-12: lvl 3 farms, lvl 3 boomerang, first crook boss
upgrade farm 1 3
upgrade farm 2 3
place farm 6
upgrade boomerang 1 3
upgrade farm 3 3
place crook 1
upgrade crook 1 2

; waves 13-15: place all the other farms, everything to lvl 3
upgrade farm 4 3
upgrade farm 5 3
upgrade farm 6 3
place farm 7
upgrade farm 7 3
place farm 8
upgrade farm 8 3
place farm 9
upgrade farm 9 3
place farm 10
upgrade farm 10 3

; waves 15-19: the other crook bosses to lvl 2, a 2nd lvl 3 boomerang
place crook 2
upgrade crook 2 2
place boomerang 2
upgrade boomerang 2 3
place crook 3
upgrade crook 3 2
place crook 4
upgrade crook 4 2
place crook 5
upgrade crook 5 2

; waves 19-22: 3 more lvl 3 boomerangs
place boomerang 3
upgrade boomerang 3 3
place boomerang 4
upgrade boomerang 4 3
place boomerang 5
upgrade boomerang 5 3

; waves 22-24: 3 lvl 3 crook bosses
upgrade crook 1 3
upgrade crook 2 3
upgrade crook 3 3

; wave 25+: max out the boomerangs until you lose
max boomerang
)"

Mac := {
    running: false, inSetup: false, stop: false, paused: false,
    capture: "", capX: 0, capY: 0, prompt: "",
    cfg: Map(), pts: Map(), spots: Map(), steps: [],
    placed: Map(), readyDone: false, selKey: "", pathOk: false, hasEnd: false,
    timeout: 240000, lastCheck: 0, readySeen: 0, endSeen: 0, failedSelects: 0, deadChecks: 0,
    runs: 0, markers: [], statusGui: "", statusText: "", lastStatus: ""
}

class StopSignal extends Error {
}
class GameOverSignal extends Error {
}
class NewMatchSignal extends Error {
}

LoadSettings()
OnExit(ReleaseKeys)
TrayTip "In Roblox press F1 for setup, F2 to start, F3 to pause, F4 to stop.", "TDS Boomerang Hardcore macro"

#HotIf WinActive("ahk_group Roblox")
F1::RunSetup()
F2::StartMacro()
F3::TogglePause()
F4::StopMacro()
F6::CaptureEndButton("end1")
+F6::CaptureEndButton("end2")
F7::ShowSpots()
F8::Capture("ok")
F9::Capture("skip")
^F4::ExitApp()
#HotIf

; ============================================================================
;  Running the strategy
; ============================================================================

StartMacro() {
    if Mac.running || Mac.inSetup
        return
    if !LoadAll()
        return
    Mac.running := true, Mac.stop := false, Mac.paused := false, Mac.runs := 0
    Log("=== macro started ===")
    try {
        loop {
            WaitForMatchStart()
            Mac.runs++
            Log("--- run " Mac.runs " ---")
            try {
                RunStrategy()
            } catch GameOverSignal as e {
                Log("run " Mac.runs " is over (" e.Message ")")
                if Mac.hasEnd
                    ClickRestart()
            } catch NewMatchSignal {
                Log("a new match started")
            }
        }
    } catch StopSignal {
        Log("stopped")
    } finally {
        ReleaseKeys()
        Mac.running := false
        HideStatus()
    }
}

RunStrategy() {
    Mac.placed := Map()
    for kind in TOWER_ORDER
        Mac.placed[kind] := Map()
    Mac.readyDone := false, Mac.selKey := "", Mac.failedSelects := 0
    Mac.readySeen := 0, Mac.endSeen := 0, Mac.deadChecks := 0
    UserSleep(1500)
    ZoomOut()
    for step in Mac.steps {
        CheckAbort()
        a := step.args
        Log("step: " step.text)
        switch step.cmd {
            case "speed": PressSpeed()
            case "ready": PressReady()
            case "place": PlaceTower(a[1], Integer(a[2]))
            case "upgrade": UpgradeTower(a[1], Integer(a[2]), Integer(a[3]))
            case "max": MaxOut(a)
            case "wait": SleepChecked(a[1] * 1000)
        }
    }
    if !Mac.readyDone
        PressReady()
    loop {
        Status("build order done - waiting for the run to end")
        SleepChecked(1000)
    }
}

WaitForMatchStart() {
    Mac.readyDone := false
    lastClick := A_TickCount
    MoveAway()
    loop {
        CheckUser()
        if LooksSaved(Mac.pts["ready"]) {
            Status("match found - starting")
            return
        }
        ; still on the end screen: press play again once more now and then
        if Mac.hasEnd && LooksSaved(Mac.pts["end1"]) && A_TickCount - lastClick > 10000 {
            ClickRestart()
            lastClick := A_TickCount
        }
        Status("waiting for a match at wave 0 (the READY button)...")
        Sleep 700
    }
}

PressSpeed() {
    if !Mac.pts.Has("speed")
        return
    p := Mac.pts["speed"]
    loop Integer(Mac.cfg["SpeedClicks"]) {
        Status("setting the game speed")
        ClickAt(p.x, p.y)
        Sleep 400
    }
    MoveAway()
}

PressReady() {
    p := Mac.pts["ready"]
    loop 3 {
        CheckUser()
        MoveAway()
        Sleep 300
        if !LooksSaved(p)
            break
        Status("pressing READY")
        ClickAt(p.x, p.y)
        Sleep 2000
    }
    MoveAway()
    Mac.readyDone := true
}

PlaceTower(kind, n) {
    if n > Mac.spots[kind].Length {
        Log("no spot saved for " kind " " n " - skipped")
        return
    }
    spot := Mac.spots[kind][n]
    key := Mac.cfg[HOTBAR_SETTING[kind]]
    nudges := [[0, 0], [15, 0], [-15, 0], [0, 15], [0, -15], [22, 22], [-22, 22], [22, -22], [-22, -22]]
    tryNo := 1
    start := lastAlive := A_TickCount
    ; before READY your cash can't go up, so don't wait long for it
    limit := Mac.readyDone ? Mac.timeout : 8000
    Deselect()
    loop {
        CheckAbort()
        if A_TickCount - start > limit {
            Log("gave up on placing " kind " " n " (not enough cash?)")
            return
        }
        if A_TickCount - lastAlive > 15000 {
            AliveCheck()
            lastAlive := A_TickCount
        }
        x := spot.x + nudges[tryNo][1], y := spot.y + nudges[tryNo][2]
        Status("placing " TOWERS[kind] " #" n)
        MouseMove x, y, 0
        Sleep 60
        PressKey(key)
        Sleep 300
        if Mac.pathOk {
            ; the path lights up red while you hold a tower; if it doesn't, the tower isn't affordable yet
            if !IsPlacing() {
                PressKey(Mac.cfg["CancelKey"])
                Sleep 700
                continue
            }
            ClickAt(x, y)
            Sleep 450
            if IsPlacing() {
                ; still holding the tower = the spot was refused (or the click got lost)
                PressKey(Mac.cfg["CancelKey"])
                Sleep 250
                if SelectAt(x, y)
                    break
                if ++tryNo > nudges.Length {
                    Log("couldn't place " kind " " n " - the spot seems blocked")
                    Deselect()
                    return
                }
                continue
            }
        } else {
            ; no path check saved: place, then see if a tower menu opens there
            ClickAt(x, y)
            Sleep 400
            PressKey(Mac.cfg["CancelKey"])
            Sleep 200
            if !SelectAt(x, y) {
                Sleep 800
                continue
            }
        }
        break
    }
    Mac.placed[kind][n] := {x: x, y: y, level: 0}
    if tryNo > 1 {
        ; remember the spot that worked for the next runs
        spot.x := x, spot.y := y
        try IniWrite x "," y, INI_FILE, "Points", kind n
        Log("moved the " kind " " n " spot a little so it fits")
    }
    Log("placed " kind " " n)
    Deselect()
}

UpgradeTower(kind, n, target) {
    if !Mac.placed[kind].Has(n) {
        Log(kind " " n " isn't placed - upgrade skipped")
        return
    }
    t := Mac.placed[kind][n]
    key := kind n
    start := lastAlive := A_TickCount
    misses := 0
    while t.level < target {
        CheckAbort()
        if A_TickCount - start > Mac.timeout {
            Log("gave up on " kind " " n " lvl " target " (it's lvl " t.level ")")
            break
        }
        if A_TickCount - lastAlive > 20000 {
            AliveCheck()
            lastAlive := A_TickCount
        }
        Status("upgrading " TOWERS[kind] " #" n " to lvl " (t.level + 1) " (goal: lvl " target ")")
        if Mac.selKey != key || !PanelOpen() {
            if !SelectAt(t.x, t.y, key, true) {
                if ++misses >= 8 {
                    Log("couldn't open the menu of " kind " " n " - upgrade skipped")
                    break
                }
                Sleep 400
                continue
            }
        }
        if !CanUpgrade() {
            Sleep 250
            continue
        }
        PressKey(Mac.cfg["UpgradeKey"])
        t.level++
        Log(kind " " n " -> lvl " t.level)
        ; give the menu time to show the next upgrade, so it isn't bought twice
        Sleep 700
    }
    Deselect()
}

MaxOut(types) {
    loop {
        for kind in types {
            for n, t in Mac.placed[kind] {
                CheckAbort()
                Status("maxing out " TOWERS[kind] " #" n " (lvl " t.level ")")
                if !SelectAt(t.x, t.y, kind n, true)
                    continue
                if CanUpgrade() {
                    PressKey(Mac.cfg["UpgradeKey"])
                    t.level++
                    Log(kind " " n " -> lvl " t.level)
                    Sleep 700
                }
            }
        }
        Deselect()
        SleepChecked(500)
    }
}

; Without a saved end screen button this is how a finished run is spotted:
; none of your towers open their menu any more (checked while waiting for cash)
AliveCheck() {
    if Mac.hasEnd
        return
    mine := []
    for kind in TOWER_ORDER
        for n, t in Mac.placed[kind]
            mine.Push(t)
    if !mine.Length
        return
    loop Min(3, mine.Length) {
        t := mine[A_Index]
        if SelectAt(t.x, t.y) {
            Deselect()
            Mac.deadChecks := 0
            return
        }
    }
    Mac.deadChecks += 1
    if Mac.deadChecks >= 2
        throw GameOverSignal("tower menus stopped opening")
}

ClickRestart() {
    Status("run over - pressing play again")
    UserSleep(Integer(Mac.cfg["RestartDelaySec"]) * 1000)
    p := Mac.pts["end1"]
    ClickAt(p.x, p.y)
    if Mac.pts.Has("end2") {
        UserSleep(2000)
        p := Mac.pts["end2"]
        ClickAt(p.x, p.y)
    }
    MoveAway()
}

; ----------------------------------------------------------------------------
;  Stop / pause / game-over checks
; ----------------------------------------------------------------------------

; Stops for F4, waits while paused (F3) or while Roblox isn't the active window
CheckUser() {
    if Mac.stop
        throw StopSignal("stopped")
    while Mac.paused || !WinActive("ahk_group Roblox") {
        if Mac.stop
            throw StopSignal("stopped")
        Status(Mac.paused ? "paused - press F3 to go on" : "Roblox isn't in front - click on Roblox and the macro carries on")
        Sleep 300
    }
}

; CheckUser, plus: did the run end, or did a new match start?
CheckAbort() {
    CheckUser()
    if A_TickCount - Mac.lastCheck < 800
        return
    Mac.lastCheck := A_TickCount
    ; each has to show up a few checks in a row, so one odd frame can't end a run
    if Mac.hasEnd {
        Mac.endSeen := LooksSaved(Mac.pts["end1"]) ? Mac.endSeen + 1 : 0
        if Mac.endSeen >= 2
            throw GameOverSignal("end screen")
    }
    if Mac.readyDone {
        Mac.readySeen := LooksSaved(Mac.pts["ready"]) ? Mac.readySeen + 1 : 0
        if Mac.readySeen >= 3
            throw NewMatchSignal("READY is back")
    }
}

UserSleep(ms) {
    stopAt := A_TickCount + ms
    while A_TickCount < stopAt {
        CheckUser()
        Sleep 100
    }
}

SleepChecked(ms) {
    stopAt := A_TickCount + ms
    while A_TickCount < stopAt {
        CheckAbort()
        Sleep 100
    }
}

TogglePause() {
    if !Mac.running
        return
    Mac.paused := !Mac.paused
    Status(Mac.paused ? "paused - press F3 to go on" : "going on...")
}

StopMacro() {
    Mac.stop := true
    if !Mac.running && !Mac.inSetup
        HideStatus()
}

; ============================================================================
;  Reading the screen
; ============================================================================

ColorAt(x, y) => Integer(PixelGetColor(x, y))

SplitRGB(c, &r, &gn, &b) {
    r := (c >> 16) & 0xFF
    gn := (c >> 8) & 0xFF
    b := c & 0xFF
}

ColorDist(c1, c2) {
    SplitRGB(c1, &r1, &g1, &b1)
    SplitRGB(c2, &r2, &g2, &b2)
    return Abs(r1 - r2) + Abs(g1 - g2) + Abs(b1 - b2)
}

SampleCross(x, y) {
    colors := []
    for off in CROSS
        colors.Push(ColorAt(x + off[1], y + off[2]))
    return colors
}

; How many pixels of the plus shape around p pass test(r, g, b)
CountMatches(p, test) {
    hits := 0
    for off in CROSS {
        SplitRGB(ColorAt(p.x + off[1], p.y + off[2]), &r, &gn, &b)
        if test(r, gn, b)
            hits++
    }
    return hits
}

IsGreen(r, gn, b) => gn >= 70 && gn - r >= 25 && gn - b >= 15
IsRed(r, gn, b) => r >= 150 && r - gn >= 70 && r - b >= 60

; True when a saved point looks like it did when it was saved (4 of 5 pixels)
LooksSaved(p, tol := 50) {
    if !IsObject(p) || p.colors.Length < CROSS.Length
        return false
    hits := 0
    for i, off in CROSS
        if ColorDist(ColorAt(p.x + off[1], p.y + off[2]), p.colors[i]) <= tol
            hits++
    return hits >= 4
}

; A tower's menu is open when its red SELL button shows
PanelOpen() => CountMatches(Mac.pts["sell"], IsRed) >= 3

; The upgrade button turns green when you can afford the upgrade
CanUpgrade() => CountMatches(Mac.pts["upgrade"], IsGreen) >= 3

; While you hold a tower to place it, the enemy path lights up red
IsPlacing() {
    p := Mac.pts["path"]
    votes := 0
    for i, off in CROSS {
        c := ColorAt(p.x + off[1], p.y + off[2])
        if ColorDist(c, p.pink[i]) < ColorDist(c, p.colors[i])
            votes++
    }
    return votes >= 3
}

; ============================================================================
;  Mouse and keyboard
; ============================================================================

ClickAt(x, y) {
    MouseMove x, y, 0
    Sleep 30
    ; Roblox only notices the cursor after it moves a bit
    MouseMove x + 2, y + 1, 0
    Sleep 30
    MouseMove x, y, 0
    Sleep 50
    Click "Down"
    Sleep 50
    Click "Up"
    Sleep 80
}

PressKey(key) {
    Send "{" key " down}"
    Sleep 50
    Send "{" key " up}"
    Sleep 60
}

MoveAway() {
    if Mac.pts.Has("safe") {
        MouseMove Mac.pts["safe"].x, Mac.pts["safe"].y, 0
    } else {
        WinGetClientPos(, , &cw, &ch, "ahk_group Roblox")
        MouseMove cw // 2, ch // 3, 0
    }
    Sleep 100
}

; Clicks empty ground so no tower menu is open
Deselect() {
    if Mac.selKey = "" && !PanelOpen()
        return
    p := Mac.pts["safe"]
    ClickAt(p.x, p.y)
    Sleep 200
    Mac.selKey := ""
}

; Clicks a tower and returns true if its menu opened
SelectAt(x, y, key := "", isPlaced := false) {
    Deselect()
    ClickAt(x, y)
    Sleep 300
    if PanelOpen() {
        Mac.selKey := key
        Mac.failedSelects := 0, Mac.deadChecks := 0
        return true
    }
    if isPlaced {
        ; towers you placed always open a menu - if none do any more, the run is over
        Mac.failedSelects++
        if Mac.failedSelects >= 12
            throw GameOverSignal("tower menus stopped opening")
    }
    return false
}

ZoomOut() {
    n := Integer(Mac.cfg["ZoomOutNotches"])
    if n <= 0
        return
    WinGetClientPos(, , &cw, &ch, "ahk_group Roblox")
    MouseMove cw // 2, ch // 2, 0
    loop n {
        Send "{WheelDown}"
        Sleep 40
    }
    Sleep 500
}

ReleaseKeys(*) {
    for name in ["UpgradeKey", "CancelKey", "FarmKey", "BoomerangKey", "CrookKey"]
        if Mac.cfg.Has(name)
            Send "{" Mac.cfg[name] " up}"
    if GetKeyState("LButton")
        Click "Up"
}

; ============================================================================
;  Setup (F1): saves where everything is on your screen
; ============================================================================

RunSetup() {
    if Mac.running || Mac.inSetup
        return
    LoadSettings()
    LoadPoints()
    Mac.inSetup := true, Mac.stop := false
    try {
        Ask("SETUP`n"
            . "1. Start a Hardcore match on Wretched Front and stay at wave 0 (don't press READY).`n"
            . "2. Hotbar: " Mac.cfg["BoomerangKey"] " = Boomerang, " Mac.cfg["CrookKey"] " = Crook Boss, " Mac.cfg["FarmKey"] " = Farm.`n"
            . "3. From now on don't walk, turn or zoom the camera - the macro clicks exact spots on your screen.`n`n"
            . "Press F8 to begin.")
        ZoomOut()

        p := Ask("Hover over a plain green part of the READY button (not the text) and press F8.")
        SaveWithColors("ready", p)

        p := Ask("Hover over the game SPEED button (the x1 / x2 button next to your towers) and press F8.`n(F9 = skip, if you don't have it)", true)
        if IsObject(p)
            SavePoint("speed", p)
        else
            ForgetPoint("speed")

        p := Ask("Hover over an EMPTY bit of ground (no path, no towers, nothing to click) and press F8.`nThe macro clicks here to close tower menus.")
        SavePoint("safe", p)

        SetupPath()
        for kind in TOWER_ORDER
            SetupSpots(kind)
        SetupMenu()

        Log("setup saved")
        ToolTip()
        MsgBox "Setup saved!`n`n"
            . "1. Sell the tower you just placed (or start a new match).`n"
            . "2. At wave 0 of a Hardcore match on Wretched Front, press F2 in Roblox. The macro waits for the READY button, so you can also press F2 before the match loads.`n"
            . "3. When your first run ends (YOU LOST screen): press F3 to pause, hover over the button that starts the next match, press F6, then press F3 again. From then on the macro starts every run by itself.`n`n"
            . "F7 shows the saved spots. F1 does the setup again.", "TDS macro", "Iconi"
    } catch StopSignal {
        Log("setup cancelled")
        ToolTip()
    } finally {
        Mac.inSetup := false
        ClearMarkers()
    }
}

; The path check: hold a Farm for a moment and see the path turn red
SetupPath() {
    msg := "Hover over the middle of the enemy PATH (the road) and press F8.`n"
        . "The macro then holds a Farm for a second to see the path light up red (you need $300)."
    loop {
        p := Ask(msg, true)
        if !IsObject(p) {
            ForgetPoint("path")
            Log("setup: path check skipped")
            return
        }
        MoveAway()
        Sleep 300
        p.colors := SampleCross(p.x, p.y)
        PressKey(Mac.cfg["FarmKey"])
        Sleep 700
        p.pink := SampleCross(p.x, p.y)
        PressKey(Mac.cfg["CancelKey"])
        Sleep 300
        diff := 0
        for i, c in p.colors
            diff += ColorDist(c, p.pink[i])
        if diff / p.colors.Length >= 80 {
            SavePoint("path", p)
            return
        }
        msg := "The path didn't change colour. Check that the Farm is on key " Mac.cfg["FarmKey"] " and you have $300, then try again:`n"
            . "hover over the middle of the PATH and press F8.`n(F9 = skip this - the macro then places towers a bit slower)"
    }
}

SetupSpots(kind) {
    name := TOWERS[kind]
    count := SPOT_COUNT[kind]
    loop count
        ForgetPoint(kind A_Index)
    Mac.spots[kind] := []
    loop count {
        i := A_Index
        p := Ask("Hover where " name " #" i " (of " count ") should go and press F8.`n"
            . SPOT_HINT[kind] "`n(F9 = no more " name "s)", true)
        if !IsObject(p)
            break
        IniWrite p.x "," p.y, INI_FILE, "Points", kind i
        Mac.spots[kind].Push(p)
        AddMarker(p, MARKER_TAG[kind] i, MARKER_COLOR[kind])
    }
}

; The tower menu: the upgrade button and the sell button
SetupMenu() {
    p := Ask("Almost done! Place any tower yourself and CLICK it so its menu opens on the left.`n"
        . "Then hover over the RIGHT END of the UPGRADE button (on its plain background, not the text) and press F8.")
    SavePoint("upgrade", p)
    msg := "Now hover over the red SELL button (on the red part, not the text) and press F8.`nKeep the tower's menu open."
    loop {
        p := Ask(msg)
        MoveAway()
        Sleep 300
        if CountMatches(p, IsRed) >= 3 {
            SavePoint("sell", p)
            return
        }
        msg := "That spot doesn't look red. Open the tower's menu again (click the tower), then`n"
            . "hover over the red part of the SELL button and press F8."
    }
}

CaptureEndButton(name) {
    if Mac.inSetup
        return
    if Mac.running && !Mac.paused {
        Status("press F3 to pause first, then F6")
        return
    }
    LoadSettings()
    LoadPoints()
    MouseGetPos &x, &y
    p := {x: x, y: y}
    MoveAway()
    Sleep 300
    p.colors := SampleCross(x, y)
    SavePoint(name, p)
    Mac.hasEnd := Mac.pts.Has("end1")
    ToolTip "Saved the end screen button" (name = "end2" ? " (2nd click)" : "") "."
    SetTimer () => ToolTip(), -2500
}

ShowSpots() {
    ; the markers would cover the pixels the macro reads, so not while it runs
    if Mac.running {
        Status("press F4 to stop the macro first, then F7")
        return
    }
    LoadPoints()
    ClearMarkers()
    for name, tag in Map("ready", "READY", "speed", "SPEED", "safe", "SAFE", "path", "PATH", "upgrade", "UPG", "sell", "SELL", "end1", "END", "end2", "END2")
        if Mac.pts.Has(name)
            AddMarker(Mac.pts[name], tag, "333333")
    for kind in TOWER_ORDER
        for i, p in Mac.spots[kind]
            AddMarker(p, MARKER_TAG[kind] i, MARKER_COLOR[kind])
    SetTimer ClearMarkers, -8000
}

; Shows a prompt next to the mouse and waits for F8 (or F9 when skipping is allowed).
; Returns the mouse position, or "" when skipped.
Ask(prompt, canSkip := false) {
    Mac.prompt := prompt "`n`n[F8 = OK" (canSkip ? "    F9 = skip" : "") "    F4 = cancel setup]"
    Mac.capture := ""
    SetTimer WizardTip, 100
    try {
        loop {
            if Mac.stop
                throw StopSignal("setup cancelled")
            if Mac.capture = "ok"
                break
            if Mac.capture = "skip" {
                if canSkip
                    break
                Mac.capture := ""
            }
            Sleep 30
        }
    } finally {
        SetTimer WizardTip, 0
        ToolTip()
    }
    Sleep 100
    return Mac.capture = "skip" ? "" : {x: Mac.capX, y: Mac.capY}
}

WizardTip() => ToolTip(Mac.prompt)

Capture(what) {
    MouseGetPos &x, &y
    Mac.capX := x, Mac.capY := y
    Mac.capture := what
}

SaveWithColors(name, p) {
    MoveAway()
    Sleep 300
    p.colors := SampleCross(p.x, p.y)
    SavePoint(name, p)
}

; ============================================================================
;  Saved settings (tds_boomerang_macro.ini next to this script)
; ============================================================================

LoadSettings() {
    for key, def in DEFAULTS {
        v := IniRead(INI_FILE, "Settings", key, "")
        if v = "" {
            IniWrite def, INI_FILE, "Settings", key
            v := def
        }
        Mac.cfg[key] := v
    }
    Mac.timeout := Integer(Mac.cfg["StepTimeoutSec"]) * 1000
}

LoadPoints() {
    Mac.pts := Map()
    for name in ["ready", "speed", "safe", "path", "upgrade", "sell", "end1", "end2"]
        if IsObject(p := LoadPoint(name))
            Mac.pts[name] := p
    Mac.spots := Map()
    for kind in TOWER_ORDER {
        Mac.spots[kind] := []
        loop SPOT_COUNT[kind] {
            p := LoadPoint(kind A_Index)
            if !IsObject(p)
                break
            Mac.spots[kind].Push(p)
        }
    }
    Mac.pathOk := Mac.pts.Has("path") && Mac.pts["path"].pink.Length = CROSS.Length && Mac.pts["path"].colors.Length = CROSS.Length
    Mac.hasEnd := Mac.pts.Has("end1") && Mac.pts["end1"].colors.Length = CROSS.Length
}

; Loads everything for a run; says what's missing if the setup isn't done
LoadAll() {
    LoadSettings()
    LoadPoints()
    missing := []
    for name in ["ready", "safe", "upgrade", "sell"]
        if !Mac.pts.Has(name)
            missing.Push(name)
    if !Mac.spots["farm"].Length
        missing.Push("farm spots")
    if missing.Length {
        MsgBox "Do the setup first: press F1 in Roblox.`n`nMissing: " Join(missing, ", "), "TDS macro", "Icon!"
        return false
    }
    try {
        Mac.steps := ParseBuildOrder(BUILD_ORDER)
    } catch Error as e {
        MsgBox "There's a problem in the build order:`n" e.Message, "TDS macro", "Icon!"
        return false
    }
    return true
}

LoadPoint(name) {
    v := IniRead(INI_FILE, "Points", name, "")
    if v = ""
        return ""
    xy := StrSplit(v, ",")
    if xy.Length < 2 || !IsInteger(xy[1]) || !IsInteger(xy[2])
        return ""
    p := {x: Integer(xy[1]), y: Integer(xy[2]), colors: [], pink: []}
    if (c := IniRead(INI_FILE, "Points", name "_colors", "")) != ""
        p.colors := ParseColors(c)
    if (c := IniRead(INI_FILE, "Points", name "_pink", "")) != ""
        p.pink := ParseColors(c)
    return p
}

SavePoint(name, p) {
    ForgetPoint(name)
    IniWrite p.x "," p.y, INI_FILE, "Points", name
    if p.HasOwnProp("colors") && p.colors.Length
        IniWrite JoinColors(p.colors), INI_FILE, "Points", name "_colors"
    if p.HasOwnProp("pink") && p.pink.Length
        IniWrite JoinColors(p.pink), INI_FILE, "Points", name "_pink"
    if !p.HasOwnProp("colors")
        p.colors := []
    if !p.HasOwnProp("pink")
        p.pink := []
    Mac.pts[name] := p
}

ForgetPoint(name) {
    for suffix in ["", "_colors", "_pink"]
        try IniDelete INI_FILE, "Points", name suffix
    if Mac.pts.Has(name)
        Mac.pts.Delete(name)
}

JoinColors(colors) {
    s := ""
    for c in colors
        s .= (A_Index > 1 ? "," : "") Format("0x{:06X}", c)
    return s
}

ParseColors(s) {
    colors := []
    for part in StrSplit(s, ",", " ")
        colors.Push(Integer(part))
    return colors
}

ParseBuildOrder(text) {
    aliases := Map("farms", "farm", "boom", "boomerang", "boomerangs", "boomerang",
        "crookboss", "crook", "crooks", "crook")
    steps := []
    for raw in StrSplit(text, "`n", "`r") {
        line := Trim(RegExReplace(raw, ";.*$"))
        if line = ""
            continue
        args := StrSplit(RegExReplace(StrLower(line), "\s+", " "), " ")
        cmd := args.RemoveAt(1)
        for i, a in args
            if aliases.Has(a)
                args[i] := aliases[a]
        ok := false
        if cmd = "speed" || cmd = "ready"
            ok := args.Length = 0
        else if cmd = "place"
            ok := args.Length = 2 && TOWERS.Has(args[1]) && IsInteger(args[2])
        else if cmd = "upgrade"
            ok := args.Length = 3 && TOWERS.Has(args[1]) && IsInteger(args[2]) && IsInteger(args[3])
        else if cmd = "wait"
            ok := args.Length = 1 && IsNumber(args[1])
        else if cmd = "max" {
            ok := args.Length > 0
            for a in args
                ok := ok && TOWERS.Has(a)
        }
        if !ok
            throw ValueError("can't read this line: " line)
        steps.Push({cmd: cmd, args: args, text: line})
    }
    return steps
}

Join(items, sep) {
    s := ""
    for v in items
        s .= (A_Index > 1 ? sep : "") v
    return s
}

; ============================================================================
;  On-screen bits: status box, spot markers, log
; ============================================================================

Status(msg) {
    if msg = Mac.lastStatus && IsObject(Mac.statusGui)
        return
    Mac.lastStatus := msg
    if !IsObject(Mac.statusGui) {
        ; click-through box, so it never gets in the way of the game
        ui := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20 -DPIScale")
        ui.BackColor := "15151F"
        ui.MarginX := 10, ui.MarginY := 6
        ui.SetFont("s10 cWhite", "Segoe UI")
        Mac.statusText := ui.Add("Text", "w380 r3")
        Mac.statusGui := ui
    }
    Mac.statusText.Value := "TDS macro  -  run " Mac.runs "`n" msg "`nF3 pause    F4 stop"
    x := 10, y := 10
    if WinExist("ahk_group Roblox") {
        WinGetClientPos(&cx, &cy, &cw, , "ahk_group Roblox")
        x := cx + cw - 420, y := cy + 90
    }
    Mac.statusGui.Show("NoActivate AutoSize x" x " y" y)
    WinSetTransparent 220, "ahk_id " Mac.statusGui.Hwnd
}

HideStatus() {
    if IsObject(Mac.statusGui)
        Mac.statusGui.Hide()
    Mac.lastStatus := ""
}

AddMarker(p, label, color) {
    if !WinExist("ahk_group Roblox")
        return
    WinGetClientPos(&cx, &cy, , , "ahk_group Roblox")
    ui := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20 -DPIScale")
    ui.BackColor := color
    ui.MarginX := 3, ui.MarginY := 1
    ui.SetFont("s8 bold cWhite", "Segoe UI")
    w := 8 * StrLen(label) + 6
    ui.Add("Text", "Center w" w, label)
    ui.Show("NoActivate AutoSize x" (cx + p.x - w // 2 - 3) " y" (cy + p.y - 9))
    WinSetTransparent 210, "ahk_id " ui.Hwnd
    Mac.markers.Push(ui)
}

ClearMarkers() {
    for ui in Mac.markers
        ui.Destroy()
    Mac.markers := []
}

Log(msg) {
    try FileAppend FormatTime(, "yyyy-MM-dd HH:mm:ss") "  " msg "`n", LOG_FILE, "UTF-8"
}
