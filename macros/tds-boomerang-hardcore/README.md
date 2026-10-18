# TDS Boomerang Hardcore macro

An [AutoHotkey v2](https://www.autohotkey.com/) macro for **Tower Defense Simulator** (Roblox). It plays the "Boomerang Hardcore wave 29" gem and tower EXP grind on **Wretched Front (Hardcore)** over and over. In the video this strat is based on, one run lasts about 3 minutes and gives about 133 gems and 224 XP (claimed: ~3,000 gems and ~2,000 tower EXP per hour). It doesn't need the skill tree, special towers or golden towers.

The macro only presses keys and clicks the mouse like you would. It doesn't change the game.

## What you need

- A Windows PC with Roblox
- AutoHotkey **v2** (free: autohotkey.com → Download → v2.0)
- In TDS: Hardcore unlocked, and **Boomerang, Crook Boss and Farm** in your loadout, in this order:
  - hotbar **1** = Boomerang
  - hotbar **2** = Crook Boss
  - hotbar **3** = Farm

  (Different order? Change the keys in the `.ini` file, see below.)

## Install

1. Install AutoHotkey v2.
2. Put `tds_boomerang_hardcore.ahk` in its own folder. It saves its settings (`tds_boomerang_macro.ini`) and a log next to itself.
3. Double-click the file. A green **H** icon shows up in the taskbar tray.

## Setup (do this once)

1. Join a **Hardcore** match on **Wretched Front**. Stay at **wave 0** and don't press READY.
2. Click on Roblox and press **F1**. A box next to your mouse tells you what to point at. Hover over it and press **F8**:
   - the green **READY** button
   - the **speed** button (x1/x2). If you don't have it, press **F9** to skip.
   - an **empty** bit of ground. The macro clicks here to close tower menus.
   - the enemy **path**. The macro picks up a farm for a moment to see the path turn red, so have $300.
   - **10 farm spots**, **5 boomerang spots** and **5 crook boss spots**. Press F9 to stop early.
     - Farms: anywhere off the path. A tidy block works well.
     - Boomerangs and Crook Bosses: right next to the path where it bends a lot (the middle of the map). Crook Bosses are big, so give them room.
     - Leave a bit of space between spots. If a spot is blocked, the macro moves the tower a little and remembers the new spot.
   - the **upgrade** button and the red **sell** button of a tower menu. Place any tower and click it so its menu opens.
3. Sell that tower (or start a new match).

**The macro zooms the camera all the way out** when setup starts and at the start of every match, so the view is the same each time (Roblox resets the zoom on every new server). **Don't walk or turn the camera**, because the macro clicks exact spots on your screen. Keep Roblox the same size too: if you set it up in fullscreen, play in fullscreen.

## Run it

- At wave 0 of a Hardcore match on Wretched Front, press **F2**. You can also press it while the match is still loading; the macro waits for the READY button. A small status box shows what it's doing.
- **F3** pause / resume, **F4** stop, **Ctrl+F4** close the macro.
- **After your first run** (on the YOU LOST screen): press **F3** to pause, hover over the button that starts the next match, press **F6**, then **F3** again. After that the macro starts every new run by itself. If you need two clicks to get to the next match, save the second button with **Shift+F6**.
- **F7** shows where everything is saved. **F1** does the setup again.

## What it does

It follows the build order from the video. Every step waits until you have the cash:

| Waves | Step |
| --- | --- |
| 0 | x2 speed, 3 farms, READY |
| 1–6 | farms to level 1–2, Boomerang #1 up to level 2, farms #4 and #5 |
| 7–12 | farms to level 3, Boomerang #1 to level 3, Crook Boss #1 to level 2 |
| 13–15 | farms #6–#10, all to level 3 |
| 15–19 | Crook Bosses #2–#5 to level 2, Boomerang #2 to level 3 |
| 19–22 | Boomerangs #3–#5 to level 3 |
| 22–24 | Crook Bosses #1–#3 to level 3 |
| 25+ | keep upgrading the boomerangs until you lose (around wave 29) |

How it knows what's going on:

- **Can I afford it?** The upgrade button turns green when you can buy the upgrade. The path turns red while you're holding a tower to place.
- **Is the menu open?** The red sell button shows.
- **Is the run over?** The "play again" button you saved with F6 shows up, or tower menus stop opening. A new match is spotted by the READY button.

Want a different strategy? Edit `BUILD_ORDER` near the top of the `.ahk` file. The commands are explained right above it.

## Settings (`tds_boomerang_macro.ini`)

The file is made the first time you run the macro. Edit it with Notepad, then restart the macro.

| Setting | Default | What it does |
| --- | --- | --- |
| `BoomerangKey`, `CrookKey`, `FarmKey` | 1, 2, 3 | Hotbar keys |
| `UpgradeKey` | e | TDS upgrade key |
| `CancelKey` | q | TDS cancel-placing key |
| `SpeedClicks` | 1 | How many times to click the speed button |
| `ZoomOutNotches` | 30 | Mouse-wheel steps used to zoom all the way out at the start of setup and of every match. 0 turns it off |
| `StepTimeoutSec` | 240 | How long one step waits for cash before skipping it |
| `RestartDelaySec` | 3 | Wait on the end screen before clicking play again |

## If something goes wrong

- Look at `tds_boomerang_macro_log.txt` next to the macro. It lists every step.
- **Towers go in the wrong place:** the camera moved, or Roblox changed size. Press F1 and do the setup again.
- **Your character walks when the macro clicks:** in Roblox settings, set Movement Mode to "Default" (not "Click to Move").
- **It never upgrades:** redo the setup, and for the upgrade button pick a plain spot at its right end (not the text).
- **It waits forever at "waiting for a match":** it needs to see the green READY button at the spot you saved. Join a match at wave 0.
- **It stops when you click another window:** that's on purpose. Click back on Roblox and it carries on.

Heads up: auto-farming with a macro may be against the game's rules. Use it at your own risk. This isn't made by or connected to Paradoxum Games or Roblox.
