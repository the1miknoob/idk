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

All the controls are F keys. On a laptop, if F1 or F2 changes the volume or brightness instead, hold **Fn** while you press them.

## Setup (do this once)

1. Join a **new Hardcore** match on **Wretched Front**. Stay at **wave 0** and don't press READY. **Don't walk or turn the camera** (no WASD, no right-click dragging): every new match puts the camera back where you spawned, and the setup has to match that. If you already walked or turned, leave and join a fresh match first. (Scrolling is fine: the macro zooms all the way out by itself.)
2. Click on Roblox and press **F1**. A box next to your mouse tells you what to point at. Hover over it and press **F8**:
   - the green **READY** button
   - the **speed** button (x1/x2). If you don't have it, press **F9** to skip.
   - an **empty** bit of ground on the **right half** of the screen. Tower menus open on the left, and the macro clicks this spot to close them.
   - the enemy **path**, somewhere away from where your towers will go. The macro picks up a farm for a moment to see the path turn red, so have $300. (Skipping this isn't a good idea: blocked spots then can't be fixed.)
   - **10 farm spots**, **5 boomerang spots** and **5 crook boss spots**. Press F9 to stop early (you need at least 1 farm and 1 boomerang).
     - Farms: anywhere off the path. A tidy block works well.
     - Boomerangs and Crook Bosses: right next to the path where it bends a lot (the middle of the map). Crook Bosses are big, so give them room.
     - Leave a bit of space between spots, and keep them away from the path point you picked. If a spot is blocked, the macro moves the tower a little and remembers the new spot.
   - the **upgrade** button and the red **sell** button of a tower menu: place a **farm**, click it so its menu opens, then point at the buttons. The macro also checks that your empty-ground spot isn't under that menu.
3. Leave the match and start a new one. (You can sell the farm instead, but then you may not have the cash for 3 farms at wave 0.)

The macro zooms the camera all the way out when setup starts and at the start of every match, so the view is the same each time (Roblox resets the zoom on every new server). **Don't walk or turn the camera**, because the macro clicks exact spots on your screen. Keep Roblox the same size too: if you set it up in fullscreen, play in fullscreen.

## Run it

- At wave 0 of a Hardcore match on Wretched Front, press **F2**. You can also press it while the match is still loading; the macro waits for the READY button. A small status box shows what it's doing.
- **F3** pause / resume, **F4** stop, **Ctrl+F4** close the macro.
- **After your first run** (on the YOU LOST screen): press **F3** to pause, hover over the button that starts the next match, press **F6**, then **F3** again. After that the macro starts every new run by itself. (If you forget F3, the first F6 pauses the macro for you. Then hover and press F6 again.)
- **Need two clicks to get to the next match?** Press F3, hover over button 1, press F6, click it, hover over button 2, press **Shift+F6**, then F3.
- **F7** shows where everything is saved (stop the macro first). **F1** does the setup again. After a new setup, save the play-again button with F6 again.

## What it does

It follows the build order from the video. Every step waits until you have the cash:

| Waves | Step |
| --- | --- |
| 0 | x2 speed, 3 farms, READY |
| 1–6 | farms to level 1–2, Boomerang #1 up to level 2, farms #4 and #5 |
| 7–12 | farms #1–#3 to level 3, farm #6, Boomerang #1 to level 3, Crook Boss #1 to level 2 |
| 13–15 | farms #7–#10, farms #4–#10 to level 3 |
| 15–19 | Crook Bosses #2–#5 to level 2, Boomerang #2 to level 3 |
| 19–22 | Boomerangs #3–#5 to level 3 |
| 22–24 | Crook Bosses #1–#3 to level 3 |
| 25+ | keep upgrading the boomerangs until you lose (around wave 29) |

How it knows what's going on:

- **Can I afford it?** The upgrade button turns green when you can buy the upgrade. The path turns red while you're holding a tower to place.
- **Did the upgrade go through?** The menu changes to the next upgrade. The macro waits for that before it counts a level, so lag can't make it miscount.
- **Is the menu open?** The red sell button shows.
- **Is the run over?** The "play again" button you saved with F6 shows up, or tower menus stop opening. A new match is spotted by the READY button (and by your towers being gone, so a vote button in the same spot doesn't fool it).

If a tower can't be placed at wave 0 (not enough cash), it's placed later, right before its first upgrade.

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
- **Towers go in the wrong place:** the setup was done after you walked or turned the camera, or Roblox changed size. Join a new match and, without walking or turning, press F1 and do the setup again.
- **Your character walks when the macro clicks:** in Roblox settings, set Movement Mode to "Default" (not "Click to Move").
- **It never upgrades:** redo the setup, and for the upgrade button pick a plain spot at its right end (not the text).
- **It waits forever at "waiting for a match":** it needs to see the green READY button at the spot you saved. Join a Hardcore match on Wretched Front at wave 0.
- **The log says the empty-ground spot doesn't close tower menus:** redo the setup and pick a plain spot further right.
- **It stops when you click another window:** that's on purpose. Nothing is clicked or typed outside Roblox. Click back on Roblox and it carries on.
- **You run two Roblox windows:** the macro sticks to the one you pressed F2 in.

Heads up: auto-farming with a macro may be against the game's rules. Use it at your own risk. This isn't made by or connected to Paradoxum Games or Roblox.
