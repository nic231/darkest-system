# Changelog

## 0.47.2-alpha (2026-08-19)

**Events are sequenced by when they happened.** The sort forced every event with no game time to the very front, tie-broken by the order they were built — and rolls are built before transgressions. So a session appeared as one block of rolls followed by one block of transgressions, describing an evening that never ran that way.

Game time is still the key when two events both have it. When they don't, the fallback is now the **wall clock**, which every entry carries: the log stamps it on write, and the chat import takes the real moment from the export. Transgressions now land immediately after the roll that caused them, which is what they always were.

**The line no longer flashes at a re-render.** The previous fix covered a paint overtaking another at a map change. This is the same class of race at a different site: `activateListeners` runs on every re-render and issues an async empty paint, which could land *after* a tick's paint — wiping the line mid-run and letting the animation resume from nothing. It no longer paints at all while playing.

**The map keeps the book's colours.** The backdrop had a flat 35% black wash over the real art, which suits the route map — there the line is the point and the art is context. In the credits the map is the main event on a large screen, and that wash visibly greyed it: the reds and greens went flat next to the same image in the app. The wash is now a parameter, and the credits use **0.08**.

**Fields added to the importer reach entries already imported.** Re-importing skips anything already present, which is right for avoiding duplicates and wrong for an entry written by an older version — it keeps whatever gaps it was created with. `calledWoods` was the live case: a roll imported before that flag was carried through reads as "never called upon the woods" forever, so the credits' *Called* column showed 0 for a player who plainly did. Importing now backfills absent fields on entries it already owns, and reports how many it refreshed. Only missing fields are filled, so a hand correction is never overwritten.

## 0.47.1-alpha (2026-08-19)

**Session 1's rolls now land where they happened.** They were arriving all at once at the front of the feed even though the map drew their route perfectly well — the line went through the Abandoned Campsite, the Rake and the Doe and Rake's Ambush while every roll made there sat stacked at the start.

The cause was a gap between two ways of knowing "when". A leg recorded before the travel clock was running carries a real destination but no game day, so `_legMinutes` returns null for it. A roll bracketed onto that leg therefore knew exactly *where* it happened and still had no *when* — and an event with no when falls back to offset zero.

An event that knows its location is now placed as the line reaches that location, which is the same moment a dated roll there would fire. Location known is enough; the game date was never the only way to place something on a route the map already draws.

Rolls that carry a real game time are untouched, and anything with no location at all — imported transgressions, which carry a region but no place — still shows in the opening recap.

## 0.47.0-alpha (2026-08-19)

**Wood folk tokens and birdsongs on screen**, stacked above the doom count in the same column of furniture. Both use the book's own artwork — the painted wood folk token, and the seven Birdsong Symbols.

**The birdsong badge only ever shows what the party has earned.** No empty slots, no "3 of 7", and nothing at all on a player's screen until they learn the first one — an empty badge would still announce that birdsongs are a thing worth collecting. The symbols are also listed in the book's numbering rather than grouped by path, because the two Birdsong Paths are three symbols each: grouping them would hand the players the routes the moment they held two.

Click either badge as GM to set it — a number for the tokens, a checklist for the songs. Players can see both but change neither. There is a macro route too:

```js
game.darkestSystem.PartyTokens.setWoodfolk(3)
game.darkestSystem.PartyTokens.toggleBirdsong('grackle', true)
```

Both badges hide themselves from players while the party has nothing, and a GM keeps them at zero so there is somewhere to click. **Requires content module 1.20.0**, which carries the wood folk token art.

## 0.46.1-alpha (2026-08-19)

**The region maps are whole again.** The camera no longer zooms in once it is on a region — it holds the entire map, still, exactly as before the camera existed. The zoom belongs on the overview, where it says *where in the woods this is*; on a region map it hid the rest of the route and made the art harder to read.

**The crossings are slower, and go all the way out.** The pull back runs to the full extent of the woods, and the line between the two regions is drawn across the whole map so both ends are visible at once. Previously it slid between two tight framings, which barely moved — that is why it read as too fast. The hop is nearly twice as long, and there is now a beat on the finished line before the camera dives back in, so the crossing lands rather than being snatched away.

**The line no longer flashes complete at a map change.** `_redraw` is async, and the one frame it actually suspends on is the frame a map changes — so two paints could resolve out of order, drawing the finished route and then an earlier frame's near-empty map over it. Each paint now carries a ticket and a stale one is dropped. A cached map also returns synchronously rather than through a promise, so the steady state does not await at all.

This is the same *class* of bug as the 0.45.1 playhead fix, at a different site: that one was the finished route repainting at the end of a run, this one is at every map change. Both are one paint overtaking another.

**The undated backlog is dealt out instead of dumped.** Session 1 was played before the travel tool existed, so its rolls sit before the first recorded leg and have nothing to attribute to; imported transgressions carry no game-day at all. Both are genuinely unplaceable — but showing them all before the line moved was a wall of rows nobody could read. They now arrive spread across the camera's opening, in their recorded order, as a recap while the view is still out over the woods.

Worth being straight about: this is not the 0.45.1 bug returning. That was a field-name collision putting *dated* rolls at zero. These events have no date to place them by, and never did.

## 0.46.0-alpha (2026-08-19)

**A camera on the credits.** The sequence used to sit still on one region map and cut abruptly to the next. It now opens on the whole woods, pushes in on wherever the party started, and follows them as the line draws. When they cross into another region it pulls back out to the overview, walks a dashed line between the two regions, and pushes into the new one. It ends by drawing back out over the whole map.

The overview stops being just another map in the set and becomes the thing that ties the journey together.

**The transition costs the replay nothing.** The camera keeps its own clock, and the replay's clock is frozen while it moves — so every roll and wound still lands exactly where it did before, and the *Draw the route* tool is entirely unaffected. That is deliberate: the two share a schedule, and the way to leave one alone was to make the camera's time invisible to it rather than to re-time everything around it.

**A Camera toggle** sits in the toolbar. It runs live at the end of an arc, so there is a way back to the plain per-map replay without waiting on a patch.

Some details that are easy to miss and were the point:

- The line, the pins and the stay rings **hold their weight** while the terrain grows underneath. Scaling them too would read as an image being magnified rather than a camera moving in — and the stay ring's radius means something, so it must not change size.
- Map changes are **matched-scale hard cuts**, not fades. Two frames showing the same thing at the same size read as continuous motion.
- The canvas is sized **once** for the whole run. Resizing it per map would flip its shape mid-move, and assigning a canvas its width clears it — so the frame would flash.

## 0.45.1-alpha (2026-08-17)

**The whole back catalogue no longer dumps onto the first frame.** The chat parser emitted a field called `when` holding a wall-clock date string, while the system uses that name for whole minutes of game time. Two different meanings, one name.

The consequence ran in two stages: the bracketing skipped every imported roll because it looked "already placed", and the date string then compared false against every numeric step time, so each roll fell through to offset zero. All 22 arrived at once, before the line had moved.

The parser's field is `at` now, and both guards test for a **number** rather than for presence — which is the honest check either way, and would have caught this on its own.

**The route no longer flashes complete before animating.** The playhead survived a re-render, so the finished value from the previous run was painted the moment the window opened or replay began. It now winds back to zero and paints an empty map before the first frame. The end of a replay also no longer calls `render()`, which was rebuilding the DOM and discarding the feed the GM had just watched fill.

**Portrait maps are no longer cut off.** The map was sized to fill the width alone. The Lost is 1540×2000, so at 854px wide it wanted 1109px of height in a 724px space and lost its bottom third off the edge. It now fits inside both dimensions, keeping its aspect — The Lost draws at 557×724 instead.

**Requires content module 1.19.1** for the renamed timestamp field.

## 0.45.0-alpha (2026-08-17)

**The credits sequence.** *Credits*, beside *Draw the route* in the session log. The journey plays across the book's own map while two panels fill in beside it: what happened at each place as the line reaches it, and the dice totals climbing as it goes.

The feed carries rolls with their outcome, calling upon the woods marked apart in the doom purple, transgressions, and wounds the party took. The place is named only when it changes — repeating one name down twelve rows is noise, and the map already says where they are.

**Rolls now record where and when they happened.** The flag was never there: a roll stored only a wall clock. New rolls stamp the scene and the game time on the *roller's* client, because the scene a player is looking at is the scene their character is in, while the GM may be on a region overview entirely.

**The back catalogue is placed by inference.** Rolls from before this release carry no location, so they are bracketed between the legs they fall within — moves and rolls share the same wall clock, so walking both says which leg a roll happened during. On the two sessions in the archive this places 32 of 34; the two it cannot place happened before the first leg was recorded, and are left unplaced rather than attributed to a journey that had not happened yet.

Inferred places are marked with a `~` and are **never written back to the log**. A guess stored beside recorded facts becomes indistinguishable from one, and the first mis-bucket would be permanent.

**Wounds are recovered from the chat history.** Damage rolls are deliberately excluded from the dice statistics — they have no task rating to succeed against, and folding them in would corrupt every success percentage — but the card carries everything needed, so the campaign's wounds were recoverable without recording anything new. Only wounds the party *took* reach the feed: one dealt to a wolf is the mechanism, and the wolf falling over already tells that story. The difference is detectable because a dealt wound is followed by the GM-only "NPC defeat threshold" whisper.

Across both sessions: Harvey took a Rating 1 physical, Baz a Rating 2 mental, Syren a Rating 4 mental.

**The statistics are the session log's own.** The panel calls the same `_rollStats` on a growing slice rather than keeping its own count, so the credits' final numbers are identical to the log's by construction — a second definition would have drifted.

**Requires content module 1.19.0**, which carries the parsed wounds.

*The official map is used here and there is no share path — the credits are an end-of-arc artefact for the GM's screen, and the region maps name every location with the secret birdsong paths in red.*

## 0.44.0-alpha (2026-08-17)

**The dice tracker counts how often each character calls upon the woods.** A new *Called* column beside the success rates, and a line in the markdown export.

It is the one thing about a roll the log did not keep. The flag existed on the roll object all along but never reached the session log, so nothing could count it — and it is worth counting: each call costs a Doom and always transgresses, so how often a character reaches for it says more about them than any success rate does. Zeroes are dimmed, because most characters never do it and a column of bright noughts would pull the eye away from the one who has.

**The existing history was backfilled**, so the count starts from what actually happened rather than from now. The chat parser reads the choice off the card, and *Restore* carries it into the log exactly as a live roll would.

Across both sessions so far: **Baz has called upon the woods once**, and nobody else has.

There is a neat cross-check on this, now asserted in the suite: such a roll prints no Darkest Die on its card, because the die goes into the total instead. Every call in the history lacks one, and every roll lacking one is a call.

**Requires content module 1.18.1**, which carries the flag on the parsed history.

## 0.43.2-alpha (2026-08-17)

**"The party takes Mordecai's Door", not "takes the mordecai's door."** A possessive is already definite, so the article in front of it was wrong — and it is somebody's *name*, so lowercasing it was wrong too. Only two labels in the book are built this way, both in Dismal, and both were broken.

The check that should have caught this earlier was looking for a straight apostrophe. The book's labels use the curly one, so every possessive slipped past silently.

**Stepping through a door no longer describes the swamp.** The region flavour tables describe the ground crossed on a journey, and walking into a shack is not a journey — so a party entering Mordecai's got told that standing water spread across the low ground. Threshold routes now get no terrain line at all; the arrival text already describes the room, which is all a one-step move needs.

Detected from the route label rather than a list of interiors, because the source data has no interior flag — but a route called "X's Door" is one by definition.

**The chat history now carries both sessions** (module 1.18.0) — 126 messages, up from 52.

**Requires content module 1.18.0.**

## 0.43.1-alpha (2026-08-14)

**"A new day begins", not "A new day dawns."** The day rolls over at midnight, so that line fires at 00:00 and at any hour a long journey happens to land on afterwards — announcing a dawn at 03:15 is simply untrue. The sunless variant beside it already said *begins*, so the two branches were inconsistent as well as one of them being wrong.

The icon moves from a sun to a calendar for the same reason: a sun at three in the morning is the same claim made in a picture. The sunless branch keeps its moon.

## 0.43.0-alpha (2026-08-14)

**The travelling scene sets itself.** Now that the content module ships one and puts it in every region bundle, the system finds it by flag instead of waiting to be handed a UUID it could never guess.

That UUID was only ever filled in by the region importer, on a fresh import. Any world built before the scene existed, any scene dragged in by hand from the compendium, and any setting that had been cleared left hold-for-roleplay silently unavailable — with nothing in the tool to say why, since the option simply hides itself when no scene is set.

**A scene you pick yourself still wins.** The stored UUID is tried first and only falls through to the module's default when it is empty or points at a scene that has since been deleted.

The travel tool now says *(from the content module)* beside a defaulted scene, and only offers **Clear** for one you chose. Clearing a default would have looked broken — the setting would empty and the very next render would find the scene again.

**Scene darkness still skips it**, which the change would otherwise have broken: that check compared against the stored UUID, so a defaulted scene stopped being recognised and the clock would have darkened a stylised woodcut road as though it were a sky. It now matches the flag as well.

Without the content module nothing changes — no scene is found, and the tool hides the option as before.

## 0.42.4-alpha (2026-08-14)

**The doom badge no longer covers the player list.** It was positioned to sit just past the travel dial — but the dial is a narrow pill (~112px) and the player list is nearly twice that (~202px), so once the roster filled out the badge landed squarely on top of it. It now clears whichever of the two is wider, which holds for any roster size and any name length, since the list grows sideways with the longest name.

It also sits on the same baseline as the dial now rather than being pushed up above the player list, since it no longer needs to clear the list vertically.

**The roster list is capped to the space actually available** between that baseline and the top of the viewport, and scrolls inside the cap. The skull and the total are never shrunk. The cap is recomputed on window resize, which the old fixed 132px value could not react to.

## 0.42.3-alpha (2026-08-14)

**The tracker's play button no longer un-disables itself mid-cue.** It was held disabled for the cue's length by a timeout on the button element — but advancing any region's transgression re-renders the whole tracker, which replaces that element. The timeout then cleared a flag on a node no longer on screen, leaving the fresh button live while the sound was still playing.

The end time is now held on the class, per region, and restored when the window re-renders. Pressing **+** on one region while another's cue plays no longer re-enables it.

## 0.42.2-alpha (2026-08-13)

**The vignette actually animates now.** The real fault was not the tier values — it was that **CSS cannot interpolate between two radial gradients**. `background` is not an animatable property in any browser, so the gradient snapped to its final size and the only thing genuinely moving was opacity.

That explains the symptom precisely. Tier 3 read fine because 0.95 alpha is obvious even when it appears instantly; tiers 1 and 2 at 0.59 and 0.79 faded in and out with no motion at all and were easy to miss. It also explains why raising the reach values in 0.42.1 changed nothing — a bigger number fed into a property that was never animating.

The gradient is now painted once at its closed-in size and the element is **scaled** instead: 1.21× down to 1× at tier 1, 1.38× at tier 2, 1.60× at tier 3. Transform and opacity are both compositor properties, so they interpolate smoothly and cost nothing per frame. The darkness genuinely travels inward.

Tiers 1 and 2 also fade slower now. A faint effect needs *more* time to be noticed than a heavy one, not less — the earlier 450ms fade on the quietest tier was working against itself.

**Sound and screen start together.** Playing the stinger awaits a document update per element, which round-trips to the server; the screen effect was waiting behind that, so the darkness arrived noticeably after the sound.

The suite now checks that `background` never appears in the transition and that the two halves run in parallel.

**Requires content module 1.15.2.**

## 0.42.1-alpha (2026-08-13)

**All three tiers show a vignette now, and the difference between them is actually visible.**

Two faults, reported as one. Tier 1 had no visual at all — a deliberate choice on the grounds that a level-1 transgression happens often enough for a screen effect to lose its force, and wrong in play: the cue felt incomplete without it. And tier 2's was there but imperceptible, because `reach` only moved the gradient's clear centre from 45% to 29% while peak opacity stayed pinned at 0.95 for every tier. The one number meant to carry the escalation was barely doing anything.

`reach` now drives the radius *and* the weight together, across a range wide enough to see: the clear centre runs 59% → 42% → 20% and the darkness 0.59 → 0.79 → 0.95. Tier 1 is a quick breath at the edges, tier 2 comes properly in and lingers, tier 3 is unchanged in character but now has somewhere to escalate *from*.

The suite checks that reach increases strictly and that each step is large enough to register, so a future tweak can't quietly flatten the tiers again.

**Requires content module 1.15.1.**

*(The Lost's tier 1/2 order was already swapped in 0.42.0 — tier 1 is Wolf howls, tier 2 Distant howls. If you are still hearing the old order, the content module has not been re-uploaded.)*

## 0.42.0-alpha (2026-08-13)

**The screen effect is a vignette now — darkness closing in from the edges and easing back out.**

What was there was a JB2A sprite played through Sequencer, and the approach was wrong rather than the asset. `screenSpace()` centres a *single sprite*, so whatever the file, the result was a round black blob in the middle of the screen: the shape of something standing in front of you, not of the woods closing in. Two earlier picks were also Patreon-only assets that 404'd on the free library.

A radial gradient the system draws itself has none of those failure modes. It needs no module, cannot 404, covers the whole viewport by construction, and sits above the UI so it reaches chat and the sidebars rather than only the map. Tier 2 comes in shallow and briefly; tier 3 reaches much further, holds, and is tinted slightly toward blood. FXMaster stays as a fallback for a client where the overlay cannot be drawn.

**Sound corrections from play:**

- **The Lost** — tiers 1 and 2 swapped. *Wolf howls* is the further-off of the pair despite the name, so it opens and *Distant howls* answers.
- **The Dismal** — *Distant drip* was almost inaudible. A recording of a distant sound is not the same as a cue that reads as distant; tier 1 is now *Close drip*, and the tiers escalate in wetness rather than volume.
- **Winter's Mercy** — owls back at tier 1. Tier 2 is *Icicle drop* rather than the Frostmaiden's whisper, which was too soft to register. Tier 3 was *Winter wolf howls*, which turned out to be the opening of a long piece and produced nothing audible inside a cue window; it is now *Avalanche!!!*, a complete event that lands at once.

**Requires content module 1.15.0.**

## 0.41.2-alpha (2026-08-13)

**Cue length now defaults to 12 seconds** rather than 6 — enough for a howl or a bell to land properly. Still adjustable from 2 to 30.

Note that the setting is world-scoped, so a world where it has already been saved keeps whatever it holds; change it under *Transgression cue length* if you want the new default.

## 0.41.1-alpha (2026-08-13)

**Cues are cut off after six seconds now**, with a setting to change it (2–30).

Syrinscape's `oneshot` label means "does not loop" — it does *not* mean "is short". Several of the chosen cues are perfectly good sounds that simply run long: screams and roars, a crushing wave, the Tomb of the Nine Gods stinger. Left alone they play over whatever the GM says next, which is the opposite of punctuation.

Restricting the selection to brief sounds was the wrong fix — it would rule out most of the good material, and the catalogue publishes no durations to select on anyway. Every cue is now stopped after a fixed length instead, so it behaves like a sting regardless of the source.

The stop is a real one: Syrinscape Controller intercepts `playing: false` and ends the element, the same mechanism the scene ambience uses to swap layers. The correction matters — the 0.40.4 note said this timer was only Foundry's bookkeeping and could not cut a sound short. That was wrong, and it is exactly what was needed.

The tracker's play button now stays disabled for the cue's length rather than a fixed moment, so the control matches what is audible.

## 0.41.0-alpha (2026-08-13)

**The transgression cue is yours to play now.** Each region row in the Transgression Tracker has a speaker button; press it and that region's witch sounds at whatever level the track is currently on — tier 1 below 5, tier 2 from 5, tier 3 at 10.

It no longer fires on its own when the track advances. That sounded right and played badly: a Darkest Die can land mid-sentence, in the middle of another player's turn, or three rolls deep into a combat round, and a howl arriving there steps on the table rather than landing on it. The moment a transgression is *recorded* is often not the moment it should be *felt*.

Nothing else changed. A Darkest Die still advances the track and the players still get their stir message exactly as before — only the sound and the screen wait for you.

The button appears only where there is actually a cue, so a custom region you have added yourself doesn't get a dead control, and it holds itself disabled for a moment after a press so a double-click can't hit the silent no-op.

**On sounds that run long:** the reset timer added in 0.40.4 only clears Foundry's own bookkeeping flag. Syrinscape owns playback and never sees it, so a long cue plays to its natural end — the timer exists purely so the next press isn't swallowed.

## 0.40.4-alpha (2026-08-13)

**The stingers are all one-shots now.** Four of them weren't sounds at all but looping atmospheres — *Eerie swamp*, *Deep underwater*, *Snowy wind*, *Blizzard winds*. They started at a transgression and never stopped, so the woods quietly acquired a second soundscape running under the scene's own until someone noticed.

The catalogue distinguishes these (14,033 `oneshot` against 35,374 looping `sfx`) and the first pass simply ignored that column, picking on name alone. Every one of the 27 elements has been re-chosen from `oneshot` only, and the check now enforces it so it cannot come back. The witches keep their character: The Lost runs distant howls to a baleful howl close by, The Keepers a far abbey bell to a great bell with whispering under it, Old Jenny a drip to blood to a wet stab.

**A stinger fired twice now plays twice.** `playing` is a state flag, not a trigger — setting it true on a sound already marked true does nothing, so the second identical transgression in a session was silent. Worse, nothing ever set it back: a Syrinscape sound has no local audio, so Foundry never sees playback end and the row stayed lit for the rest of the night. Each stinger is now reset before firing and cleared again afterwards.

**Two elements can play together.** The playlist was in sequential mode, which stops the previous sound when the next starts — so the tier-3 cues that deliberately layer two elements were being cut to one, and the sidebar refused to play two at once. It is now simultaneous, like the ambience playlists.

**The `Can't add events during a curve event` error is gone.** Syrinscape Controller turns a non-zero fade into a Web Audio gain curve, and the second element of a two-element tier arrived while that curve was still open. The stingers no longer carry a fade; they are short and want to arrive at full volume anyway.

**Requires content module 1.14.0.**

## 0.40.3-alpha (2026-08-13)

**The stingers no longer loop.** They were built with `repeat: true`, inherited from the ambience beds where a track ending mid-scene would leave a hole in the soundscape. A stinger is a one-shot, so a wolf howl started at a transgression would still be howling when the party reached the next region. They are also given a short non-zero fade: Syrinscape Controller feeds the fade duration to `setValueCurveAtTime`, which throws on zero.

**Testing the flourish now tells you why nothing happened.** `TransgressionFx.play()` had four separate silent returns — not the primary GM, the setting off, no sounds for that region, and the playlist not imported. All four returned `undefined` and did nothing, which is correct during play but useless when a GM is testing: a missing playlist looked exactly like a broken feature.

Called by hand it now logs which gate stopped it, and reports what Sequencer and FXMaster were found to be. The likeliest cause gets a real instruction: *the "Transgression stingers" playlist is not in this world — import it from the module's Playlists compendium.* The live path stays silent.

**Requires content module 1.13.1**, which also puts the stinger playlist on every region bundle so importing any region brings it in.

## 0.40.2-alpha (2026-08-13)

**The screen effects now use an asset that exists.** Both tiers referenced JB2A files from the Patreon library — the free library carries `energy_field` in blue only and has no `dark_red` at all, so they 404'd and nothing showed. Both now use `jb2a.darkness.black` at two weights: lighter and shorter at tier 2, heavier and longer at tier 3.

That is also a better choice than what it replaced. A creeping dark reads as the woods closing in; a red energy field read as a spell going off.

**A missing asset no longer swallows the fallback.** `Sequence.play()` resolves as soon as the effect is queued and only *then* fails asynchronously when the texture cannot load — so the `try/catch` around it never fired, the failure surfaced as an unhandled rejection, and the FXMaster fallback was skipped. The result was the worst of both: no visual, and a console error. Sequencer's database is now asked whether the asset exists *before* playing, so anything missing falls straight through to FXMaster as designed.

The verification suite now checks every effect name against the free JB2A library, so a Patreon-only asset can't ship silently again.

**Requires content module 1.12.1** for the corrected effect names.

## 0.40.1-alpha (2026-08-13)

**Every actor was failing data preparation.** The console filled with `can't access property "initial", this.tokenActiveEffectChanges is undefined` on world load — once per compendium NPC, then again for every actor created or opened.

`DarkestActor` overrode `prepareBaseData()` with an empty body and never called `super`. Foundry v14 initialises internal state there, including `tokenActiveEffectChanges`, which `applyActiveEffects()` reads a moment later. The stub was harmless on the version it was written against and became fatal when core started relying on that step. There was never a reason to override it — this system sets no base data of its own — so it now calls super and does nothing else.

`prepareDerivedData()` on both actors and items had the same omission and now calls super too. `DarkestItem.prepareData()` was removed outright: it did nothing except call super, which is exactly what not overriding it does, and it was one more place for the call to get dropped.

Active effects should behave correctly again — which also means the persistent boons and banes that ride on them.

## 0.40.0-alpha (2026-08-13)

**The woods get worse as the track rises.** The transgression level already escalated in words — the stir message changes wording at 5 and at 10 — but nothing else did. Now a sound goes under those same two steps, and from level 5 the screen briefly notices.

**The sounds are chosen per witch, not per region**, so what the players hear is the thing actually hunting them. The Isolating Pack starts with wolf howls far off and does not keep them far off. Old Jenny runs from dripping to squelching to the theatre of flesh. The Moon is deliberately *not* ugly — chimes, serene then crystalline then choral-and-wrong — because the Moon's dread is beautiful. Forsaken Mullock drowns; Queen Owl freezes; Baba Yaga cackles; the Madman laughs.

Three tiers, matching the chat exactly: **1–4**, **5–9**, **10**. That boundary is now checked automatically against the message code, because if the two ever drift the players would get tier-3 words over a tier-2 sound at the most dramatic moment on the track.

**Tier 1 has no screen effect at all**, deliberately. A level-1 transgression happens several times a session and a visual on each would stop meaning anything by the third.

Everything here is optional and probed separately. No content module, no sounds. No Syrinscape Controller, the playlist entries sit inert. No Sequencer, it falls back to FXMaster; no FXMaster either, the screen simply doesn't change. The chat message always posts, and a flourish that fails is logged and swallowed — it can never stop a transgression being recorded. The whole thing has an off switch, plus a sound-only setting.

Audition without provoking anything: `game.darkestSystem.TransgressionFx.play('the-lost', 10)`.

**Requires content module 1.12.0**, which carries the sound ids and the new *Transgression stingers* playlist. Update the system first.

## 0.39.1-alpha (2026-08-13)

**A restore now leaves a GM-only note in chat**, saying how many messages came back, how many were whispered, and how many were skipped as already present. A toast is gone the moment it fades; this stays in the record it just rebuilt, and survives into the next export — so the history itself knows it was restored. The note is dropped when the history is rebuilt, so it cannot accumulate a notice about a notice on every cycle.

**Restored transgressions go back as GM whispers, not public messages.** This one is worth explaining, because it would have been a real leak. Foundry's chat export writes a whispered message in exactly the same shape as a public one — who could see it is simply absent from the file. The witch's scripted action ("The Lost — Transgression 3: A thick fog descends…") was whispered to the GM when it fired; the players only ever saw *the woods stir and whisper*. Restoring naively would have re-posted every one of them publicly and handed the players the entire transgression table in one go.

Visibility is therefore inferred from the kind: transgression cards restore GM-only, everything else restores public. That is a guess, but deliberately the safe one — a public line wrongly kept private costs a re-read, where the reverse spoils the campaign.

**Requires content module 1.11.1**, which carries the whisper flags. Update the system first.

## 0.39.0-alpha (2026-08-13)

**Transgressions can be added and edited by hand.** For a campaign that started tracking partway in, or to correct a mis-recorded one. Region, level, witch, and the game day and time it happened.

It records history and nothing else — no ominous message to the players, no advance of the witch's track. Both of those already happened at the table, possibly weeks ago; this is the *record* catching up with events, not the events happening again. Set the track itself in the Transgression Tracker, which is the one place that owns it. Hand-added entries are marked, and show the game day they happened on rather than the minute they were typed — otherwise five entries added in one sitting would all read as the same moment.

**Past sessions can be restored from the content module.** Foundry's chat log is world data with no undo: clearing it is one click and takes the campaign's record with it. Export your chat after each session into the module's history folder, rebuild the module, and the history lives somewhere nothing done to the world can touch.

*Restore* in the session log then offers three things: rebuild the chat, rebuild the session log's rolls and transgressions, or both. **Any of them can be run twice safely** — every restored message and imported entry carries the id it came from, and anything already present is skipped. That mattered enough to build around: the GM pressing this has just lost their log and has no way of knowing whether the first press worked. It also means a partial restore tops up rather than duplicating.

Original timestamps are kept, so a restored log reads in the order things happened rather than the order they were re-created.

From one real session export, that recovered all 22 rolls with their ratings, targets, totals, Darkest Dice, boons and outcomes, and all 5 transgressions with their region and level.

**Movement is deliberately not imported.** The chat card prints the arrival but not the route slugs the travel log keys on, and guessing them would put wrong data into the route map and the backtracking check. Legs still go in through the "add leg" dialog, which knows about real locations.

**Requires content module 1.11.0**, which carries the history. Update the system first — the module will not activate against an older one.

## 0.38.1-alpha (2026-08-13)

**The woods no longer stir before the roll that woke them.** "The woods stir and whisper" was landing *above* the card showing the Darkest Die that caused it — the warning arriving before the provocation, which reads as the woods reacting to nothing. Everything a roll causes now waits for the roll to appear first: the stir, the doom notice, and the GM's NPC-damage whisper, which had the same problem.

The fix is an `await`, not just a reordering, and that distinction matters for a table with players. A player's roll card travels to the server and back before anyone sees it, while the transgression is handed to the GM's client over a socket. The old code sent that socket message before the card had finished its round trip, so the GM could author the stir first no matter what order the local lines were in. Waiting for the card to exist server-side means it is stamped ahead of anything posted in response — for every client, not just the roller's. Rest rolls had the same bug by a different route and are fixed too; several wounds in one rest still stir in the order they were rolled.

**The on-screen doom counter now looks like the tally window** — the same skull and total block, with the per-character list under it, so the docked version and the window read as one thing at two sizes. It shows who is carrying what, which is the question actually asked after "how many".

**The per-character counts are readable.** They were `--darkest-purple` (`#4e3f6e`, a *surface* tone) on a translucent purple background — dark purple text on dark purple ground, which is why the zeroes were nearly invisible. Same root cause as the character names in 0.38.0. Counts now use the lifted purple, someone actually holding a doom renders brighter than someone on zero, and the figures are tabular so a count going from 9 to 10 doesn't shift the row.

The badge grows upward as characters are added, away from the player list, and caps at six rows before scrolling so a large table can't climb into the scene controls. Long names truncate rather than wrapping a row onto two lines.

**No module update needed** — 1.10.0 still applies.

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
