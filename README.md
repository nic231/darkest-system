# The Darkest System — Foundry VTT

A Foundry VTT game system implementing the mechanics for **The Darkest Woods** and **The Darkest House** by Monte Cook Games.

> **Alpha Release** — This system is in active development. Feedback and bug reports welcome via [GitHub Issues](https://github.com/nic231/darkest-system/issues).

---

## Overview

The Darkest System is a rules-light horror RPG framework built around a single elegant resolution mechanic: roll **2d6 + your Rating** and beat **7 + the task's Rating**. Everything in the world — characters, creatures, objects, tasks — is measured on the same 1–10 Rating scale.

This system implements the full mechanical framework for both **The Darkest Woods** (wilderness survival horror) and **The Darkest House** (haunted house exploration), selectable via a game mode setting.

---

## Features

### Core Mechanics
- **Rating-based task resolution** — 2d6 + Character Rating vs. 7 + Task Rating
- **Automatic success/failure** — tasks 6+ Ratings below you succeed automatically; 6+ above fail automatically
- **Boons and Banes** — roll 3d6 keep highest 2 (Boon) or lowest 2 (Bane); cancel each other out
- **Special Success** — optional house rule: succeed on a single die alone for an enhanced outcome
- **Partial Success** — optional house rule: fail but roll doubles for a partial achievement

### The Darkest Die
A visually distinct die rolled alongside every action roll. If it shows higher than your kept dice, a **Transgression Event** is triggered — regardless of whether you succeeded or failed. This is the heartbeat of dread in the system.

### Wounds
- Separate tracking for **physical** and **mental** wounds
- Each wound has a Rating; accumulating wounds imposes a Bane on all rolls
- Taking a new wound triggers a **death check** (physical) or **catatonia check** (mental) against your worst wound
- Wound healing dialog with Lowest / Highest / Choose options

### Doom
- Doom items accumulate on characters as a consequence of transgression and dark choices
- **Doom Tally** — a GM-facing tracker showing all player doom counts
- Doom skulls displayed next to player names in chat and the player list (configurable)
- Spend a Doom to invoke a narrative benefit — at cost

### Damage
- Damage rolls: 1d6 + Attack Rating − Defense Rating
- Armor adds to defence Rating (+1 light, +2 most)
- **NPC Tracker** — auto-updates when the GM deals damage to a character
- Separate player "Take Damage" rolls vs. GM "Deal Damage" rolls

### Transgression Tracker
- GM-only window tracking transgression levels per region/antagonist
- Supports up to 10 transgression events per region with escalating consequences
- Three loop cycles before catastrophic outcome
- Click a region to make it active; click again to deactivate (for regions without an antagonist)
- Auto-detects active scene region from scene name or flag

### Game Modes
- **Darkest Woods** mode — region-based transgression tracking with witch antagonists
- **Darkest House** mode — linear house action escalation (10 actions, cyclic)

### Character Sheets
- Full character sheet with Rating, wounds, doom, equipment, and custom modifications
- Shift-click the Action Roll button for a quick roll at difficulty 4 with no modifiers
- NPC and Creature sheets with compact layouts

### Rest
- Rest rolls against each active wound
- Results posted to chat showing each wound's recovery outcome

---

## What Is NOT Included

This system provides the **mechanical framework only**. No game content is included:

- Witch names, region descriptions, and transgression events from *The Darkest Woods* are not part of this system
- House actions from *The Darkest House* are not part of this system
- Artwork, maps, journal entries, and compendium content from the source books are not included

You must own the source material (**The Darkest Woods** or **The Darkest House** by Monte Cook Games) to use this system meaningfully.

---

## Installation

### Via Foundry VTT
1. In Foundry VTT, go to **Setup → Game Systems → Install System**
2. Paste the manifest URL into the field at the bottom:
   ```
   https://raw.githubusercontent.com/nic231/darkest-system/master/system.json
   ```
3. Click Install

### Via The Forge Bazaar
Search for **The Darkest System** in the Bazaar and click Install.

---

## Requirements

- Foundry VTT v11 or later (verified on v14)
- The Darkest Woods or The Darkest House (purchased from Monte Cook Games)

---

## Quick Start

1. Create a new World using **The Darkest System**
2. In System Settings, choose your **Game Mode** (Darkest Woods or Darkest House)
3. Create a character actor — set their **Rating** (3–4 is typical)
4. Use the **Action Roll** button on the character sheet to make rolls
5. The GM can open the **Transgression Tracker** from the token controls sidebar

---

## Changelog

### v0.5.0-alpha
- Fix: ActiveEffect cycle error on v14 when adding/removing wounds or resting
- Verified compatible with Foundry VTT v14

### v0.4.0-alpha
- Shift-click Action Roll button for instant roll at difficulty 4 with no modifiers

### v0.3.0-alpha
- House silhouette added to system background artwork
- Deactivate active region by clicking it again in the Transgression Tracker
- Fix: Take Damage roll no longer incorrectly updates the NPC tracker
- Fix: Doom description text corrected
- Fix: "need X on the dice" now reads "need X or more on the dice"

### v0.2.0-alpha
- Heal Wound dialog with Lowest / Highest / Choose options
- Doom skulls in chat messages and player list (configurable)
- Scene auto-detection for transgression regions
- Player list doom pip overlay
- Background replaced with original SVG artwork
- Multiple bug fixes and stability improvements

### v0.1.0-alpha
- Initial release

---

## Disclaimer

*The Darkest System is an unofficial fan work and is not affiliated with, endorsed by, or produced by Monte Cook Games, LLC.*

*The Monte Cook Games logo, Numenera, the Cypher System, No Thank You, Evil!, Invisible Sun, The Darkest Woods, The Darkest House, and their respective logos are trademarks of Monte Cook Games, LLC in the U.S.A. and other countries. All Monte Cook Games characters and character names, and the distinctive likenesses thereof, are trademarks of Monte Cook Games, LLC. Content derived from Monte Cook Games publications is © 2013–2024 Monte Cook Games, LLC.*

*Monte Cook Games permits fan-created works for their games, subject to the policy given at [https://www.montecookgames.com/fan-support/fan-use-policy/](https://www.montecookgames.com/fan-support/fan-use-policy/). The contents of this system are for personal, non-commercial use only. Monte Cook Games is not responsible for this system or any of the content that did not originate directly from Monte Cook Games. Use of Monte Cook Games's trademarks and copyrighted materials anywhere in this system should not be construed as a challenge to those trademarks or copyrights.*

---

## License

Original code © SmilingMan, released under the [MIT License](LICENSE).
