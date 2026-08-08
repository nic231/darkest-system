# Changelog

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
