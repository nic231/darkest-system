# Changelog

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
