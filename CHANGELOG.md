# Changelog

## 0.38.0-alpha (2026-08-13)

**The doom count is on screen now**, beside the travel clock and above the player list. Click it to open the full tally. It sits dim while the count is zero and lights when there is something to fear, so an empty table isn't being shouted at. Everyone sees it — the doom count is public information, and the players' own sheets carry the Dooms it adds up. Turn it off per-client under *Show the doom count on screen*: where your screen furniture goes is your business, not the world's.

**The doom tally is readable.** Character names were inheriting Foundry's own text colour rather than this system's — the window sets a colour, but Foundry's `.window-content` sits between it and the names and overrode it. On top of that the rows were the same colour as the window behind them, so the names had no surface to sit on, and four labels used the palette's *light-surface* muted tone against a dark window, which the palette itself warns against. Names are now larger, weighted, and set explicitly; rows have their own surface; the labels use the tone meant for dark windows.

**Crossing between regions is described.** A journey that leaves one region for another now says what changed on the way — above the arrival line, in the same card. Walking from the Flood into Winter's Mercy, the standing water thins as the path climbs, then stops moving altogether. Walking back, the snow goes to slush and the slush to water that rises with every mile.

Thirty-five routes cross a region boundary, out of 318. All thirty-five are written, and each **direction** is written separately — the same road walked the other way is a different transition, and several region pairs are joined by more than one road. The rest of the map stays silent, which is what keeps a crossing feeling like one.

The lines follow the arrival-line rules: two sentences at most, never naming the place or the region, never naming the bird on a birdsong-gated path, and no distances — the card prints those directly above. They describe the journey, not the destination; the arrival line already covers where the party ended up. Interior crossings (the Ghost Caves, the Rootrealm, the Temple of the Moon) describe enclosure rather than weather.

They are covered by the same *Show arrival text* setting: a GM who narrates the whole beat themselves gets nothing extra.

**Requires content module 1.10.0** for the transition lines. Update the system first — the module will not activate against an older one.

## 0.37.0-alpha (2026-08-13)

**Ask before each transgression.** A new setting under Transgression pacing. With it on, a Darkest Die whispers you a prompt — *apply it, or let it pass* — instead of advancing the track on its own. The prompt names the region, the level it would reach, and the witch's scripted action for that level, so the call can be made without opening the tracker.

**The players cannot tell.** This is the whole point of the feature, so it is worth being precise about what it guarantees. The woods stir publicly the instant the die lands, before you have decided, worded exactly as they always are — including the tier, which is chosen from the level the transgression *would* reach rather than the one it is sitting at, because the tiers step at 5 and 10 and getting that wrong would be the tell at the two most dramatic moments in the track. Applying posts nothing further; a second public line would appear only for the ones you applied. Applied, let pass, held by pacing, and fully automatic are byte-identical in public chat.

**Letting one pass costs nothing.** No cooldown is consumed and no provocation is counted, so the next Darkest Die can still land. Pacing is only consulted if you apply.

**It composes with pacing rather than replacing it.** This decides whether the woods advance; pacing decides whether they *can*. Run both and a transgression you apply can still be held by a cooldown — the tracker will tell you so, privately.

**Backtracking is unchanged.** It has asked you this way since 0.31.0 and does not double-prompt.

The tracker window shows an "Asking first" badge while the setting is on, so a session where you let several pass doesn't look like the tracker has stopped working. Off by default; Darkest Woods mode only, like the pacing rules it sits with.

**Also:** the GM-only toast that announced "Transgression tracked. Level: N" no longer fires when the track didn't actually move — it had been reporting a level for damped triggers that were held.

## 0.36.0-alpha (2026-08-13)

A pass over the whole codebase, fixing what the last review found. Most of these are things that only went wrong under conditions the table actually meets — a party that splits, a second GM logging in, a journey that starts underground.

**Rest rolls count as rolls again.** A Darkest Die on a rest roll did nothing: no transgression, no doom, no line in the session log. Resting is where the woods are most likely to be provoked, and the one place the system was quietly ignoring the die. Rest rolls now go through the same machinery as every other roll. The rest dialog also shows the boons and banes already in effect and lists what is applying them, instead of silently starting from your wounds alone.

**"Every N rolls" damping now counts rolls.** It counted *triggers* — so it only released after N transgressions had been provoked, which is the opposite of the setting's promise and made it far stricter than the number suggested. Set it to 4 and four rolls now release the hold, as it always said.

**The replay follows a split party in real time.** Each group's legs were replayed one group after the other, so a party that split and rejoined looked like two consecutive journeys rather than two simultaneous ones. Every step is now sequenced by *game time* across all groups, so both lines advance against the same clock — and the same change fixes a replay that crossed onto a second map showing that map's entire route at once, already finished, before the party got there.

**A journey that starts underground no longer drags the region onto the cave map.** The Ghost Caves map also pins Glory's Cabin and the Abandoned Campsite — they are the ways out — so a session that opened inside the caves kept every later leg across The Lost squeezed into that small inset. A map is now only preferred when it actually *contains* the place, which keeps cave rooms drawing on The Lost while stopping the inverse.

**Time spent somewhere reads as time passing.** A night's sleep breathes on the map while the replay holds on it; an hour or two gives a single quiet pulse and settles. Under an hour gets nothing — every fifteen-minute search stopping to throb would wreck the pacing. The distinction is between sleeping and waiting, not decoration.

**Play for all no longer plays twice on the GM's screen.** And the shared replay now sends the route with it, so players — who cannot read the session log at all — see the journey rather than an empty map.

**Two GMs no longer double-apply.** With a GM and an assistant both connected, a wound clearing itself could be written twice. The house level could also be advanced twice at once by two things landing together, losing one of them. Both now go through a single writer.

**Manual log entries remember which group walked them.** A leg added by hand was filed against no group at all, so it went missing from that group's route on the map. Editing an existing leg still leaves its group alone — that is a correction, not a re-assignment. The markdown export now writes one path per group as well, rather than merging a split party's journeys into a single chain that nobody walked.

**The whispered-alert sound works again.** It called a global Foundry v14 removed, so every whispered GM message threw an error on the player's client and played nothing.

**Also:** the Doom Tally refreshes live instead of only when reopened; the NPC tracker's writes are serialised, so two quick clicks can no longer lose one; the replay caches its backdrop rather than repainting the map art and 260 speckles every frame.

**Housekeeping.** Removed two socket handlers nothing ever sent (a socket case with no sender is an invitation to write to any actor), a preloaded dialog template that was never used and still carried a target-armour field the rules do not have, a sheet for an actor type that does not exist, and three methods with no callers. One of those was `refreshUses()`, a daily reset for ability uses that was never wired to the clock and has never run — uses are restored by clicking the pips on the sheet, which is what has always actually happened.

**Build fix, worth naming.** The module zip was created *before* the map data was regenerated, so the module on disk could be correct while the zip uploaded to Forge carried the previous build's coordinates. The build now runs the data emitters first and refuses to zip if either fails.

**Requires content module 1.9.0** for the area nesting the sub-map fix reads. Update the system first — the module will not activate against an older one.

## 0.35.0-alpha (2026-08-12)

**Replay speed is yours to set** — Brisk, Walking, Slow or Credits, from the map window or system settings. Your eight-leg session runs anywhere from six seconds to half a minute; a sixty-leg campaign from 1.3 to 4.5 minutes. The default was far too quick to follow.

**The replay follows the party across maps instead of losing them.** It was locked to the map you were viewing, so a party walking into the Ghost Caves simply vanished at the boundary. It now watches them reach the crossing point, cuts to the new map, draws their journey there, and cuts back out when they leave.

**Interiors stay on their region map where the art allows it.** The region maps already draw their interiors as a bounded inset — the Ghost Caves are a box down the left of The Lost — and following the route inside that box reads better than cutting away to a separate screen for four rooms. The Ghost Caves and A Town Called Dismal are pinned in full on their parents, so they stay there; the Temple of the Moon has no parent pins at all and the Rootrealm only some, so those still cut to their own map. That is the data's limit, not a preference.

## 0.34.0-alpha (2026-08-12)

**The replay draws the line properly now.** It advanced a whole step per frame, so the route snapped from pin to pin. It now creeps along each segment with a travelling mark at its head, and the destination pin only appears once the line reaches it — so you watch them arrive rather than seeing where they end up first.

**Sub-areas draw on their own maps.** A cave crawl through the Ghost Caves was being squashed into the small inset on The Lost's map, and the line then flew straight from inside the caves to wherever they went next — skipping the way they actually left. Locations now always draw on their *own* area's map, so the crawl gets the Ghost Caves' full map and the crossings in and out are marked at the Cave Mouth and Cave Exit. The same fix covers the Temple of the Moon and the Rootrealm.

**Places can carry the name the players gave them.** Click any pin on the map and name it as they know it — "the cabin with the typewriter", "where Ida died". Stored per location rather than edited into the log, so renaming fixes every past and future mention at once and the book's name is never lost underneath. That name is what the sketch shows.

**Also:** no labels on the real map, which already prints every name — a second set on top was just noise. Sketch pins are larger, with a paper-coloured rim so an overlapping line doesn't read as part of the marker.

## 0.33.0-alpha (2026-08-12)

**The route map.** *Draw the route* in the session log plots everywhere the party has walked, from the log itself. Two styles:

- **Sketch** — aged paper, showing *only* the places they have actually been, at their true positions. Safe to hand to players, and the auto-map for anyone who doesn't want to draw their own.
- **Real map** — the route over the book's own art. **GM only.** The region maps are flowcharts: every location is a labelled blob and the secret birdsong paths are drawn in red, so sharing one gives away the whole region. Sharing it asks twice.

Fog of war is safe by construction — the renderer walks the *log*, never the pin list, so an unvisited location cannot appear even by accident.

**A split party draws as two lines**, one colour per group, with a legend. The divergence and the rejoining are visible as shapes. **Stays draw as rings** sized by how long they were there, so two days at the Dark Lodge is a heavy mark and a fifteen-minute pause barely shows. **Gaps break the line** rather than joining across them — the map never invents a journey nobody made.

**The credits scene.** *Replay* animates the route drawing itself; *Play for all* runs it on every connected screen at once, in step. Both groups animate against the same clock, so a split looks like two parties moving at once.

Stays pause the replay **logarithmically, capped** — a night's sleep reads as a night, but two days is only 1.4× that rather than 6×, and a week-long imprisonment cannot stall the film. A sixty-leg campaign replays in under a minute.

Coordinates ship in the content module (**1.8.0 required**), covering 130 of the 131 locations. The one location the book never pins is positioned from its route neighbours and drawn hollow to mark it approximate.

## 0.32.0-alpha (2026-08-12)

**The party can split.** Travel is now logged against a named **group** — create one, say who is in it, and every leg records which group walked it. The travel tool gains a "Who is travelling" selector, and the session log shows one route per group, colour-keyed.

This matters more than it sounds. Merged into one chain, two groups walking different paths on the same day produce a path nobody took and a false gap at every handover — tested with a four-leg split, which reported **three phantom gaps** before grouping and none after. The route map would have drawn that fiction as a line.

The **clock stays global**, deliberately. One clock per group would have to be read by the dial, the scene darkness, the ambience layers and the daylight decay, none of which have any notion of *whose* time it is. You run one group, then the other, and keep them level by narration — which is what happens at the table anyway.

**Backtracking is scoped to the group.** The woods notice a party returning somewhere *they* were yesterday; another group having passed through is somebody else's business, and matching on it would have fired constantly once the party split.

**Time spent in one place is recorded now.** Waiting, resting, sleeping, or being held somewhere for two days left no trace at all in the movement log — so the map could not tell time spent somewhere from a hole in the record, and two separated groups could not be lined up against each other. Passing time now logs a stay: same place, real duration, shown as "waited 8h" rather than a journey of zero length.

Groups only appear once you make a second one; an unsplit game never has to think about them. Deleting a group leaves its legs intact — they are a record of something that happened.

## 0.31.1-alpha (2026-08-12)

**Legs can be edited, not just added and deleted.** A pencil on each row reopens the same dialog. Changing a leg's day or times **re-sorts it into place** — the list is ordered by game time rather than by when it was typed, so a correction lands where it belongs with nothing to drag.

**Gaps in the route are shown rather than smoothed over.** "Path walked" used to join every leg into one chain regardless, so a leg that began somewhere the party had not walked to produced a path they never took. Those breaks are now marked, named ("after X, the next leg starts at Y"), and reported in the export. The route map would otherwise have drawn that fiction as a line.

**"Path walked" collapses once it gets long.** A full campaign runs to a couple of hundred legs — about fifty lines of unbroken text. It now shows the last dozen places with a count and a click to expand.

**Clearing the log says what it is about to delete.** Both clear buttons now name the count ("Permanently delete 214 movements?"), break the full clear down by kind, and default to No. It is the only record of the campaign's movement, and a mis-click was unrecoverable.

## 0.31.0-alpha (2026-08-12)

**The woods remember a path walked two days running.** The book: *"Traversing the same path two days in a row is a transgression... This must happen on consecutive days. Retracing one's steps on the same day is fine. So is doing so with a full day in between."*

Arriving somewhere the party was the previous day now posts a public line — *"This place recognises you. One should not let the Woods become too familiar with them…"* — and whispers you a prompt offering the transgression. **The players see the same message either way**, worded identically, so nobody can work out from it whether you applied it.

Sensitivity is a setting: **per location** (the default, finer-grained than the book and firing more often), **per area** (as the book has it), or **off**.

Applying it deliberately **bypasses the transgression damping**. Damping exists to stop dice-driven transgressions stacking when four players roll at once; this is one considered press of a button, and being told "held" after pressing Apply would read as a bug. It skips the damping check entirely rather than ignoring its verdict, so it can't silently consume a player's provocation either.

**Travel legs now record when they set out, not just when they arrived.** The log reads `Day 3, 08:00 → 14:20`, and legs that cross midnight show both days. Legs also record location *slugs* now, so the log knows which place, not just what it was called.

**Fixed: a multi-leg journey logged its intermediate stops with no day or time at all.** Only the final leg carried them. Every multi-hop trip has been leaving undated rows in the log — which would have made the backtracking check silently impossible for exactly the journeys it matters most for. Intermediate legs now project the clock forward leg by leg, verified against a three-leg journey crossing midnight twice.

**Legs can be added by hand** — for travel that happened away from the table, or to correct the record. Times, day, and route are prefilled where they can be inferred; an arrival before its departure is read as walking through midnight rather than rejected. Hand-added rows are marked, and sorted into game order rather than appended to the end.

## 0.30.2-alpha (2026-08-12)

**Ability rows re-laid out:** name and tags on the left, then the wound cost, with **Uses** and its pips pushed to the right-hand edge and labelled. The pip track now lines up down the list however long each ability name is.

**Fixed: an ability with a wound cost but unlimited uses never showed its cost.** On the Abilities tab the cost button was nested inside the uses block, so it only rendered for abilities that also had limited uses.

## 0.30.1-alpha (2026-08-12)

**Fixed: the ability wound cost's Physical/Mental selector was hidden.** It existed, but only appeared once a non-zero rating had been saved — so on a fresh ability the option looked as though it wasn't there. It's always visible now, since the type has to be pickable in the same pass as the rating.

Mental costs also read blue on the character sheet rather than sharing the physical red. The two are tracked separately and lead to different places (catatonia rather than unconsciousness), so they shouldn't look identical.

## 0.30.0-alpha (2026-08-12)

**The 24-hour rest lock is on the clock now.** A wound you fail to rest away couldn't be attempted again until the GM cleared it by hand — the lock was stored as a plain flag with no notion of time. It now stamps the travel clock, so the wound row shows **how long is left** ("6h 20m") and the lock **lapses on its own** when the time passes. The rules ask for exactly this: *"note the time when recovery can next be attempted."*

**Rest now warns instead of blocking.** Locked wounds are listed with their remaining time and a "treat them anyway (specialised care)" tick. That's a real rule, not a house exception — *"a character with relevant skill and appropriate equipment... allows recovery on a wound they failed to heal without waiting 24 hours"* — and blocking the roll outright made it unreachable.

**Abilities can carry a wound cost.** A rating and a type on the ability, shown beside its uses on the character sheet. Clicking it applies the wound after a confirmation — never automatically, since using an ability and paying for it are two decisions, and a cost that applied itself couldn't be undone when the GM rules the ability didn't go off.

**Fixed: a wound added by hand skipped the unconsciousness check.** The sheet's **+** button created the item directly, bypassing the path damage rolls use — so the same injury behaved differently depending on how it arrived. It now runs the same check, which (per the rules) only prompts when the character already had a wound of that type.

Wounds locked under the old scheme stay locked until cleared by hand, rather than silently freeing themselves on upgrade.

## 0.29.0-alpha (2026-08-12)

**Fixed: the road fell silent during a hold for roleplay.** The travelling scene is generic — it stands in for every region, so it carries no region flag of its own — and the ambience controller resolves the soundscape from the *active scene*. So moving to it resolved to nothing, stopped the region bed, and left the whole roleplay scene in silence.

It now falls back to the region recorded in the hold: the ground the party is actually crossing. Because that resolves to the same soundscape they set out in, the bed **keeps running without restarting** — the woods carry on around them while they talk, rather than cutting out and back in.

This also needed a re-resolve after the hold is written. `canvasReady` fires when the travelling scene activates, which is *before* the hold exists, so the first attempt had nothing to fall back to.

(The separate local-file travel bed — `travel-*.ogg` in the content module — is unaffected and still plays if you supply those files. Nothing ships with them, which is why the hold was silent even with Syrinscape working.)

## 0.28.2-alpha (2026-08-12)

**Fixed: three startup hooks never ran at all.** `registerSceneAmbienceHooks()` and `registerTravelClockHooks()` are called from inside the system's own `ready` handler, and they each registered a *further* `ready` listener. Foundry doesn't replay a hook that has already fired, so those callbacks were dead code.

That killed the ambience system's startup pass and its audio-unlock watcher outright — the reason scene ambience stayed silent no matter what. It also explains the travel dial needing a refresh to appear, and the hold-recovery notice never showing after a reload.

**Ambience now says why it's silent.** Every bail-out was silent by design (none is an error), which made "nothing happens" impossible to diagnose. Set `CONFIG.debug.darkestAmbience = true` in the console and each one reports itself: not the primary GM, setting off, Syrinscape global missing, audio still locked, or no soundscape for this scene.

A scene change that arrives while audio is still locked now arms the unlock watcher too, so it retries after the first click instead of doing nothing.

## 0.28.1-alpha (2026-08-12)

**Fixed: scene ambience never started if you turned it on after loading the world.** The audio-unlock watcher was only armed during startup, and only when the setting was already on — so enabling it mid-session (the normal way anyone turns it on the first time) left nothing waiting for the browser's audio unlock. `apply()` hit the locked-audio guard and returned silently, and nothing ever retried.

Playing a sound by hand from the Playlists sidebar still worked, which made it look as though only the automatic transitions were broken. The watcher is now armed regardless of the setting's state, and again when the setting is switched on.

## 0.28.0-alpha (2026-08-12)

**Reverted three changes from 0.27.0** that were made on rules readings that didn't hold up:

- The **death check** clamp is back. Removing it made death mathematically certain (a needed 14 on 2d6) at high Doom counts — a real change to how lethal the game is, and not one to make quietly.
- **Timed boons** can be dialled down again. A wound bane is unavoidable so locking it is right; a boon "for the rest of the day" is a judgement call the GM should keep.
- **Resist Unconsciousness** uses the highest wound again, as the rules say ("Roll against the Rating of their MOST GRIEVOUS wound").

The two fixes that survived review are kept: equipment armour is still honoured when taking damage, and the travel/ambience state fixes stand.

**Fixed: NPC damage could be silently lost.** Two hits landing within the same write window both read the same starting total and the second overwrote the first — 4 and 5 together recorded 5, not 9, and the NPC survived longer than it should. Rare, but it discarded a player's hit outright. Also stops a duplicate "defeated!" message.

**Fixed: transgression increments could be lost the same way**, advancing the witch's track slower than play warranted. Only the level write is serialised — the damping cooldown keeps its own separate queue and still counts every roll, so the pacing options behave exactly as before.

## 0.27.1-alpha (2026-08-12)

**Reverted a wrong "fix" from 0.27.0.** A target-armour field was added to the Deal Damage dialog. Targets don't have armour — an NPC has a Rating and nothing else, and the rules put armour on the *defender's* own roll ("when defending: damage die + foe's attack Rating − own defense Rating"). A target's Rating **is** its defence. The field is gone and the dialog says so.

The armour fix on **Take Damage is correct and stays**: that's a player defending on their own sheet, where "Defense Rating = Character Rating + Armor Bonus" genuinely applies and equipment armour was being ignored.

## 0.27.0-alpha (2026-08-12)

A full review of the codebase. Seven real bugs, two of them affecting every fight.

**Fixed: equipment armour was ignored when taking damage.** The sheet computed armour from equipped items (light +1, heavy +2), displayed it in the defence total, and then the Take Damage dialog read the *raw* armour field instead. A character in heavy armour with no manually-entered number defended at their base rating — **every wound they took was up to 2 points too high**.

**Fixed: death checks were easier than the rules for the most cursed characters.** Dooms subtract from the effective rating, but the result was clamped to a minimum of 1 — so a Rating 3 character with 5 Dooms rolled as though they had 1 rather than -2, a three-point discount at the moment of dying.

**Fixed: the Resist Unconsciousness button could roll the wrong wound type.** It used the globally highest wound, so a character with two mental wounds and one larger physical wound rolled a *physical* check — against a type that had only one wound and shouldn't have been checked at all.

**Fixed: travel could lock up permanently.** Arriving from or abandoning a held journey cleared the in-flight guard *after* a server round-trip. If that round-trip failed — a dropped connection, a restarting server — the guard stayed set and every travel action was refused for the rest of the session, recoverable only by reloading.

**Fixed: a long scene load could silence a hold.** The veil's failsafe timer lifted the screen without preserving the looping travel bed, so if the travelling scene took longer to activate than the failsafe allowed, the roleplay played out in silence with no way to restart it.

**Fixed: ambience could become unstoppable after crossing a region border.** Sounds were tracked by id and a single current region, but the same element can appear in several regions' playlists. After moving on, stopping it resolved to a *different* copy — silencing the wrong document and leaving the real one playing forever. Sounds are now tracked by the exact document that was started.

**Also:** timed boons now have the same locked floor timed banes do, so the two are treated consistently rather than one being advisory and the other mandatory.

## 0.26.0-alpha (2026-08-12)

**Boons and banes now apply to damage rolls.** Timed effects pre-filled the action roll dialog but were ignored entirely by Deal Damage and Take Damage — the boons counter there was hardcoded to zero. The rules are explicit that *"Damage CAN have Boon/Bane"*, so a boon lasting "the rest of the day" now helps the swing as much as it helps the action.

Both damage dialogs also list which effects are applying and why, the same way the action roll does.

**Wound banes were already working** on both damage rolls — they pre-filled and locked the minimum. Unchanged.

**Fixed: counted effects were never spent by damage rolls.** Only the action roll ticked down "next N rolls", so a one-roll boon would have kept applying to every swing indefinitely. Damage rolls now consume them too, after the roll resolves.

## 0.25.0-alpha (2026-08-11)

**Invalid paces are now greyed out, and say why.** Picking "By pirogue" on a dry forest trail used to be accepted, then silently fall back to walking — correct behaviour, invisibly applied. The dropdown's old "road only" / "swamp only" hints made this worse: they checked the *region* the party was standing in, while travel gates on the chosen *route*, so a boat looked available anywhere in the swamp.

Now the option itself is disabled with the actual reason — "no water here" once a route is picked, "no boat in this region" before one is. Selecting a route that invalidates your current pace resets it and tells you.

**Driving has its own flavour text at last.** A driver on The Road was reading walking prose — including the line "the road surface is cracked but level, and the walking is easy", from inside a car. Eight new lines, written naive like the arrival text: nobody in this party has a word for an engine, so it is measured against horses and footsteps.

Boat flavour already existed (16 lines across the Dismal, a Town Called Dismal and the Flood) and is unchanged. A multi-leg journey only counts as driven if *every* leg was road.

## 0.24.4-alpha (2026-08-11)

**Fixed: the travel tool now has a dark background.** It never set one, so it inherited Foundry's light parchment while every text colour in it assumed a dark panel — light text on a light ground. That was the real reason the hints were unreadable, and why brightening the text in 0.24.3 didn't help.

## 0.24.3-alpha (2026-08-11)

**Fixed: unreadable text in the travel tool.** "Hold for roleplay", its explanation, the ambience readout and the travelling-scene row all rendered in a grey meant for the light parchment sheet, not the dark app window — and Foundry's core styles were winning on specificity, so the system's own colour never applied.

A `--darkest-text-dim` variable now exists for muted text on dark surfaces; it had been referenced in several places without ever being defined, silently falling back each time.

## 0.24.2-alpha (2026-08-11)

**Fixed:** in the travel tool, the "Preview art" / "Show players" buttons sat hard against "Set day & time" above them, and "Show players" wrapped onto two lines. They now size to their labels rather than inheriting Foundry's full-width button.

## 0.24.1-alpha (2026-08-11)

**Fixed:** the Boons & Banes empty state ("Nothing helping or hindering right now") sat directly against the Wounds header below it. The populated list gets its spacing from the rows themselves, which a bare line of text doesn't have.

## 0.24.0-alpha (2026-08-11)

**Syrinscape scene ambience.** Every location now has a soundscape that plays automatically as the party moves and as the day turns — 12 region beds and 84 per-location overrides, each chosen against what the book actually says about the place. A Gathering of Crows gets crows because *"the dead trees are filled with crows"*; the Stone Circle gets almost nothing because it is *"devoid of birds, insects, or other natural sounds"*.

Each place has up to four layers:

| Layer | When |
|---|---|
| `core` | always — the terrain itself |
| `light` | dawn, day **and** dusk — any light at all |
| `dark` | night |
| `sunless` | *added* once dusk and night merge on day 6 |

Only the layers that change are touched, so **the core never restarts** — the woods keep creaking while the birds hand over to the crickets. Moving between two places that share a bed leaves it running untouched, so travel within a region has no seam.

Because `light` covers dusk, and dusk expands as the days shorten, birdsong doesn't vanish as the light fails — it goes from 63% of the day to 42% and stays there. The sun stops rising and the woods carry on as though nothing has happened. The `sunless` layer is what makes that wrong.

It works through **Foundry Playlists**, not the Syrinscape API directly: one playlist per region, each sound flagged for Syrinscape Controller. That means individual stop (the raw API only offers a global one), per-sound volume, and every element auditionable from the Playlists sidebar without a rebuild. **Sounds you start yourself are never stopped by this.** Off by default; needs the Syrinscape Controller module.

The travel tool shows what's playing and why, so silence can be diagnosed without opening a console.

**A travelling scene ships with the module** — a woodcut treeline, deliberately anonymous so it serves every region. Set it once in the travel tool and the hold-for-roleplay mode has somewhere to hold.

## 0.23.0-alpha (2026-08-11)

**The transition now knows how far they went.** Every journey used to get the same fade, whether it was a few steps between two clearings or a full day's march. The configured pause is now the *floor*, and longer journeys stretch towards a new ceiling (default 4s), reached at eight hours on the move. The curve is a square root, so the difference between a hop and a hike is felt while the difference between eight hours and ten isn't.

The fade is deliberately only part of the pause — the screen sits fully black for the remainder rather than spending the whole transition easing, which also means the scene never swaps at the exact instant the veil finishes.

**Hold for roleplay.** A new checkbox on the travel tool. The party sets out, moves to a generic **travelling scene**, and stays there — ambience looping — until the GM presses **Arrive**. Room to talk on the road, instead of setting out and arriving in the same breath.

- Arrive and Turn back sit on the chat card *and* the travel tool, since the GM is usually watching chat during roleplay.
- The journey's time passes when they set out, so the conversation is free. The time-skip buttons still work during a hold if you want it to cost something.
- Turning back returns them to where they set out from and does **not** rewind the clock — they walked out and walked back.
- The hold is stored in world settings, so a browser refresh mid-scene recovers instead of stranding the party.
- Pick the travelling scene from the foot of the travel tool. Without one set, the checkbox stays hidden.
- The travelling scene is never dimmed by the clock — it's a transition, not a place.

**Fixed: travel ambience never stopped.** The bed under a transition was meant to fade out on arrival and instead played on over the destination until the file ran out. `playTravelAmbience()` returned a boolean rather than the sound, so the fade-out had nothing to act on — and because Foundry's `AudioHelper.play` resolves asynchronously despite its documentation, the handle has to be awaited before it can be faded at all.

**Fixed: the veil could be removed mid-fade**, snapping the screen back instead of easing it, when the fade ran longer than a hardcoded 900ms.

## 0.22.0-alpha (2026-08-10)

**Boons and banes that last.** The rules give effects durations — *"a Boon to all actions for the rest of the day"*, *"a Bane for a day from loss of blood"*, *"the Bane lasts until the character cleans all the oil off"* — but the system only had per-roll counters, so anything lasting had to be held in the GM's head.

A new **Boons & Banes** section on the character sheet tracks them in three shapes:

| Duration | Behaviour |
|---|---|
| For the next N rolls | Counts down as you roll, clears itself |
| For a set time | Expires against the travel clock |
| Until something changes it | Cleared by hand |

They **pre-fill the roll dialog** the way wound banes already did, and the dialog now lists which effects are applying and why — a number never appears unexplained, and you can still override before rolling. Counted effects tick down *after* the roll, so one reading "next 1 roll" is visibly applied to the roll that spends it. Effect banes stack with the wound bane, since the rules only say banes don't stack from multiple *wounds*.

Players can add and clear their own.

**Whisper to several players at once.** Clicking a name now selects rather than sends, with All/None and a Send button. Each recipient gets their **own private copy**, so nobody learns who else was told.

**Travel distance and time totals** in the session log's Movement tab, with a per-leg Distance column. Distance is honest about what the book doesn't record: routes quoted only in hours are converted at walking pace, and unmeasured ones are excluded *and counted* ("3 legs had no recorded distance") rather than guessed at. Time is always exact.

**Scene darkness follows the clock** — new, and **off by default**. Scenes dim through dawn, dusk and night, and as the daylight-decay rule shrinks the day, midday itself stops reaching full light: by day 4 the brightest hour is already dusk-level. There's a 0–1 intensity dial, and it will never touch a scene you have lit by hand — it only manages scenes it has claimed.

**Location artwork, on your cue.** A **Preview art** button in the travel tool opens the current location's key art on your screen; a separate **Show players** hands it over. Deliberately two actions — some locations are their own reveal. 126 pieces of art shipped in the module and were never shown to anyone.

**Also:**

- The **Player Reference** compendium (birdsong symbols, tarot) is finally readable by players. It shipped GM-only despite the label, so nobody could look up a birdsong they had learned.
- **Weather now covers 10 regions instead of 4.** The Lost — where most parties spend their first sessions — had none at all. The Road and the Temple are deliberately left clear.
- Delegated GM actions elect a single GM properly, in a shared helper rather than a closure, so a co-GM can't double-fire them.

## 0.21.0-alpha (2026-08-10)

**Session log entries can be deleted individually.** Clearing the whole log was the only option, which is no use when you're testing inside a live campaign — you'd lose the real session record along with the junk.

- An **×** on any movement, roll or transgression row deletes just that entry. No confirmation; it's one row.
- **Clear all movement / rolls / transgressions** per tab, with confirmation, leaving the other tabs untouched.
- The Dice tab previously showed only aggregate stats, so there was nothing to click to remove a stray test roll. It now lists **Recent rolls** (last 40) with who, the roll, total, Darkest Die and outcome — delete one and the stats above recalculate without it.
- Entries recorded before this change had no identity of their own; their ids are backfilled on read, so older log data is deletable too.

**NPC Tracker layout fix.** In the quick-create row the Rating and How Many values were invisible — the inputs inherited Foundry's default text colour against a dark field — and the Add button was absorbing the leftover width, squeezing the name box to a sliver. The row is now a two-line grid with explicit colours, a labelled name field, and a full-width Add button.

**Groundwork:**

- New `module/apps/audio.mjs` — plays birdsong and travel ambience from files the GM supplies, on Foundry's **Environment** channel so it sits under the ambient volume slider rather than competing with dice clicks. Drop `birdsong-thrush.ogg` or `travel-default.ogg` into `extracted_content/audio/` and the build picks them up; see `AUDIO_GUIDE.md`.
- Birdsong play buttons appear only when a clip for that bird actually exists.
- Removed a Syrinscape passthrough that could never have worked — it probed `game.syrinscape`, which belongs to a different module than the one in use. The correct API is documented in `audio.mjs` for whenever that integration is picked up.

## 0.20.0-alpha (2026-08-10)

**Quick creatures in the NPC Tracker.** Type a name and a Rating, hit Add, and the creature is created and tracked. Rating is the only number a creature needs in this system — it sets the defeat threshold (Rating × 3), the instant-kill line (Rating + 3), and the number to hit it — so the form shows all three before you commit.

- **Counts.** "Wolf ×3" creates Wolf 1, Wolf 2 and Wolf 3 as separate creatures with their own wound totals. A single creature stays unnumbered.
- Quick creatures are real Actors, so they can still be targeted, dropped on the canvas, and opened. They go in a **Quick NPCs** folder and are flagged, so a **Clear spent** button in the tracker footer sweeps up the ones no longer being tracked — and never touches anything you built yourself.
- **The tracker no longer blocks duplicates.** It used to refuse to add an actor already in a slot, which made a pack of wolves impossible to track. Three wolves are three creatures with three wound totals.
- **Slots raised from 6 to 12**, since a pack plus a witch overflowed the old cap immediately.
- Adding several NPCs is now a single write rather than one per creature.

## 0.19.1-alpha (2026-08-10)

Bug fixes from a full review of the 0.18/0.19 changes. Three of these were data-loss or double-counting bugs that would have shown up in play.

- **Fix: multi-leg journeys lost their intermediate stops from the session log.** The legs were recorded in a loop without awaiting, and each write re-read the setting before the previous one had landed — so a five-leg journey saved one entry instead of five. Since public chat deliberately never names destinations, the log was the *only* record of those stops, and the "Path walked" map was drawn with holes in it. Writes are now queued.
- **Fix: with two GMs connected, one player's transgression advanced the track twice** and posted two stir messages. The socket handler gated on "is a GM", which is true on every GM client at once. Delegated actions now elect a single GM (lowest id among active GMs, so every client agrees), which also fixes double-counted rolls in the session log and duplicate GM whispers.
- **Fix: the transgression cooldown under-counted when several players rolled at once** — the exact case the feature exists for. Four simultaneous rolls each read the same counter and wrote the same value back, so the cooldown advanced by one instead of four. Now serialised.
- **Fix: a failed scene activation left the transition half-finished.** The clock had already advanced, but the arrival message, the arrival hook and the dial refresh were all skipped, and every client sat behind the veil until its own 5-second failsafe fired. The transition is now exception-safe and the veil always lifts.
- **Fix: double-clicking Travel could advance the clock twice, lift the veil mid-journey, and throw** on a queued multi-leg route (the leg list is cleared before the pause, so a second call read an empty array). Travel now refuses to start while a journey is in flight.
- **Fix: a damped transgression could post a different message tier than a live one.** The tiers step at levels 5 and 10, and the held message used the current level rather than the one it would have reached — so at levels 4 and 9 a player watching the wording could tell the pacing rule was on. Damped and live messages are now identical at every level.

## 0.19.0-alpha (2026-08-10)

**Transgression pacing** — an optional house rule for tables that found the track advancing faster than it could be narrated.

The Darkest Die is the highest of three d6 **25.4%** of the time. With four players that is very close to one transgression *per round of combat*: a five-round fight advances the track about five levels, half the witch's cycle, with no room to describe one before the next arrives.

Three modes, off by default, chosen in system settings:

| Mode | What it does | 5-round fight, 4 PCs |
|---|---|---|
| Off | Default rules | 5.1 advances |
| Cooldown in minutes | Ignores triggers for N real minutes after one lands | 1.5 at 5m |
| Cooldown in rolls | Ignores triggers for the next N rolls | 1.7 at 3 rolls |
| Provocation | Needs N triggers to advance one level | 1.4 at 3 |

**All three still stir the woods on every trigger.** The public ominous message fires exactly as before, so players cannot tell a held trigger from a live one — only the tracker is held back. The GM gets a quiet whisper saying why.

Worth knowing when choosing: **provocation mode also heavily damps exploration**, where rolls are scattered — about 0.05 advances across four rolls in 40 minutes, against a baseline of 1.0 — because the count accumulates too slowly to ever reach the threshold. The minute-based cooldown damps combat hard while leaving exploration nearly untouched, so it is the best all-round choice. The roll-based cooldown is the one that behaves identically regardless of how fast your table plays.

The tracker shows the current cooldown state, with a button to clear it.

## 0.18.0-alpha (2026-08-10)

**Arrivals.** Travelling is now two beats instead of one. The party sets out, the screen holds for a moment, the scene changes, and then they arrive — with a description of where they've ended up and the time it now is. Previously the chat message landed and the canvas swapped underneath it, which read as a jump cut.

- **131 per-location arrival lines**, written from the book's own read-aloud text. They never name the destination, never pre-empt a reveal, and stop short of what you're about to describe yourself. 31 locations that *are* their own surprise (Another Rake, the Upper Sanctuary, Lester) deliberately fall back to a generic regional line instead.
- Arrival text can be turned off entirely in system settings; the transition pause is configurable (default 1.5s, 0 disables it and the fade).
- **A fade on every screen** during the transition, so players don't watch a hard canvas swap. It removes itself after 5s no matter what, and never blocks input — a dropped socket message can't strand anyone in the dark.
- The clock moved from the departure message to the arrival one. It used to announce "it is now 16:40" before the party had actually got anywhere.

**Fix: 38 location scenes had no region flag** — the whole of the Road, the Ghost Caves, the Rootrealm and the Temple of the Moon. The build script only assigned regions to areas that got their own folder, and those four never did. Consequences, all now fixed:

- **"Endless Night" on the Road had never once displayed.** The Road's fixed-time region is a signature piece of the setting and the flag it keys off was never set.
- The driving pace flagged itself as unavailable *on the actual road*.
- Those 38 locations produced no atmospheric travel line at all, and six hand-written Road lines were dead code.

**Also:**

- New flavour tables for the Ghost Caves, the Rootrealm, the Temple of the Moon, and walking (as opposed to boating) in a Town Called Dismal.
- Atmospheric lines no longer repeat back-to-back. With six lines per region, uniform random hit the same one about one travel in six, which reads as a bug rather than as weather.
- **The day the sun stops rising** now gets its own public message. The exact daylight hours stay GM-only — the characters can't measure them — but a dawn that doesn't come is a fact anyone would notice, and it only happens once.
- **Birdsong play buttons** in the travel tool, next to each toggle. The recordings ship inside location playlists; the button plays one to the whole table. Hidden when that region hasn't been imported.
- New hooks `darkestSystem.travelBegin` and `darkestSystem.travelArrive`, and travel chat messages now carry `flags['darkest-system'].travel` so they can be identified without sniffing the DOM.

## 0.17.0-alpha (2026-08-09)

**Pirogues.** The Dismal's residents keep flat-bottomed swamp boats moored at the pier, and the Flood has a raft by the Bosque. "By pirogue" is now a travel pace alongside walking and driving.

- Wading is now modelled properly, which the tool was previously ignoring: the book says watery paths are walked **at half speed**, so flooded trails and waterways now take twice as long on foot. A 1.6 km flooded trail is 48 minutes wading, 24 minutes on dry ground.
- A pirogue removes that penalty and is a little faster besides — "normal walking speed, or even a bit faster" — so the same flooded trail is 19 minutes by boat. Routes are detected as navigable from their labels ("Flooded Trail to the West", "Waterway to the North").
- A boat on dry land falls back to walking, the same way driving does off-road. The pace dropdown flags "swamp only" outside the Dismal and the Flood.
- Travel descriptions change with the mode: the party *poles* the waterway north rather than following it, and a multi-leg journey entirely on water reads as "stretches of water".
- The Dismal and the Flood have their own on-the-water atmosphere lines. The walking ones are written from inside the mud — clinging clothes, uncertain footing — which is wrong for someone sitting in a boat. Conditions only, as before.

## 0.16.3-alpha (2026-08-09)

- Fix: everyone except the person rolling saw only the Darkest Die — the main 2d6/3d6 never appeared on their screen. Sequencing the two animations means suppressing Dice So Nice's automatic one (`flags['dice-so-nice'].skip`), but that flag travels with the chat message to *every* client, so observers' own Dice So Nice sat out the main roll too, and `showForRoll()` only animates on the client that calls it. The roller now broadcasts the sequence over the system socket and all clients play the same two-stage animation locally. Whispered rolls still only animate for their intended recipients.

## 0.16.2-alpha (2026-08-09)

- The journey planner's From/To pickers are now searchable text boxes rather than dropdowns. 63 of the 131 locations start with "The", so type-ahead on a plain select was near useless — you can now type any part of a name ("cemetery", "weald", "baba") and filter as you go.
- Matching is forgiving: exact name, slug, the name ignoring a leading "The", or a unique partial match all work. Ambiguous input is deliberately rejected rather than guessed — typing "stone" won't silently pick between the Stone Circle and the Stone Terror.
- Choosing a destination from the list plans the route immediately, but does so quietly, so tabbing out of a half-typed name doesn't throw a warning mid-thought.

## 0.16.1-alpha (2026-08-09)

- Reordered the travel tool so the everyday flow comes first: the "Route from here" picker, distance, pace, and Travel now sit directly under the clock. Cross-map journey planning and the birdsong toggles moved below them — both are useful but reached for far less often than simply stepping out of the current location.

## 0.16.0-alpha (2026-08-09)

**Driving.** The Road is a real paved road with a working car on it, so the travel tool now has a Driving mode (50 km/h) alongside the walking paces.

- Driving only helps where there's a road. On a forest trail it silently falls back to walking speed — a car at a trailhead is a parked car. The pace dropdown flags "road only" when the current scene isn't drivable.
- Fixed a subtlety this exposed: The Road's routes are quoted in the book as *durations* ("about three hours down the road"), and those are **walking** times. The old code scaled durations by pace ratio, which is right for walking but meant "3 hours" stayed roughly 3 hours in a car. Durations are now converted back to an implied distance at walking speed before the actual pace is applied, so a 7-hour walk becomes a 34-minute drive. Walking times are unchanged (the two formulas are algebraically identical).
- Travel descriptions know the difference: "The party drives on up the road" rather than "follows the trail north", and a journey entirely on roads reads as "stretches of road" rather than trail.

## 0.15.1-alpha (2026-08-09)

- Weapon damage modifiers can now be **negative**. The field existed and worked for bonuses (the iron spike's +1 to damage Rating), but the item sheet capped it at 0, and a negative value would have been filtered out of the Deal Damage dialog entirely — listed as neither a weapon nor ordinary gear, so it would simply vanish. Cursed or unwieldy weapons at -1 now work.
- Renamed the field "Damage Rating Modifier" (it isn't always a bonus), and the dialog now shows the sign correctly — no more "(+-1 Rating)" — with penalties in red rather than the bonus green.

## 0.15.0-alpha (2026-08-09)

**Cross-map journey planning.** Later in a campaign the party will stand somewhere and decide to go back to a place three regions away — planning that leg by leg was unusable.

- **Pick two locations, get a route.** A From/To pair (From defaults to where the party is) runs a shortest-path search across all 131 locations and loads the result into the leg queue as an editable plan. It finds the *quickest usable* route, which is deliberately not the same as the route the party would find — whether they know the way is a call only the GM can make, so the plan lands in the queue to accept, trim, or discard rather than being walked automatically.
- **Birdsong trails are gated.** The book's 9 secret trails are now tagged in the route data (via the source's own `iconType`, which marks them far more reliably than the label text) and excluded from route-finding until the party learns the relevant birdsong. This has real teeth: Baba Yaga's Hut is genuinely unreachable until a birdsong opens the way, and the tool says so rather than silently failing.
- **Birdsong toggles appear in both the travel tool and the Transgression Tracker**, backed by one shared world setting — toggling in either place updates the other, since knowing a birdsong is campaign progress as much as a travel option.
- Routes the book never quantified are now charged a small nominal cost in pathfinding rather than counting as free. Treating them as zero made the finder prefer absurd paths — a 16-leg detour through the Rootrealm scored "faster" than an 8-leg walk purely because its legs were unmeasured.

## 0.14.0-alpha (2026-08-09)

- **Multi-leg journeys.** The party often pushes through several locations in one go, which previously meant a separate trip, chat message, and scene change for each. You can now queue legs with **Add leg** and walk them as one journey: a single message, a single arrival at the far end, and the clock advanced by the whole duration. The route dropdown follows the queue, so each pick continues from the last stop rather than from where you started. Only the first leg is described in chat — naming every turn would spell out the route the party is still discovering.
- The route dropdown now lists **only routes leaving the current scene**. The "Everywhere else" group listed all 318 routes and was unusable; the useful ones are always the exits from where the party actually is.
- Fix: the travel tool's labels and preview text were still unreadable. Foundry core styles labels inside its own windows at a specificity a plain class can't beat, so these are now scoped through the app window and marked important.

## 0.13.7-alpha (2026-08-09)

- The shrinking daylight is no longer announced to players. Saying "barely 8 hours of true light remain" gave the characters a measurement they can't possibly have — on day 2 there's nothing to compare against — and pre-empted the realisation the players should reach themselves. Public messages now say only that a new day has begun.
- The GM still gets the detail, whispered: how far the light has fallen, plus the reminder to check exposure, rest locks, and daily ability uses. That reminder was previously in the public message too, where players could read the GM's bookkeeping.
- The dial's hover text follows the same split — players see the phase and day, the GM also sees the remaining daylight. Once the sun stops rising entirely both sides are told, since by then it's plainly observable.

## 0.13.6-alpha (2026-08-09)

- Fix: **mid-afternoon was reading as night.** The day cycle was anchored at hour 0 = dawn, which crushed dawn/day/dusk into the morning and left night covering the entire afternoon and evening — on Day 1, night began at 15:00. The lit part of the day is now centred on midday and eaten from both ends as the days shorten, so the clock reads the way people expect: Day 1 has dawn ~04:30, daylight until ~16:30, dusk to ~19:30, night after; by Day 6 it's dusk 07:00–17:00 and night the rest, still matching the book's 10h/14h end state. Night correctly wraps through midnight.
- Fix: the travel tool's field labels and preview text were nearly unreadable — Foundry's own window styling was overriding them at higher specificity with a dark colour.
- Fix: changing scenes by any other means (the scene nav, the sidebar) left the travel tool stale — its "From here" route list and the region it reads for flavour both depend on the active scene. It now refreshes on any scene change, not just when travelling through the tool.

## 0.13.5-alpha (2026-08-09)

- Fix: routes with no distance ("a few steps" between adjacent locations, or one the book never quantified) couldn't be travelled at all — the button required a computed duration, so those routes could never move the party or switch the scene. Picking a route is now enough on its own: it travels and switches scene without advancing the clock. A typed distance still takes precedence when there is one.
- The chat message no longer claims "0m passes" for those journeys; it just reports the current time.
- Fix: changing the route dropdown now always resets the distance boxes. Previously, picking a route with no distance (or clearing the dropdown) left the previous selection's numbers behind, so the next trip silently travelled the wrong distance.

## 0.13.4-alpha (2026-08-09)

- The pass-time buttons now post a plain "Time has passed." instead of narrating ("The party rests" / "waits" / "lingers a while"). The GM describes what happened and triggers whatever follows — the message just records that the clock moved. Travel keeps its journey description and regional flavour.

## 0.13.3-alpha (2026-08-08)

- Rewrote the region travel flavour to describe **conditions only** — terrain, weather, temperature, light, smell, footing. The previous set included lines that implied events ("Something disturbs the water nearby and does not surface", "Tracks appear alongside the party, then stop"), which stole beats belonging to the GM: a random line shouldn't make players ask "wait, what was that?" Nothing in the table now implies a presence, an event, or anything uncanny.
- Expanded from 5 to 6 lines per region (48 total) so repeats come round less often.

## 0.13.2-alpha (2026-08-08)

- Fix: the dial sat on top of the connected-players list. It now measures the player list at runtime and sits directly above it, so it stays clear no matter how many people are connected.
- Fix: the route dropdown was unreadable — the open list is painted by the browser, not the select box, so it needs its own colours. Options and group headers are now themed properly.
- **Travel no longer spoils destinations.** The public chat message used to name where the party was going ("The Abandoned Campsite → Cave Mouth"), which the players shouldn't know until they arrive. It now describes the journey from their point of view instead — "The party follows the trail north" — using the book's own exit labels, which are already written that way. The GM's dropdown still shows real destinations.
- **Region-specific travel flavour.** A random atmospheric line is added to travel messages, drawn from each region's stated conditions — ash and heat in the Ravages, rising water in the Flood, thickening undergrowth in the Backwoods. Purely sensory: no destinations, mechanics, or plot beats, so it's always safe to show players. Passing time deliberately gets none — that's the GM's to narrate.
- **Travelling now activates the destination's scene**, if that region has been imported. If it hasn't, it says so rather than failing silently.
- Added a 30m option to the pass-time buttons, for places the party won't linger.
- Added **Set day & time** for moving the clock directly — flashbacks, time skips between arcs, or fixing a misclick.

## 0.13.1-alpha (2026-08-08)

**The woods eat the daylight.** Per the book: the first day and night pass normally, but after that "the days begin to grow drastically shorter, with dusk and dawn growing longer until finally they merge," settling at "about ten hours of dusk and fourteen hours of night."

- The clock now models this. Day 1 runs a normal cycle (~10h of true daylight); daylight then collapses over the following five days until, from **day 6 onward, there is no daylight at all** — just 10h of dusk bleeding into 14h of night, permanently. The book doesn't say how long the transition takes, so five days is a deliberate choice: fast enough for players to feel it inside a typical arc, slow enough to be a dawning realisation rather than a switch.
- The dial shows it: hovering reports how much true daylight is left in the current day, and once the sun is gone for good the day counter reads "Day N · sunless".
- Day rollovers now say so in-world — "The daylight is shorter again — barely 6 hours of true light remain", and the first sunless day announces "Dawn does not come. Dusk and night have merged — the sun will not rise again."
- The travel tool's clock panel shows the remaining daylight for the current day.
- Note the displayed time is cycle position, not solar time — 00:00 is daybreak. In woods that end up with no sun, a solar clock would be meaningless.

## 0.13.0-alpha (2026-08-08)

**New: Travel & Time tracking.**

- A **sun/moon dial** now sits at the bottom-left of the screen for everyone, showing the current time, day count, and phase (dawn / day / dusk / night) with a tinted icon for each. It's region-aware: standing in The Road, which the book describes as "night always," the dial reads *Endless Night* regardless of the underlying clock -- time still passes there, it just never looks like daylight.
- A **Travel & Time tool** (GM, token-layer button -- or click the dial) advances the clock by travelling a route. Pick a route from a dropdown and choose Slow (3 km/h), Normal (4 km/h), or Fast (5 km/h); it shows the duration and arrival time before you commit. Pace only changes how long the journey takes -- it deliberately carries no other mechanical effect, since the rules don't define one.
- The route dropdown is **context-aware**: routes leaving the location whose scene you're currently viewing are listed first under "From here", with everything else below. With 318 routes in the book, an unsorted list would be unusable.
- **Route distances come from the companion module** (`travel-data.js`, generated at build time by parsing the book's own exit-scene text). 271 of the 318 routes have a machine-readable distance -- either a km figure or an explicit duration like "about three hours down the road." The remainder fall back to manual km/hours entry, which is always available. Two source typos where metres were labelled km ("a half mile (800 km)") are corrected during parsing.
- Quick "pass time" buttons for 1h / 4h / 8h (sleep) cover resting and waiting without inventing a journey.
- Time changes post to chat, and crossing midnight flags a new day with a reminder to check exposure, rest locks, and daily ability uses. Per design, **nothing is auto-applied** -- the dial tells you when, you decide what.

## 0.12.4-alpha (2026-08-08)

Full codebase audit pass -- three real bugs fixed, one missing UI entry point added.

- Fix: **shift-click quick Action Roll ignored wound Banes.** The quick-roll shortcut hardcoded `banes: 0`, so a wounded character shift-clicking rolled a clean 2d6 instead of the required 3d6-keep-lowest-2. The full dialog was always correct; only the shortcut was wrong.
- Fix: the `darkestSystem.doomGained` hook fired via local-only `Hooks.call()`, so when a *player* called upon the woods the GM never got the "gained a Doom" notification (the Doom item itself was created correctly). Now delegates the notification over the same player-to-GM socket every other cross-client event uses.
- Fix: `rollTakeDamage` passed the character's *defended* rating (base + armor + situational modifiers) as the instant-kill comparison target instead of their base Rating, inflating the threshold. Currently latent -- that value isn't surfaced for take-damage rolls -- but it was wrong data waiting on a future feature.
- Added: **the Doom Tally had no way to open it.** It was fully implemented and wired up but had no scene-control button and no macro, so it was only reachable from the browser console. It now has its own token-layer button, visible to players as well as the GM (the party's shared Doom count is meant to be public), with the GM-only adjustment controls still gated inside the app.

## 0.12.3-alpha (2026-08-08)

- Transgression escalation now has real stakes tied to the rules: tier 1 (levels 1-4) "The woods stir and whisper", tier 2 (5-9) "The woods are waking. The wind seems to carry distant voices, but you can't make out what they say", tier 3 (level 10) "The woods awaken. You hear it clearly now: '[region's key phrase]'. Something terrible is coming..." -- per the rulebook, each witch's key phrase is meant to leak as a whisper/dream message and encodes a clue about escaping the woods. Falls back to generic wording if no region/key phrase is configured. House mode keeps its existing flat tier wording (no witches/key phrases there).

## 0.12.2-alpha (2026-08-07)

- Verified system mechanics against the official GM reference sheet -- action rolls, Darkest Die tie-breaking (a tie does NOT trigger a transgression, matching the "higher than both kept dice" rule), death check Doom subtraction, and damage all already matched correctly. The four narrative transgression triggers (leaving the path, retracing the same path two days running, killing an animal without gratitude, destroying a large section of woods) can't be auto-detected from dice rolls -- they're GM judgment calls. The Transgression Tracker's existing per-region "+" button already handles marking these (same public tiered message and GM whisper as dice-triggered transgressions); its tooltip now documents this explicitly.

## 0.12.1-alpha (2026-08-07)

- Fix: **all player-to-GM socket delegation was silently non-functional for real (non-GM) player accounts** -- wounds, dooms, NPC damage, GM whispers, and transgression tracking. Root cause: `game.socket.emit()`/`.on()` only actually relays between different Foundry clients if the system's manifest explicitly opts in with `"socket": true` (confirmed against Foundry's own GitHub issue tracker: "Modules do not receive socket events by default"). `system.json` never had this flag, so every socket emit from a player's client reached Foundry's server and then went nowhere -- it silently never worked for a genuine second connected player, even though testing it by controlling a character from the GM's own session appeared to work (that path never needed the socket at all, since `game.user.isGM` is already true there). **Both GM and players need a full reload (not just cache refresh) after this update, since it's a manifest change Foundry only re-reads on load.**

## 0.12.0-alpha (2026-08-07)

- Fix: a whispered ChatMessage is always visible to its own author, no matter who's in the `whisper` list -- so when a PLAYER spent a Doom, dealt damage, or triggered a transgression, the "GM-only" whisper was created on their own client and they saw it too. Doom-spend consequences, NPC damage thresholds/lethal-blow warnings, and transgression tracking now delegate to a GM client over the existing player-to-GM socket (same pattern as wounds/dooms/NPC damage) so a GM actually authors the message.
- Fix: **transgression tracking silently never worked for player-rolled transgressions at all.** `Hooks.call()` only fires locally on the client that calls it -- a player's transgression roll fired the tracking hook only on their own browser, which the GM's client never saw, so `incrementTransgression()` never ran unless the GM personally made the roll. Now delegated over the same socket.
- Removed the "Enable GM-Only Whispers" debug toggle added last version -- it was only ever a workaround for the author-visibility bug above, which is now actually fixed.
- Transgressions now show a public, tiered ominous message to everyone (replacing the old flat "The Woods stir..." line): tier 1 (levels 1-4) is unchanged, tier 2 (5-9) is new ("The Woods are waking...", "The House grows restless..."), tier 3 (10) is new ("The Woods see you...", "The House hates you..."). The specific witch/house action for that level is still GM-only, whispered separately as before.

## 0.11.9-alpha (2026-08-07)

- Fix: the previous fix for dice-animation ordering had it backwards -- the Darkest Die was rolling first, then the main dice. Root cause: only the main dice's chat message triggers Dice So Nice's automatic animation, and that same message also reveals the final result the instant it's created, so simply reordering code around `super.toMessage()` couldn't get both "main dice roll first" and "no spoiler before the Darkest Die finishes" at once. Now explicitly animates the main dice, then the Darkest Die, both fully awaited, with Dice So Nice's automatic animation suppressed for that message (`flags['dice-so-nice'].skip`) so the main dice don't play twice -- only after both finish does the chat message (with the visible result) get created.

## 0.11.8-alpha (2026-08-07)

- Fix: the chat card revealing a roll's outcome (success/failure, total) posted before the Darkest Die had actually finished its Dice So Nice animation, so players could see the result before the purple die stopped rolling. `showForRoll()` for the Darkest Die is now properly awaited before the chat message is created, and the pre-roll delay is trimmed from 900ms to 500ms.
- The GM-only whispers toggle (Settings > Enable GM-Only Whispers) now also covers transgressions -- previously only NPC damage info was gated by it. A GM-only whisper with the real trigger detail (Darkest Die value vs. kept dice, or "Calling Upon the Woods") and doom-gained info is restored, separate from the vague public "Woods stir..." line players see.

## 0.11.7-alpha (2026-08-07)

- Darkest Die animation delay reduced from 1200ms to 900ms, and now waits for the main dice to fully settle before throwing -- the two animations were overlapping and visually colliding (never affecting either result, but looking to players like it could).
- Added a GM-configurable "Enable GM-Only Whispers" system setting (Settings > Configure Settings > System Settings, on by default). Turning it off sends the NPC defeat-threshold/lethal-blow info to everyone instead of whispering it to the GM only -- lets the GM directly verify the whisper is working as GM-only without needing multi-tab/multi-browser test setups.

## 0.11.6-alpha (2026-08-07)

- Fix: dialogs (Action Roll, Deal/Take Damage, New/Heal Wound, Resist Unconsciousness/Catatonia, Death Check, Rest) still stacked up a new copy on every click. The previous fix matched on `ui.windows` by a custom `id` option, but `ui.windows` is actually keyed by Foundry's own internal `appId`, not the id passed to the constructor -- so the lookup never found the old dialog. Each dialog category's instance is now tracked directly and properly awaited-closed before a new one opens, the pattern Foundry core itself uses for cached single-instance apps.
- Fix: the player-facing transgression message ("The Darkest Die was highest — the witch acts!") named the exact mechanic that triggered it, which is meant to stay a GM-side detail. Players now see a vaguer, more ominous line ("The Woods stir..." / "The House stirs..." in House mode) with no mechanical explanation attached.
- The Darkest Die's Dice So Nice animation delay increased from 400ms to 1200ms -- the previous delay wasn't enough separation from the main dice roll's own ~1.5-2s animation, so it was still finishing at roughly the same time instead of visibly last.

## 0.11.5-alpha (2026-08-07)

- The Darkest Die's Dice So Nice animation now starts on a short delay after the main action dice, so it reliably finishes last instead of racing (or finishing before) them.

## 0.11.4-alpha (2026-08-07)

- Fix: Action Roll, skill-badge, Deal Damage, Take Damage, New Wound, Heal Wound, Resist Unconsciousness/Catatonia, Death/Catatonia Check, and Rest dialogs never closed a previous copy of themselves — clicking through several roll buttons in a row left every dialog open and stacking up instead of replacing the last one. Each dialog category now closes any existing window of its own kind (per-character) before opening a new one.
- Fix: with Foundry's light UI theme active, dialog windows showed a pale strip at the very bottom edge — `.window-content` had no background of its own, so Foundry core's light-theme background showed through wherever our dark content didn't fully cover it. Dialogs now force the dark background at the window level regardless of the user's chosen Foundry UI theme.

## 0.11.3-alpha (2026-08-07)

- Fix: with Dice So Nice installed, the Darkest Die never animated — only the main 2d6/3d6 action dice did. The Darkest Die is rolled as its own separate `Roll` instance (needed to track it independently for transgression checks), so it was never attached to the chat message Dice So Nice automatically animates. It's now explicitly shown via `game.dice3d.showForRoll()` in a distinct purple appearance, so it's visually identifiable at a glance and actually animates for everyone who'd see the roll.

## 0.11.2-alpha (2026-08-07)

- Fix: transgression rolls sent the GM a redundant whispered card repeating the same "The Darkest Die was highest" line already shown publicly to everyone — there's no actual secret mechanical detail attached to a transgression itself (region-level tracking is manual, via the Transgression Tracker app), so the extra whisper was just noise stacked under the public roll. Removed; the public ominous line is now the only notice, seen by GM and players alike.
- Fix: Death/Catatonia Check button appeared as soon as a character was unconscious/catatonic with *any* wound, rather than the actual rule — only once the highest wound's Rating exceeds the character's own Rating.

## 0.11.1-alpha (2026-08-07)

- Fix: the button bar (Roll/Cancel) on Take Damage, Heal Wound, Make a Roll, and other dialogs was being crushed down to ~17px tall and clipped at the bottom of the window. `.dialog-content` had `overflow: visible` with no `min-height: 0`, so as a flex child it refused to shrink below its own full content height when the window hit its `max-height: 90vh` cap — the browser satisfied the cap by crushing the button bar instead, since that was the only sibling still able to shrink. `.window-content` is now an explicit flex column, `.dialog-content` scrolls internally and is the flexible element that shrinks first, and the button bar is pinned to its natural size so it can no longer be squeezed.

## 0.11.0-alpha (2026-08-07)

Full-codebase sweep for the same bug patterns already found and fixed this cycle.

- Fix: **Unconscious/Catatonic status could never be cleared.** A failed resist roll set the flag permanently — a comment claimed an "updateActor hook" auto-cleared it when wounds healed, but that hook didn't exist anywhere in the codebase. Added the real hook (fires when a wound's healed flag actually changes, clearing the status if no wounds of that type remain) and a manual override: click the Unconscious/Catatonic banner on the sheet to clear it directly.
- Fix: the Transgression warning banner and Darkest-Die "highest" highlight were still gated behind `{{#if isGM}}` inside the *shared* chat message — the same static-HTML-rendered-once bug already fixed for NPC damage info, just not fully cleaned up. The redundant GM-only banner (duplicate of the already-whispered info) is removed; the cosmetic highlight/border classes, which don't actually reveal anything secret, now render consistently for every viewer instead of only whoever happened to roll as GM.
- Fix: Transgression Tracker, NPC Combat Tracker, and Doom Tally windows had no scroll-position preservation, unlike the character sheet — every button click (increment, damage +/-, adjustment) reset them to the top of the window.
- Removed a fully dead `armorBonus` field from the Equipment item schema — declared in `template.json`, never read by any code, never exposed on the equipment sheet, so no GM could ever have set it expecting an effect.

## 0.10.1-alpha (2026-08-07)

- Fix: clicking an ability use-pip (or anything else that triggers a sheet re-render) jumped the character sheet back to the top of the Main tab. Foundry doesn't preserve scroll position across a re-render unless told to; the sheet now remembers and restores scroll position in the body.
- Fix: Modified Ratings badges became full-width rows after being made clickable (turning them into `<button>` elements picked up unwanted default width/display behavior). Restored the original compact inline-chip look while keeping them clickable.

## 0.10.0-alpha (2026-08-07)

- Fix: **NPC Combat Tracker never updated from player-rolled damage.** The auto-apply hook checked `game.user.isGM` on the *roller's* client and silently did nothing if a player (not the GM) made the roll -- regardless of wound rating. Damage dealt by players now correctly reaches the GM's tracker via the same player-to-GM socket delegation already used for wounds and dooms.
- Fix: NPC defeat threshold, lethal-blow warnings, and the GM's transgression notice were leaking to players. A chat message's content is static HTML rendered once by the sender's client -- an `{{#if isGM}}` block inside a *shared* message renders using the roller's own permissions and is then broadcast verbatim to everyone, GM or not. This tactical info now goes out as a separate GM-only whispered message instead.
- Fix: dragging an NPC directly from a compendium tab onto the NPC Tracker silently added a slot the tracker could never display (it only ever looked up NPCs in the World Actors collection). Compendium-only NPCs are now imported into the World automatically on drop.
- Region importer: NPCs are now imported into a region-named folder alongside journals/scenes/playlists when using "Import Darkest Woods Region."
- Deal Damage dialog: the "Weapon Bonus" checkboxes were rendered but never actually read when rolling -- selecting a weapon had no effect on the roll at all. Now applies the weapon's bonus to attack Rating, is single-select (checking one clears any other), shows the bonus in the live preview, and remembers the last weapon used per-character so it's pre-checked next time.
- Character sheet: clicking a Modified Ratings badge now opens the Action Roll dialog with that skill pre-selected. The plain Action Roll button no longer remembers the last-used skill -- it always starts at Base Rating.

## 0.9.0-alpha (2026-08-05)

- Character sheet: ability descriptions now show on both the Main-tab Special Abilities summary and the Abilities-tab list (not just the ability's own item sheet).
- Character sheet: limited-use abilities now show a clickable pip track (same visual language as the Rating dots) instead of plain "N/M uses" text -- click a pip to set uses remaining directly, click the currently-set pip again to clear it to zero.
- Removed a duplicate, dead `.ability-info` CSS rule left over from an earlier layout that was silently being overridden by a later one.

## 0.8.0-alpha (2026-08-05)

- Fix: abilities with limited uses (usesPerDay > 0) never showed their "N/M uses" tag anywhere, because the display logic checked a separate `unlimited` flag that nothing ever actually set -- it was permanently stuck at its default `true`. `unlimited` is now derived directly from `usesPerDay` instead of being a dead manual field, so uses-remaining now correctly shows on both the Main-tab summary and the Abilities tab list.
- Character sheet: the Main-tab Special Abilities summary now shows each ability's full description (rendered, not raw markup) instead of just its name and tags.

## 0.7.5-alpha (2026-08-05)

- Fix: the actual cause of the "can't edit description" issue, found via direct on-screen measurement: `.form-group.stacked` (the wrapper around every description editor) is a flex column with no `align-items` set, so its children -- including the editor -- were collapsing to 0px wide instead of stretching to fill the field. It had real height and existed in the DOM the whole time, just as an invisible, unclickable sliver. v0.7.3/0.7.4 fixed real height problems along the way but not this. Explicit `width: 100%` / `align-items: stretch` now applied at every level of the editor's nested structure.

## 0.7.4-alpha (2026-08-05)

- Fix: the v0.7.3 editor-sizing fix only widened the window for Equipment sheets. Ability, Wound, and Doom sheets were still stuck at the shared 400px default, which wasn't tall enough to fit the header, tab nav, ProseMirror's own toolbar, AND a real typing area all at once -- so the editor stayed visually collapsed even though the flex CSS itself was correct. All item sheets now open tall enough (520px, 560px for Equipment) for the editor to actually have room.

## 0.7.3-alpha (2026-08-05)

- Fix: clicking the pencil to edit a description swapped in a real, working ProseMirror editor (toolbar and all), but the typing area itself collapsed to near-zero height inside the editor box, making it look like editing did nothing. The editor container now properly sizes itself to fit both the toolbar and a real typing area.

## 0.7.2-alpha (2026-08-05)

- Fix: the pencil/edit icon that switches a description field from preview into an editable ProseMirror box had no styling and was nearly invisible on the dark theme. It's now a clearly visible crimson button in the corner of every description editor, with a hover state and a placeholder hint on empty descriptions.

## 0.7.1-alpha (2026-08-05)

- Fix: item sheets (Ability, Equipment, Wound, Doom) had their Description editor stuck in read-only mode — the enriched HTML rendered but couldn't be clicked into and edited. Caused by a missing `await` on the base sheet data call, so Foundry never knew the sheet was editable.

## 0.7.0-alpha (2026-08-05)

- Character sheet: Special Abilities section on the Abilities tab (below Skills/Talents) — create, edit, and delete Ability items directly, instead of cramming powers into the general Traits field
- Item sheet: equipment sheet opens taller so the Description editor isn't scrolled out of view behind quantity/armor/damage/combat-note fields

## 0.1.0-alpha (2026-03-30)

Initial public alpha release.

- Core mechanics: Rating system, 2d6 action rolls, Darkest Die
- Boons/Banes (max 3 dice total)
- Wounds (physical and mental), wound accumulation banes
- Unconsciousness, death checks, catatonia checks
- Doom system with death check penalty
- Damage rolls, armor, NPC tracker with instant-kill rules
- Rest and recovery rolls
- Transgression tracker (content not included — requires companion module)
- Darkest Woods and Darkest House game modes
- Optional rules: Special Success, Partial Success
- Character, NPC, and Creature actor sheets
- Wound, Doom, Ability, and Equipment item types
