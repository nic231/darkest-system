/**
 * GM-only session log: where the party went, and how the dice treated them.
 *
 * Two things the GM can't reconstruct after the fact from chat scrollback:
 *
 *   1. **Movement.** Public travel messages deliberately never name the
 *      destination ("The party takes the north trail"), because the players
 *      don't know where they're going until they arrive. That's right for
 *      chat and useless for drawing the map afterwards, so movement is
 *      recorded here with real location names.
 *
 *   2. **Dice.** Whether the party is being ground down or breezing through
 *      is invisible in the moment and obvious in aggregate.
 *
 * Everything is stored in a world setting the GM alone can read.
 */

import { TravelGroups } from './travel-groups.mjs';

const SETTING_LOG = 'sessionLog';
const MAX_ENTRIES = 2000;  // ~20 sessions; trims oldest first

/**
 * Past sessions, parsed from Foundry's own chat exports by the content
 * module's build_chat_history.py. Empty without the module.
 *
 * This exists because the chat log is world data with no undo: clearing it
 * is one click and takes the campaign's whole record with it. Keeping the
 * history in the MODULE means it survives anything done to the world.
 */
export let CHAT_HISTORY = [];

Hooks.once('darkestSystem.registerChatHistory', (data) => {
  if (Array.isArray(data)) CHAT_HISTORY = data;
});

/**
 * The party's actual route, shipped in the content module.
 *
 * Lives here beside CHAT_HISTORY rather than in import-movements, because that
 * module imports THIS one -- holding it there and importing it back would
 * close a cycle, and a `let` reassigned by a hook is exactly the value a cycle
 * resolves wrongly.
 *
 * Travel is the one thing the chat export cannot carry, since travel cards
 * never name the destination. Keeping the route in the module means it
 * survives anything done to the world.
 */
export let ROUTE_HISTORY = [];

Hooks.once('darkestSystem.registerRouteHistory', (data) => {
  if (Array.isArray(data)) ROUTE_HISTORY = data;
});

// Stamped on every restored message so a second restore can recognise its
// own work. Without it, running restore twice would double the log -- and
// the GM most likely to press it is one who has just lost everything and is
// not sure whether the first press worked.
const RESTORED_FLAG = 'restoredFrom';

export class SessionLog extends Application {

  /** Serialises setting writes; see record(). */
  static _writeQueue = Promise.resolve();

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'darkest-session-log',
      title: 'Session Log',
      template: 'systems/darkest-system/templates/apps/session-log.hbs',
      classes: ['darkest-system', 'session-log'],
      width: 620,
      height: 640,
      resizable: true,
      tabs: [{ navSelector: '.log-tabs', contentSelector: '.log-body', initial: 'movement' }]
    });
  }

  // ── Storage ───────────────────────────────────────────────────────────

  static getLog() {
    const log = game.settings.get('darkest-system', SETTING_LOG) || { entries: [] };
    // Entries recorded before per-row deletion existed have no id, which
    // would leave their delete buttons inert. Backfill in memory; the next
    // write persists it. Deterministic from position + timestamp so the same
    // entry keeps the same id between renders.
    for (let i = 0; i < log.entries.length; i++) {
      if (!log.entries[i].id) log.entries[i].id = `legacy-${i}-${log.entries[i].t ?? 0}`;
    }
    return log;
  }

  /**
   * Append an entry. GM-authored only: players' clients must not write here
   * (they'd race each other and the setting is GM-scoped anyway), so a
   * player rolling dice delegates via the socket, same as everything else.
   *
   * Writes are serialised through a promise chain. This is a
   * read-modify-write on one setting, and game.settings.get() hands back a
   * fresh deserialised object every call -- so two overlapping records both
   * read the same "before" state and the second write silently discards the
   * first. That is not hypothetical: a multi-leg journey logs its legs in a
   * loop, and a four-player round fires several rolls at once. Queueing here
   * rather than at the call sites means no future caller can get it wrong.
   */
  static async record(entry) {
    if (!game.user.isGM) return;
    SessionLog._writeQueue = SessionLog._writeQueue
      .catch(() => {})  // one failed write must not wedge the queue
      .then(async () => {
        const log = SessionLog.getLog();
        // A stable id per entry so a row can be deleted by identity. Index
        // is unusable (the tables render reversed) and the timestamp isn't
        // unique -- four players rolling at once land in the same
        // millisecond.
        log.entries.push({ id: foundry.utils.randomID(), t: Date.now(), ...entry });
        if (log.entries.length > MAX_ENTRIES) {
          log.entries = log.entries.slice(-MAX_ENTRIES);
        }
        await game.settings.set('darkest-system', SETTING_LOG, log);
        SessionLog.refresh();
      });
    return SessionLog._writeQueue;
  }

  static async clear() {
    if (!game.user.isGM) return;
    await game.settings.set('darkest-system', SETTING_LOG, { entries: [] });
    SessionLog.refresh();
  }

  /**
   * Remove entries without wiping the log.
   *
   * Testing mid-campaign generates junk rows -- a travel that was really a
   * dry run, a roll made to check a fix -- and clearing everything to be rid
   * of them destroys the real session record too. `predicate` receives each
   * entry and returns true to delete it.
   *
   * Goes through the same write queue as record(), or a delete racing a
   * concurrent record would lose one of them.
   */
  static async remove(predicate) {
    if (!game.user.isGM) return 0;
    let removed = 0;
    SessionLog._writeQueue = SessionLog._writeQueue
      .catch(() => {})
      .then(async () => {
        const log = SessionLog.getLog();
        const before = log.entries.length;
        log.entries = log.entries.filter(e => !predicate(e));
        removed = before - log.entries.length;
        if (removed) {
          await game.settings.set('darkest-system', SETTING_LOG, log);
          SessionLog.refresh();
        }
      });
    await SessionLog._writeQueue;
    return removed;
  }

  /** Delete one entry by its stable id. */
  static removeEntry(id) {
    return SessionLog.remove(e => e.id === id);
  }

  /**
   * Change one entry in place.
   *
   * Through the same write queue as record(), for the same reason: this is a
   * read-modify-write on a world setting, and an edit racing a travel roll
   * would lose one of them. The id and kind are never overwritten -- an edit
   * corrects a leg, it doesn't turn it into a different kind of entry.
   */
  static async updateEntry(id, changes) {
    if (!game.user.isGM) return false;
    SessionLog._writeQueue = SessionLog._writeQueue
      .catch(() => {})
      .then(async () => {
        const log = SessionLog.getLog();
        const entry = log.entries.find(e => e.id === id);
        if (!entry) return false;
        Object.assign(entry, changes, { id: entry.id, kind: entry.kind });
        await game.settings.set('darkest-system', SETTING_LOG, log);
        SessionLog.refresh();
        return true;
      });
    return SessionLog._writeQueue;
  }

  /**
   * Remove rolls that are the same roll recorded twice.
   *
   * Needed because the importer used to duplicate any roll the system had
   * already logged live: a live entry carries no importId, so the dedupe by
   * importId never saw it and a re-import added a second copy. The importer
   * now adopts those instead (see importHistory), but a log that was imported
   * before this fix already holds the duplicates, and clearing all rolls to be
   * rid of them would destroy the session record.
   *
   * A duplicate is the same player, the same numbers, the same outcome, within
   * a couple of minutes. The one that is KEPT is the richer of the two --
   * whichever carries more recorded fields -- so location and calledWoods
   * survive the merge rather than being thrown away with the copy.
   */
  static async dedupeRolls({ windowMs = 120 * 1000, dryRun = false } = {}) {
    if (!game.user.isGM) return null;
    const entries = SessionLog.getLog().entries.filter(e => e.kind === 'roll');
    const sigOf = (r) => [
      r.who, r.characterRating, r.taskRating, r.target, r.total, r.darkestDie, r.outcome,
    ].join('|');
    // How much an entry actually knows. The survivor should be the one with
    // the location and the flags, not simply the older row.
    const richness = (e) => [
      e.atSlug, e.atTitle, e.day, e.time, e.region, e.groupId,
      e.calledWoods !== undefined ? 1 : null, Number.isFinite(e.when) ? 1 : null,
    ].filter(v => v != null && v !== '').length;

    const bySig = new Map();
    for (const e of entries) {
      const k = sigOf(e);
      if (!bySig.has(k)) bySig.set(k, []);
      bySig.get(k).push(e);
    }

    const doomed = [];
    for (const group of bySig.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      const used = new Set();
      for (let i = 0; i < sorted.length; i++) {
        if (used.has(sorted[i].id)) continue;
        // Everything close enough in time to be the same moment.
        const cluster = [sorted[i]];
        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(sorted[j].id)) continue;
          if (Math.abs((sorted[j].t ?? 0) - (sorted[i].t ?? 0)) <= windowMs) {
            cluster.push(sorted[j]);
          }
        }
        if (cluster.length < 2) continue;
        cluster.sort((a, b) => richness(b) - richness(a) || (a.t ?? 0) - (b.t ?? 0));
        cluster.forEach(e => used.add(e.id));
        doomed.push(...cluster.slice(1).map(e => e.id));   // keep the richest
      }
    }

    if (dryRun) return { duplicates: doomed.length, total: entries.length };
    if (!doomed.length) {
      ui.notifications.info('No duplicate rolls found.');
      return { removed: 0 };
    }
    const kill = new Set(doomed);
    const removed = await SessionLog.remove(e => kill.has(e.id));
    ui.notifications.info(`Removed ${removed} duplicate roll${removed === 1 ? '' : 's'}.`);
    return { removed };
  }

  /** Delete every entry of one kind ('move' | 'roll' | 'transgression'). */
  static removeKind(kind) {
    return SessionLog.remove(e => e.kind === kind);
  }

  static refresh() {
    Object.values(ui.windows)
      .filter(w => w instanceof SessionLog)
      .forEach(w => w.render(false));
  }

  // ── Recording helpers, called from the rest of the system ─────────────

  /**
   * The party moved. Records real names -- this is the map data.
   *
   * Every field beyond the original set is optional, so entries written by
   * older versions keep rendering exactly as they did:
   *
   *   fromSlug/toSlug   identity, not just display. Titles are for reading;
   *                     the backtracking check and the route map both need to
   *                     know WHICH place, and two locations can share a name.
   *   departDay/Time    when they set out. `day`/`time` remain ARRIVAL, which
   *                     is what they always meant -- recordMove is called
   *                     after the clock advances.
   *   manual            added by hand rather than recorded from a journey.
   */
  static recordMove({
    fromSlug, fromTitle, toSlug, toTitle, label, minutes, km, region,
    day, time, departDay, departTime, pace, manual, groupId,
  }) {
    return SessionLog.record({
      kind: 'move', fromSlug, fromTitle, toSlug, toTitle, label, minutes, km,
      region, day, time, departDay, departTime, pace, manual,
      // Who walked it. Legs recorded before groups existed have none, and
      // are treated as the first group -- which is what they were.
      groupId,
    });
  }

  /**
   * The party stayed put while time passed.
   *
   * Waiting, resting, sleeping, being held somewhere against their will --
   * none of it moved them, and until now none of it was recorded either.
   * That left the map unable to tell "they were at the Dark Lodge for two
   * days" from "they vanished and reappeared", and made it impossible to
   * line two separated groups up in time.
   *
   * Recorded as a MOVE whose from and to are the same place, so everything
   * that already reads movement -- the chain, the gap check, the route
   * map -- handles it without a second code path. The `stay` flag is what
   * lets the display say "waited 8h" rather than drawing a line of zero
   * length.
   */
  static recordStay({ slug, title, minutes, day, time, departDay, departTime, region, groupId, manual, reason }) {
    return SessionLog.record({
      kind: 'move',
      stay: true,
      reason: reason || '',
      fromSlug: slug, fromTitle: title,
      toSlug: slug, toTitle: title,
      label: '', minutes, km: 0,
      region, day, time, departDay, departTime, groupId, manual,
    });
  }

  /** An action roll resolved. */
  /**
   * An action roll resolved.
   *
   * The `where` fields (atSlug..groupId) are optional and arrive only from
   * 0.45.0 onward -- earlier rolls have none, and the credits sequence places
   * those by bracketing them between legs instead (see _bracketRolls). They
   * are listed explicitly rather than spread wholesale so a typo in the
   * caller shows up as a missing column rather than as a silently stored
   * junk field.
   */
  static recordRoll({ who, characterRating, taskRating, target, total, darkestDie, outcome,
                      calledWoods = false,
                      atSlug = null, atTitle = null, day = null, time = null,
                      when = null, region = null, groupId = null }) {
    return SessionLog.record({
      kind: 'roll', who, characterRating, taskRating, target, total, darkestDie, outcome,
      calledWoods,
      atSlug, atTitle, day, time, when, region, groupId,
    });
  }

  /** A transgression fired. */
  static recordTransgression({ region, level, witch, manual = false }) {
    return SessionLog.record({ kind: 'transgression', region, level, witch, manual });
  }

  /**
   * Add or correct a transgression by hand.
   *
   * For a campaign where tracking started late, or to fix a mis-recorded
   * one. Deliberately does NOT post the ominous player message and does NOT
   * advance the witch's track: both of those already happened at the table,
   * possibly weeks ago. This is the RECORD catching up with events, not the
   * events happening again. Set the track itself in the Transgression
   * Tracker, which is the one place that owns it.
   *
   * Pass an existing entry to edit it in place.
   */
  static async transgressionDialog(existing = null) {
    if (!game.user.isGM) return;

    const { TransgressionTracker } = await import('./transgression-tracker.mjs');
    const regions = TransgressionTracker.getAllRegions();
    const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');

    // Region is a free-typed field backed by a datalist rather than a select:
    // a log imported from chat carries whatever the witch's card said, which
    // may not match a region slug at all, and an edit must not silently
    // rewrite it to the nearest option.
    const options = Object.entries(regions)
      .map(([slug, r]) => `<option value="${esc(r.name || slug)}"></option>`)
      .join('');

    // Imported lazily: travel-clock.mjs imports THIS file, so a static
    // import would close the cycle at module-evaluation time. Same reason
    // travel-history.mjs defers its own travel-clock import.
    let clock = null;
    try {
      const { TravelClock } = await import('./travel-clock.mjs');
      const state = TravelClock.displayState();
      // A fixed-time region shows a phase label ("dusk") rather than a
      // clock reading, which an <input type="time"> cannot take.
      clock = { day: state.day, time: state.fixed ? '' : state.time };
    } catch { /* no clock: the fields just start empty */ }

    const v = {
      region: existing?.region ?? '',
      level: existing?.level ?? 1,
      witch: existing?.witch ?? '',
      day: existing?.day ?? clock?.day ?? 1,
      time: existing?.time ?? clock?.time ?? '',
    };

    const content = `
      <form class="darkest-dialog transgression-entry">
        <p class="hint">Records what already happened. The players see nothing,
        and the witch's track is not advanced — set that in the Transgression
        Tracker.</p>
        <div class="form-group">
          <label>Region</label>
          <input type="text" name="region" list="tg-regions" value="${esc(v.region)}" required>
          <datalist id="tg-regions">${options}</datalist>
        </div>
        <div class="form-group">
          <label>Level</label>
          <input type="number" name="level" min="1" max="10" value="${esc(v.level)}" required>
        </div>
        <div class="form-group">
          <label>Witch <span class="hint-inline">(optional)</span></label>
          <input type="text" name="witch" value="${esc(v.witch)}">
        </div>
        <div class="form-group">
          <label>Day <span class="hint-inline">(optional)</span></label>
          <input type="number" name="day" min="1" value="${esc(v.day)}">
        </div>
        <div class="form-group">
          <label>Time <span class="hint-inline">(optional)</span></label>
          <input type="time" name="time" value="${esc(v.time)}">
        </div>
      </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: existing ? 'Edit transgression' : 'Add transgression',
        content,
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: existing ? 'Save' : 'Add',
            callback: async (html) => {
              const form = html[0].querySelector('form');
              const region = form.region.value.trim();
              if (!region) {
                ui.notifications.warn('A transgression needs a region.');
                return resolve(false);
              }
              // If the typed name matches a known region, adopt that
              // region's witch when none was given -- saves typing, and
              // keeps imported entries consistent with live ones.
              const match = Object.values(regions)
                .find(r => (r.name || '').toLowerCase() === region.toLowerCase());
              const patch = {
                region,
                level: Math.max(1, Math.min(10, Number(form.level.value) || 1)),
                witch: form.witch.value.trim() || match?.witch || '',
                day: Number(form.day.value) || null,
                time: form.time.value || null,
                manual: true,
              };

              if (existing) await SessionLog.updateEntry(existing.id, patch);
              else await SessionLog.record({ kind: 'transgression', ...patch });

              SessionLog.refresh();
              resolve(true);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false),
          },
        },
        default: 'save',
      }).render(true);
    });
  }

  /**
   * Put the chat log back from the module's history.
   *
   * Chat messages are WORLD data and clearing them is unrecoverable, so the
   * history lives in the content module where nothing done to the world can
   * touch it. Restoring is always a deliberate GM action -- messages
   * appearing unbidden after a clear the GM meant would be worse than the
   * clear.
   *
   * Idempotent by construction: every restored message carries a flag with
   * its source id, and ids already present are skipped. Press it twice and
   * the second press adds nothing. That matters more than it sounds -- the
   * GM pressing this has just lost their log and does not know whether the
   * first press worked.
   *
   * Timestamps are preserved, so a restored log reads in the order things
   * happened rather than the order they were re-created.
   */
  static async restoreChat({ dryRun = false } = {}) {
    if (!game.user.isGM) return null;
    if (!CHAT_HISTORY.length) {
      ui.notifications.warn('No chat history in the content module. Export a session and rebuild the module.');
      return null;
    }

    // What is already here, by source id.
    const present = new Set();
    for (const m of game.messages) {
      const id = m.getFlag('darkest-system', RESTORED_FLAG);
      if (id) present.add(id);
    }

    // A stable id per source message. The export gives no message ids, so
    // one is derived from the parts that identify it: when, who, and the
    // text. Two identical messages a second apart stay distinct; the same
    // message seen in two overlapping exports collapses to one.
    const idOf = (m, i) => `${m.at ?? m.raw ?? i}|${m.who}|${(m.text || '').slice(0, 64)}`;

    const pending = CHAT_HISTORY
      .map((m, i) => ({ ...m, _id: idOf(m, i) }))
      .filter(m => !present.has(m._id));

    if (dryRun) return { total: CHAT_HISTORY.length, pending: pending.length, skipped: CHAT_HISTORY.length - pending.length };

    if (!pending.length) {
      ui.notifications.info(`Chat history already restored — all ${CHAT_HISTORY.length} messages are present.`);
      return { created: 0, skipped: CHAT_HISTORY.length };
    }

    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

    const payloads = pending.map((m) => {
      // Restored transgressions and rolls keep their card styling so a
      // restored log looks like the log that was lost, not a wall of text.
      const cls = m.kind === 'transgression' ? 'transgression-message player-ominous'
        : m.kind === 'stir' ? 'transgression-message player-ominous'
        : m.kind === 'roll' ? 'darkest-roll action-roll restored'
        : 'restored-narration';
      // The original moment, not now -- Foundry sorts chat by this. Omitted
      // rather than passed as undefined when the export's timestamp did not
      // parse, so Foundry falls back to its own default instead of storing
      // a broken value.
      const t = m.at ? Date.parse(m.at) : NaN;

      // A transgression card is the witch's SCRIPTED ACTION -- GM-only when
      // it fired, and it has to go back that way. Foundry's export records
      // no whisper information at all, so the parser infers it from the
      // kind; without this every restored transgression would be re-posted
      // publicly and hand the players the whole table at once.
      const whisper = m.gmOnly ? gmIds : undefined;

      return {
        content: `<div class="${cls} chat-restored">${SessionLog._restoredBody(m)}</div>`,
        speaker: { alias: m.who },
        ...(Number.isFinite(t) ? { timestamp: t } : {}),
        ...(whisper ? { whisper } : {}),
        flags: { 'darkest-system': { [RESTORED_FLAG]: m._id, restored: true } },
      };
    });

    // One call: createDocuments batches the socket traffic, where a loop of
    // creates would fire several hundred separate updates at every client.
    await ChatMessage.createDocuments(payloads);

    // A GM-only marker in chat itself, so a restore leaves a trace in the
    // record it just rebuilt. A toast is gone the moment it fades and tells
    // a GM opening the world tomorrow nothing; this survives, and survives
    // into the NEXT export -- so the history knows it was restored once.
    //
    // Not flagged as restorable itself: re-creating old "restored N
    // messages" notices on a later restore would be noise about noise. The
    // parser leaves it as narration, and the id-skip keeps it single.
    const gmCount = pending.filter(m => m.gmOnly).length;
    await SessionLog._postRestoreNote({
      created: pending.length,
      skipped: CHAT_HISTORY.length - pending.length,
      gmOnly: gmCount,
    });

    ui.notifications.info(
      `Restored ${pending.length} message${pending.length === 1 ? '' : 's'}`
      + (CHAT_HISTORY.length - pending.length
        ? ` (${CHAT_HISTORY.length - pending.length} already present)` : '')
    );
    return { created: pending.length, skipped: CHAT_HISTORY.length - pending.length };
  }

  /**
   * Rebuild the log's rolls and transgressions from the module's history.
   *
   * Separate from restoreChat: the chat log and the session log are
   * different records, and a GM may want one without the other. Same
   * idempotency, by the same derived id.
   *
   * Movement is deliberately NOT imported. The chat card prints the arrival
   * ("The party takes the north trail... It is 12:02 on Day 1") but not the
   * route slugs the travel log keys on, and inventing them would put wrong
   * data into the route map and the backtracking check. Legs go in by hand,
   * through the dialog that knows about real locations.
   */
  static async importHistory() {
    if (!game.user.isGM) return null;
    if (!CHAT_HISTORY.length) {
      ui.notifications.warn('No chat history in the content module. Export a session and rebuild the module.');
      return null;
    }

    const existing = new Set(
      SessionLog.getLog().entries.map(e => e.importId).filter(Boolean)
    );
    const idOf = (m, i) => `${m.at ?? m.raw ?? i}|${m.who}|${(m.text || '').slice(0, 64)}`;

    // ── Backfill fields added to the importer after an earlier import ────
    //
    // Skipping anything already present is right for AVOIDING DUPLICATES and
    // wrong for entries imported by an older version, which are missing every
    // field added since. calledWoods is the live example: a roll imported
    // before it was carried through has no flag, so the credits' "Called"
    // column reads 0 for a player who demonstrably did call upon the woods --
    // and no amount of re-importing fixes it, because the entry is skipped.
    //
    // Only fields that are ABSENT are filled, so a GM's hand correction is
    // never overwritten by the export.
    const byImportId = new Map();
    for (const e of SessionLog.getLog().entries) {
      if (e.importId) byImportId.set(e.importId, e);
    }
    let backfilled = 0;
    for (const [i, m] of CHAT_HISTORY.entries()) {
      const entry = byImportId.get(idOf(m, i));
      if (!entry) continue;
      const patch = {};
      if (entry.calledWoods === undefined && m.calledWoods !== undefined) {
        patch.calledWoods = !!m.calledWoods;
      }
      if (!Number.isFinite(entry.t) && m.at) {
        const t = Date.parse(m.at);
        if (Number.isFinite(t)) patch.t = t;
      }
      if (Object.keys(patch).length) {
        await SessionLog.updateEntry(entry.id, patch);
        backfilled++;
      }
    }

    // ── Rolls already recorded LIVE ──────────────────────────────────────
    //
    // A roll made during play goes through recordRoll, which writes no
    // importId -- correctly, since it is not an import. Re-importing the chat
    // export for that same session then finds no matching importId and adds a
    // SECOND copy of every roll the system already logged itself. That is the
    // 34 -> 46 jump: twelve rolls from one session, duplicated, and it
    // compounds by twelve on every further import.
    //
    // So match on what a live entry and its own chat card genuinely share:
    // the roll's numbers, and the moment it happened. `t` is Date.now() on
    // the live side and Date.parse(card time) on the import side -- the same
    // instant, give or take the second the card took to post.
    //
    // Matching is ONE-TO-ONE (each live entry can be claimed once), because a
    // player really can roll the same numbers twice; the real history has
    // exactly that. A tight window keeps those apart -- the two identical
    // rolls in the log are 24 minutes apart.
    const LIVE_WINDOW_MS = 120 * 1000;
    const sigOf = (r) => [
      r.who, r.characterRating, r.taskRating, r.target, r.total, r.darkestDie, r.outcome,
    ].join('|');
    const liveBySig = new Map();
    for (const e of SessionLog.getLog().entries) {
      // Only entries this could plausibly be a re-import OF: a live roll with
      // a real timestamp and no importId of its own.
      if (e.kind !== 'roll' || e.importId || !Number.isFinite(e.t)) continue;
      const k = sigOf(e);
      if (!liveBySig.has(k)) liveBySig.set(k, []);
      liveBySig.get(k).push(e);
    }
    const claimed = new Set();
    /** The live entry this card already is, if any. */
    const liveMatch = (m) => {
      if (m.kind !== 'roll' || !m.at) return null;
      const t = Date.parse(m.at);
      if (!Number.isFinite(t)) return null;
      const candidates = liveBySig.get(sigOf(m)) || [];
      let best = null, bestGap = Infinity;
      for (const e of candidates) {
        if (claimed.has(e.id)) continue;
        const gap = Math.abs(e.t - t);
        if (gap <= LIVE_WINDOW_MS && gap < bestGap) { best = e; bestGap = gap; }
      }
      return best;
    };

    const wanted = CHAT_HISTORY
      .map((m, i) => ({ ...m, _id: idOf(m, i) }))
      .filter(m => (m.kind === 'roll' || m.kind === 'transgression'
                    // Only wounds the party TOOK, and only real ones. A wound
                    // dealt to a wolf is the mechanism, not the story, and a
                    // scratch is by definition nothing happening.
                    || (m.kind === 'harm' && m.taken !== false && m.event !== 'scratch'))
                   && !existing.has(m._id));

    // Cards that are really a roll the system already logged live. They are
    // ADOPTED rather than skipped: stamping the live entry with this card's
    // importId means the ordinary dedupe catches it from now on, so this
    // matching only ever has to run once per entry. It also backfills the
    // fields the chat card knows and the live record did not.
    let adopted = 0;
    const fresh = [];
    for (const m of wanted) {
      const live = liveMatch(m);
      if (!live) { fresh.push(m); continue; }
      claimed.add(live.id);
      const patch = { importId: m._id };
      if (live.calledWoods === undefined && m.calledWoods !== undefined) {
        patch.calledWoods = !!m.calledWoods;
      }
      await SessionLog.updateEntry(live.id, patch);
      adopted++;
    }

    if (!fresh.length && !adopted && !backfilled) {
      ui.notifications.info(backfilled
        ? `Session log already complete — refreshed ${backfilled} entr${backfilled === 1 ? 'y' : 'ies'} with fields added since they were imported.`
        : 'Session log already holds everything in the history.');
      return { created: 0 };
    }

    // The real moment, so an imported session doesn't collapse into the
    // minute it was imported. Spread as {} rather than {t: undefined} when
    // the timestamp is unusable: record() sets t before spreading the entry,
    // so an explicit undefined would CLOBBER it and leave the row unsorted.
    const stamp = (m) => {
      const t = m.at ? Date.parse(m.at) : NaN;
      return Number.isFinite(t) ? { t } : {};
    };

    let rolls = 0, transgressions = 0, harms = 0;
    for (const m of fresh) {
      if (m.kind === 'roll') {
        await SessionLog.record({
          kind: 'roll', importId: m._id, imported: true,
          who: m.who,
          characterRating: m.characterRating, taskRating: m.taskRating,
          target: m.target, total: m.total, darkestDie: m.darkestDie,
          outcome: m.outcome,
          // Carried through from the parsed chat card, so a backfilled
          // history counts toward the tracker's "Called" column exactly as a
          // live roll does.
          calledWoods: !!m.calledWoods,
          ...stamp(m),
        });
        rolls++;
      } else if (m.kind === 'harm') {
        await SessionLog.record({
          kind: 'harm', importId: m._id, imported: true,
          who: m.who,
          event: m.event, rating: m.rating, woundType: m.woundType,
          ...stamp(m),
        });
        harms++;
      } else {
        await SessionLog.record({
          kind: 'transgression', importId: m._id, imported: true, manual: true,
          region: m.region, level: m.level, witch: m.witch,
          ...stamp(m),
        });
        transgressions++;
      }
    }

    SessionLog.refresh();
    const parts = [
      `${rolls} roll${rolls === 1 ? '' : 's'}`,
      `${transgressions} transgression${transgressions === 1 ? '' : 's'}`,
    ];
    if (harms) parts.push(`${harms} wound${harms === 1 ? '' : 's'}`);
    if (adopted) parts.push(`${adopted} already recorded live`);
    if (backfilled) parts.push(`${backfilled} refreshed`);
    ui.notifications.info(`Imported ${parts.join(', ')}.`);
    return { created: fresh.length, rolls, transgressions, harms, adopted, backfilled };
  }

  /**
   * A GM-only note in chat saying a restore happened.
   *
   * Whispered, and timestamped NOW rather than back-dated like the messages
   * around it -- it records the restore, not the session, so it belongs at
   * the bottom of the log where the GM will actually see it.
   */
  static async _postRestoreNote({ created, skipped, gmOnly }) {
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    if (!gmIds.length) return;

    const bits = [`<strong>${created}</strong> message${created === 1 ? '' : 's'} restored`];
    if (gmOnly) bits.push(`${gmOnly} whispered to you only`);
    if (skipped) bits.push(`${skipped} already present, skipped`);

    await ChatMessage.create({
      whisper: gmIds,
      content: `<div class="transgression-message restore-note">
        <div class="restore-note-head"><i class="fas fa-clock-rotate-left"></i> Restored from the content module</div>
        <p>${bits.join(' · ')}</p>
        <p class="hint">Restored messages keep their original timestamps, so they sit
        where they happened rather than here. Running Restore again adds nothing.</p>
      </div>`,
      flags: { 'darkest-system': { restoreNote: true } },
    });
  }

  /** The body of a restored message, formatted by kind. */
  static _restoredBody(m) {
    const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');
    if (m.kind === 'roll') {
      const mods = [m.boon ? 'boon' : null, m.bane ? 'bane' : null].filter(Boolean).join(', ');
      return `<div class="restored-roll-head">Action Roll${mods ? ` <span class="log-dim">(${mods})</span>` : ''}</div>
        <div class="restored-roll-line">Rating ${esc(m.characterRating)} vs Task ${esc(m.taskRating)} · Target ${esc(m.target)}</div>
        <div class="restored-roll-line">Total <strong>${esc(m.total ?? '—')}</strong> · Darkest Die ${esc(m.darkestDie ?? '—')}</div>
        <div class="restored-roll-outcome">${esc(m.outcome)}</div>`;
    }
    // Narration, stirs and transgressions are text as they were shown.
    // Newlines become breaks; everything is escaped, because this is
    // arbitrary text from a file on disk going into innerHTML.
    return esc(m.text).replace(/\n/g, '<br>');
  }

  // ── Display ───────────────────────────────────────────────────────────

  getData() {
    const entries = SessionLog.getLog().entries;
    // Sorted into game order, not recording order. A leg added by hand for
    // Day 2 is necessarily appended after everything already logged, and
    // _routeSummary in particular walks these in sequence to build the
    // "path walked" chain -- an out-of-order entry corrupts it.
    const moves = SessionLog._chronological(entries.filter(e => e.kind === 'move'));
    const rolls = entries.filter(e => e.kind === 'roll');
    const transgressions = entries.filter(e => e.kind === 'transgression');

    return {
      hasAny: entries.length > 0,
      moves: SessionLog._formatMoves(moves),
      moveCount: moves.length,
      totals: SessionLog._travelTotals(moves),
      route: SessionLog._routeSummary(moves),
      // One route per group. Rendered as separate blocks so a split party
      // reads as two journeys rather than one impossible one.
      routes: SessionLog._routesByGroup(moves).map(r => ({
        ...r,
        groupName: TravelGroups.nameOf(r.groupId),
        groupColour: TravelGroups.colourOf(r.groupId),
      })),
      groups: TravelGroups.all().map(g => ({
        ...g,
        membersLabel: TravelGroups.membersLabel(g),
        active: g.id === TravelGroups.activeId(),
        legCount: moves.filter(m => (m.groupId ?? TravelGroups.all()[0].id) === g.id).length,
      })),
      multipleGroups: TravelGroups.all().length > 1,
      stats: SessionLog._rollStats(rolls),
      rollCount: rolls.length,
      // The stats above are aggregate, so there's nothing to click to drop a
      // single test roll. This is the list that makes rolls deletable.
      recentRolls: rolls.slice(-40).reverse().map(r => ({
        id: r.id,
        who: r.who || 'Unknown',
        detail: `${r.characterRating ?? '?'} vs ${r.taskRating ?? '?'}`
          + (r.target ? ` · target ${r.target}` : ''),
        total: r.total ?? '',
        darkestDie: r.darkestDie ?? '',
        outcome: r.outcome || '',
        outcomeClass: /partial/i.test(r.outcome || '') ? 'partial'
          : /success/i.test(r.outcome || '') ? 'success' : 'failure',
        when: SessionLog._clock(r)
      })),
      hasMoreRolls: rolls.length > 40,
      transgressions: transgressions.map(t => ({
        id: t.id,
        region: t.region, level: t.level, witch: t.witch,
        manual: !!t.manual,
        when: SessionLog._whenTransgression(t)
      })).reverse(),
      transgressionCount: transgressions.length,
      // Each witch's track, for the dice tab. The LEVEL is the tally, not the
      // number of rows: a transgression track counts up, so level 6 is six
      // transgressions however many entries recorded it -- and the history has
      // at least one level recorded twice, which a row count would inflate.
      witchTracks: (() => {
        const by = new Map();
        for (const t of transgressions) {
          const who = t.witch || 'The woods';
          const prev = by.get(who) ?? 0;
          by.set(who, Math.max(prev, Number(t.level) || prev));
        }
        return [...by.entries()]
          .map(([witch, level]) => ({ witch, level }))
          .sort((a, b) => b.level - a.level);
      })(),
      // Whether the module carries a saved route, so the empty movement tab
      // can say so rather than leaving the GM to guess there is a way back.
      hasSavedRoute: ROUTE_HISTORY.length > 0,
      hasHistory: CHAT_HISTORY.length > 0,
      historyCount: CHAT_HISTORY.length,
    };
  }

  static _clock(e) {
    const d = new Date(e.t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * When a transgression happened, preferring GAME time.
   *
   * A backfilled entry is recorded for the day it happened in the fiction,
   * and showing the wall-clock moment it was typed would make backfilling
   * pointless -- five entries added in one sitting would all read as the
   * same minute. Live entries have no day and fall back to _clock, exactly
   * as before.
   *
   * Not folded into _clock() itself: the moves table renders game time in
   * its own column, so doing this there would print it twice.
   */
  static _whenTransgression(e) {
    if (e.day != null) return `Day ${e.day}${e.time ? `, ${e.time}` : ''}`;
    return SessionLog._clock(e);
  }

  /**
   * How far and how long the party has travelled.
   *
   * Time is exact -- every leg records its minutes. Distance is not: some
   * routes the book never measured, and entries recorded before distance
   * was logged have none either. Those are counted and reported rather than
   * estimated, so the figure is honest about what it doesn't know.
   */
  static _travelTotals(moves) {
    if (!moves.length) return null;
    let km = 0, minutes = 0, unmeasured = 0;
    for (const m of moves) {
      minutes += m.minutes || 0;
      if (typeof m.km === 'number' && m.km > 0) km += m.km;
      else unmeasured++;
    }
    return {
      km: km > 0 ? (Math.round(km * 10) / 10).toLocaleString() : null,
      duration: SessionLog._dur(minutes),
      legs: moves.length,
      unmeasured,
      // Only distance is approximate; the clock is exact.
      approx: unmeasured > 0,
    };
  }

  /**
   * Movement rows in game-world order.
   *
   * Sorted on READ rather than spliced on write: splicing would fight
   * MAX_ENTRIES trimming (which slices from the front) and would make
   * deletion-by-id depend on position. This keeps record() a plain append
   * and every id stable.
   *
   * Undated rows -- legacy entries, and anything from before departure times
   * existed -- compare equal to everything, so they keep their recorded
   * position rather than being flung to one end. Array#sort is stable in
   * every engine Foundry runs on, so that is well-defined rather than
   * incidental.
   */
  static _chronological(moves) {
    const mins = (e) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(e.departTime ?? e.time ?? ''));
      // Fixed-time regions store a phase label ("Endless Night"), not a
      // clock reading -- those sort by day alone, which is the honest answer.
      return m ? (Number(m[1]) * 60) + Number(m[2]) : 0;
    };
    return [...moves].sort((a, b) => {
      const ad = a.departDay ?? a.day;
      const bd = b.departDay ?? b.day;
      if (ad == null || bd == null) return 0;
      if (ad !== bd) return ad - bd;
      return mins(a) - mins(b);
    });
  }

  /**
   * Place rolls that carry no location, by the leg they fall within.
   *
   * Rolls recorded before 0.45.0 stored only a wall-clock `t` -- no place, no
   * game time. But moves carry `t` too, stamped by the same record() call, so
   * walking both by wall clock says which leg a roll happened during. On the
   * two sessions in the archive this buckets all 34 rolls across 10 legs.
   *
   * A roll belongs to the leg it lands INSIDE: after that leg's `t`, before
   * the next one's. Its place is that leg's destination, because the leg is
   * recorded on arrival -- the party was standing at `toSlug` when they
   * rolled.
   *
   * NOTHING IS WRITTEN BACK. This runs in memory at plan-build time, and the
   * result is marked `inferred`. A guess persisted into the log becomes
   * indistinguishable from a recorded fact, and the first mis-bucket would be
   * permanent; keeping it in memory also means the heuristic can be improved
   * later with no migration.
   *
   * @returns {object[]} copies of `rolls`, each with atSlug/atTitle/when/
   *   inferred filled in where a leg could be found. Rolls already carrying a
   *   location (0.45.0 onward) are returned untouched.
   */
  static _bracketRolls(rolls, moves) {
    if (!rolls?.length) return [];

    // Real legs only. A stay has no destination to attribute a roll to, and
    // an undated leg cannot be placed on the replay's timeline.
    const legs = SessionLog._chronological(moves ?? [])
      .filter(m => !m.stay && m.toSlug && typeof m.t === 'number')
      .sort((a, b) => a.t - b.t);

    return rolls.map((r) => {
      // Already recorded with a place: leave it entirely alone.
      // Already placed: leave it alone. `when` must be a NUMBER to count --
      // whole minutes of game time. Testing only for presence let imported
      // rolls through, because the chat parser used to put an ISO date string
      // in a field of the same name; every one then looked already-placed,
      // was never bracketed, and compared false against the numeric step
      // times, so the whole back catalogue landed at offset zero and dumped
      // on the first frame. The parser's field is `at` now, but the type
      // check stays: it is the honest test either way.
      if (r.atSlug || Number.isFinite(r.when)) return r;
      if (!legs.length || typeof r.t !== 'number') return r;

      // The last leg that had already been recorded when this roll happened.
      let leg = null;
      for (const m of legs) {
        if (m.t > r.t) break;
        leg = m;
      }
      // A roll before the first recorded leg has no place -- it stays
      // unplaced rather than being attributed to a journey that had not
      // happened yet.
      if (!leg) return r;

      return {
        ...r,
        atSlug: leg.toSlug,
        atTitle: leg.toTitle || leg.toSlug,
        when: SessionLog._legMinutes(leg),
        region: r.region ?? leg.region,
        groupId: r.groupId ?? leg.groupId,
        inferred: true,
      };
    });
  }

  /**
   * A leg's ARRIVAL as whole minutes of game time.
   *
   * The same unit as a route-map step's `when`, so a roll placed here lands
   * on the replay's timeline without conversion.
   *
   * Deliberately NOT importing RouteMap._legTime, which computes the same
   * thing: session-log -> route-map -> travel-history -> session-log is a
   * cycle. Four lines duplicated beats a lazy import inside a synchronous
   * helper -- and the identical `HH:MM` parse already appears in
   * _chronological just above, for the same reason.
   *
   * Arrival rather than departure, because a roll bracketed to this leg
   * happened after the party got there.
   */
  static _legMinutes(leg) {
    if (leg?.day == null) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(leg.time ?? ''));
    // A fixed-time region stores a phase label ("Endless Night"), not a
    // clock reading; those place at the start of their day.
    return (leg.day * 1440) + (m ? (Number(m[1]) * 60) + Number(m[2]) : 0);
  }

  static _formatMoves(moves) {
    return moves.map((m, i) => ({
      id: m.id,
      index: i + 1,
      from: m.fromTitle || '—',
      to: m.stay ? '—' : (m.toTitle || '—'),
      label: m.stay ? (m.reason || 'waited') : (m.label || ''),
      // A stay reads as time spent, not a journey of zero length.
      stay: !!m.stay,
      duration: m.minutes ? SessionLog._dur(m.minutes) : '—',
      distance: (typeof m.km === 'number' && m.km > 0)
        ? `${Math.round(m.km * 10) / 10} km` : '—',
      // "Day 3, 08:00 -> 14:20" once departures are recorded; the older
      // single-time form for entries written before they were.
      gameTime: SessionLog._gameTime(m),
      manual: !!m.manual,
      pace: m.pace && m.pace !== 'normal' ? m.pace : '',
      when: SessionLog._clock(m)
      // Newest first, as it always has been. The chronological SORT happens
      // before this (see _chronological) -- reversing here is presentation,
      // not ordering.
    })).reverse();
  }

  /** "Day 3, 08:00 → 14:20", or the older single-time form. */
  static _gameTime(m) {
    if (!m.day && !m.departDay) return '';
    if (m.departTime && m.time) {
      const sameDay = (m.departDay ?? m.day) === m.day;
      return sameDay
        ? `Day ${m.day}, ${m.departTime} → ${m.time}`
        : `Day ${m.departDay}, ${m.departTime} → Day ${m.day}, ${m.time}`;
    }
    return m.day ? `Day ${m.day}, ${m.time}` : '';
  }

  static _dur(mins) {
    const m = Math.round(mins);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  /**
   * The path walked, deduplicated into an ordered chain of place names --
   * the thing you'd actually trace onto a map.
   */
  /**
   * The path walked, as a chain of places.
   *
   * Two things this has to do that the old version didn't:
   *
   * GAPS ARE SHOWN, NOT SMOOTHED OVER. A leg that starts somewhere the
   * previous leg didn't end means a leg is missing or mistyped. Joining the
   * chain anyway produced a path the party never walked -- and the route map
   * would go on to draw that fiction as a line. Marked instead.
   *
   * LONG CHAINS COLLAPSE. A full campaign runs to a couple of hundred legs,
   * which is fifty-odd lines of unbroken text and no use to anyone. The tail
   * is what the GM is actually looking at, so show that and offer the rest.
   */
  /**
   * One route summary per group.
   *
   * Scoping this per group is the whole point of groups existing: two
   * parties walking different paths on the same day produce, when merged
   * into one chain, a path that zig-zags between them and reports a gap at
   * every handover. Split first, then chain.
   */
  static _routesByGroup(moves) {
    // Legs from before groups existed, and any added by hand before they were
    // stamped, belong to the FIRST group -- at the time there was only one.
    //
    // This has to be the same answer RouteMap.buildPlan() gives. It used to
    // bucket them under a '__legacy__' sentinel instead, so the same journey
    // appeared as its own nameless route block in the log while the map
    // folded it into the party -- two truths about who walked it.
    const firstGroup = TravelGroups.all()[0]?.id ?? 'party';
    const byGroup = new Map();
    for (const m of moves) {
      const key = m.groupId ?? firstGroup;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(m);
    }
    return [...byGroup.entries()].map(([groupId, legs]) => ({
      groupId,
      ...SessionLog._routeSummary(legs),
    }));
  }

  static _routeSummary(moves) {
    const TAIL = 12;
    const chain = [];
    let previousEnd = null;

    for (const m of moves) {
      // A break: this leg starts somewhere the party wasn't.
      if (previousEnd && m.fromTitle && m.fromTitle !== previousEnd) {
        chain.push({ gap: true, expected: previousEnd, actual: m.fromTitle });
        chain.push({ name: m.fromTitle });
      } else if (!chain.length && m.fromTitle) {
        chain.push({ name: m.fromTitle });
      }
      if (m.toTitle && chain[chain.length - 1]?.name !== m.toTitle) {
        chain.push({ name: m.toTitle });
      }
      if (m.toTitle) previousEnd = m.toTitle;
    }

    const places = chain.filter(c => !c.gap);
    const visits = {};
    places.forEach(c => { visits[c.name] = (visits[c.name] || 0) + 1; });

    const gaps = chain.filter(c => c.gap);
    const hidden = Math.max(0, places.length - TAIL);
    const tail = hidden ? chain.slice(chain.length - TAIL) : chain;

    const render = (list) => list
      .map(c => (c.gap ? '<span class="route-gap" data-tooltip="A leg is missing or mistyped: the next leg starts somewhere the party had not walked to.">⚠ gap</span>' : c.name))
      .join('  →  ');

    return {
      chain: places.map(c => c.name),
      chainText: render(tail),
      fullText: render(chain),
      // Markup-free, for the Markdown export -- chainText carries a <span>
      // for the gap marker, which has no business in a notes file.
      plainText: chain.map(c => (c.gap ? '⚠ GAP' : c.name)).join('  →  '),
      hidden,
      hasMore: hidden > 0,
      gapCount: gaps.length,
      gaps: gaps.map(g => `after ${g.expected}, the next leg starts at ${g.actual}`),
      distinct: Object.keys(visits).length,
      revisited: Object.entries(visits)
        .filter(([, n]) => n > 1)
        .map(([name, n]) => `${name} (${n}×)`)
    };
  }

  /** Aggregate dice stats, overall and per character. */
  static _rollStats(rolls) {
    if (!rolls.length) return null;

    const tally = (list) => {
      const out = { total: list.length, success: 0, partial: 0, failure: 0, calledWoods: 0 };
      for (const r of list) {
        const o = (r.outcome || '').toLowerCase();
        if (o.includes('partial')) out.partial++;
        else if (o.includes('success')) out.success++;
        else out.failure++;
        // Counted per player as well as overall: reaching for the woods is a
        // choice about a character, not a property of the dice. One player
        // doing it four times while nobody else does it once is the kind of
        // thing a GM wants to see.
        if (r.calledWoods) out.calledWoods++;
      }
      out.successPct = Math.round(100 * out.success / out.total);
      out.partialPct = Math.round(100 * out.partial / out.total);
      out.failurePct = Math.round(100 * out.failure / out.total);
      return out;
    };

    const byWho = {};
    for (const r of rolls) {
      const who = r.who || 'Unknown';
      (byWho[who] ??= []).push(r);
    }

    // Darkest Die distribution -- a 1 is what wakes the witch, so the
    // count of 1s is the number the GM actually cares about.
    const dd = Array.from({ length: 6 }, (_, i) => ({
      face: i + 1,
      count: rolls.filter(r => r.darkestDie === i + 1).length
    }));
    const ddMax = Math.max(1, ...dd.map(d => d.count));
    dd.forEach(d => { d.pct = Math.round(100 * d.count / ddMax); });

    const ratings = {};
    for (const r of rolls) {
      if (r.taskRating == null) continue;
      const k = r.taskRating;
      (ratings[k] ??= { taskRating: k, count: 0, success: 0 });
      ratings[k].count++;
      if ((r.outcome || '').toLowerCase().includes('success')
          && !(r.outcome || '').toLowerCase().includes('partial')) {
        ratings[k].success++;
      }
    }

    return {
      overall: tally(rolls),
      byCharacter: Object.entries(byWho)
        .map(([who, list]) => ({ who, ...tally(list) }))
        .sort((a, b) => b.total - a.total),
      darkestDie: dd,
      onesRolled: dd[0].count,
      byTaskRating: Object.values(ratings)
        .sort((a, b) => a.taskRating - b.taskRating)
        .map(r => ({ ...r, successPct: Math.round(100 * r.success / r.count) }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Single-row delete. No confirmation: it's one row, the log is a
    // convenience record rather than game state, and a prompt per row would
    // make tidying up after a test session tedious.
    html.find('.log-del').click(async (ev) => {
      const id = ev.currentTarget.dataset.id;
      if (id) await SessionLog.removeEntry(id);
    });

    // Clearing a whole tab does confirm -- that one can lose real data.
    // Add a leg by hand. Lives in travel-history.mjs (which knows about
    // locations and routes); imported lazily so the log doesn't take a
    // static dependency on the clock.
    html.find('.log-route-map').click(async () => {
      const { RouteMapApp } = await import('./route-map.mjs');
      new RouteMapApp().render(true);
    });

    // Lazily imported for the same reason as the route map: this file is
    // loaded on every client at startup, and credits.mjs pulls in the whole
    // route-map module behind it.
    html.find('.log-credits').click(async () => {
      const { CreditsApp } = await import('./credits.mjs');
      new CreditsApp().render(true);
    });

    html.find('.log-add-move').click(async () => {
      const { TravelHistory } = await import('./travel-history.mjs');
      await TravelHistory.addMoveDialog();
    });

    // Transgressions by hand, for a campaign that started tracking late or
    // a mis-recorded entry. Records history only -- see transgressionDialog.
    html.find('.log-add-transgression').click(() => SessionLog.transgressionDialog());

    html.find('.log-edit-transgression').click((ev) => {
      const id = ev.currentTarget.dataset.id;
      const entry = SessionLog.getLog().entries.find(e => e.id === id);
      if (entry) SessionLog.transgressionDialog(entry);
    });

    // Restore from the module's exported sessions. Asks which record to
    // rebuild -- the session log and the chat log are separate things, and
    // a GM who only lost one should not be made to re-create both.
    html.find('.log-restore').click(async () => {
      const preview = await SessionLog.restoreChat({ dryRun: true });
      if (!preview) return;

      const already = preview.skipped
        ? `<p class="hint">${preview.skipped} of these are already in chat and will be skipped.</p>` : '';

      new Dialog({
        title: 'Restore from exported sessions',
        content: `<div class="darkest-dialog">
          <p>The content module carries <strong>${CHAT_HISTORY.length}</strong> message${CHAT_HISTORY.length === 1 ? '' : 's'} from past sessions.</p>
          ${already}
          <p class="hint">Both options can be run more than once — anything already
          present is skipped rather than duplicated.</p>
        </div>`,
        buttons: {
          both: {
            icon: '<i class="fas fa-clock-rotate-left"></i>',
            label: 'Chat and log',
            callback: async () => {
              await SessionLog.restoreChat();
              await SessionLog.importHistory();
            },
          },
          chat: {
            icon: '<i class="fas fa-comments"></i>',
            label: 'Chat only',
            callback: () => SessionLog.restoreChat(),
          },
          log: {
            icon: '<i class="fas fa-list"></i>',
            label: 'Session log only',
            callback: () => SessionLog.importHistory(),
          },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'both',
      }).render(true);
    });

    // Editing a leg reuses the same dialog. Changing its day or times moves
    // it in the list, because the list is sorted by game time rather than by
    // when it happened to be typed -- so a correction lands where it belongs
    // without anything to drag.
    html.find('.log-edit-move').click(async (ev) => {
      const id = ev.currentTarget.dataset.id;
      const entry = SessionLog.getLog().entries.find(e => e.id === id);
      if (!entry) return;
      const { TravelHistory } = await import('./travel-history.mjs');
      await TravelHistory.addMoveDialog(entry);
    });

    html.find('.log-group-add').click(async () => {
      await TravelGroups.manageDialog();
      this.render();
    });

    html.find('.log-group-edit').click(async (ev) => {
      ev.stopPropagation();
      const group = TravelGroups.get(ev.currentTarget.dataset.id);
      if (group) { await TravelGroups.manageDialog(group); this.render(); }
    });

    // Clicking a chip makes that group the one travel is logged against --
    // the same switch as the travel tool's selector, from wherever you
    // happen to be looking.
    html.find('.log-group-chip').click(async (ev) => {
      await TravelGroups.setActive(ev.currentTarget.dataset.id);
      this.render();
    });

    // Show the whole path when it has been collapsed.
    html.find('.route-expand').click((ev) => {
      $(ev.currentTarget).closest('.log-route').find('.log-route-full').show();
      $(ev.currentTarget).closest('.log-route-chain').hide();
    });

    // Both clears say HOW MUCH will go and default to No. This is the only
    // record of the campaign's movement -- a mis-click here is unrecoverable,
    // and "delete every recorded movement" reads much less alarming than
    // "delete 214 movements" does.
    html.find('.log-import-moves').click(async () => {
      const { MovementImport } = await import('./import-movements.mjs');
      const saved = MovementImport.available
        ? await MovementImport.applySaved({ dryRun: true })
        : null;

      // The module's own copy is the ordinary path -- the route ships with the
      // module exactly as the chat history does, so nothing needs pasting.
      // Pasting stays as the fallback for a log the module has not caught up
      // with, or a route from another table.
      const savedNote = saved
        ? `<p>The content module carries a saved route of
             <strong>${saved.rows}</strong> movement${saved.rows === 1 ? '' : 's'}` +
          (saved.problems.length
            ? `, though ${saved.problems.length} row(s) name a place this map does not have.`
            : '.') + `</p>`
        : `<p class="hint">The content module carries no saved route. Export a session
             log and run <code>build_route_history.py</code> to put one there.</p>`;

      new Dialog({
        title: 'Restore movement',
        content: `<div class="darkest-dialog">
          ${savedNote}
          <p class="hint">Travel is the one thing the chat history cannot restore —
             travel messages never name the destination, so the route lives only here.</p>
          <hr>
          <p class="hint">Or paste an exported session log to use its Movements table instead:</p>
          <textarea name="md" rows="7" style="width:100%; font-family:monospace; font-size:11px;"
                    placeholder="## Movements&#10;| # | From | To | Route | Took | Game time |"></textarea>
        </div>`,
        buttons: {
          saved: {
            icon: '<i class="fas fa-box-archive"></i>',
            label: saved ? `Restore ${saved.rows} from module` : 'Nothing saved',
            callback: async () => {
              if (!saved) {
                ui.notifications.warn('No saved route in the content module.');
                return;
              }
              await MovementImport.applySaved();
            },
          },
          pasted: {
            icon: '<i class="fas fa-file-import"></i>',
            label: 'Use pasted text',
            callback: async (html) => {
              const el = html[0] ?? html;
              const md = el.querySelector('textarea[name="md"]')?.value ?? '';
              if (!md.trim()) {
                ui.notifications.warn('Nothing pasted.');
                return;
              }
              await MovementImport.apply(md);
            },
          },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: saved ? 'saved' : 'pasted',
      }, { width: 560 }).render(true);
    });

    html.find('.log-dedupe').click(async () => {
      const found = await SessionLog.dedupeRolls({ dryRun: true });
      if (!found?.duplicates) {
        ui.notifications.info('No duplicate rolls found.');
        return;
      }
      const ok = await Dialog.confirm({
        title: 'Remove duplicate rolls',
        content: `<div class="darkest-dialog">
          <p><strong>${found.duplicates}</strong> of ${found.total} rolls look like the same roll recorded twice.</p>
          <p class="hint">The fuller copy of each is kept — the one carrying a location or a called-upon-the-woods flag. This cannot be undone.</p>
        </div>`,
        yes: () => true, no: () => false, defaultYes: false,
      });
      if (ok) await SessionLog.dedupeRolls();
    });

    html.find('.log-clear-kind').click(async (ev) => {
      const kind = ev.currentTarget.dataset.kind;
      const labels = { move: 'movements', roll: 'rolls', transgression: 'transgressions' };
      const label = labels[kind] || 'entries';
      const n = SessionLog.getLog().entries.filter(e => e.kind === kind).length;
      if (!n) {
        ui.notifications.info(`No ${label} to clear.`);
        return;
      }
      const ok = await Dialog.confirm({
        title: `Clear ${label}?`,
        content: `<p>Permanently delete <strong>${n}</strong> ${n === 1 ? label.replace(/s$/, '') : label}?</p>
                  <p class="notes">Other tabs are untouched. This cannot be undone.</p>`,
        defaultYes: false,
      });
      if (ok) {
        const deleted = await SessionLog.removeKind(kind);
        ui.notifications.info(`Deleted ${deleted} ${label}.`);
      }
    });

    html.find('.log-clear').click(async () => {
      const all = SessionLog.getLog().entries;
      if (!all.length) {
        ui.notifications.info('The log is already empty.');
        return;
      }
      const moves = all.filter(e => e.kind === 'move').length;
      const rolls = all.filter(e => e.kind === 'roll').length;
      const trans = all.filter(e => e.kind === 'transgression').length;
      const ok = await Dialog.confirm({
        title: 'Clear the whole session log?',
        content: `<p>Permanently delete <strong>${all.length}</strong> entries?</p>
                  <ul class="notes">
                    <li>${moves} movement${moves === 1 ? '' : 's'}</li>
                    <li>${rolls} roll${rolls === 1 ? '' : 's'}</li>
                    <li>${trans} transgression${trans === 1 ? '' : 's'}</li>
                  </ul>
                  <p class="notes"><strong>This cannot be undone.</strong> Export first if you want to keep it.</p>`,
        defaultYes: false,
      });
      if (ok) await SessionLog.clear();
    });

    html.find('.log-export').click(() => this._export());
  }

  /** Dump the log as Markdown, for pasting into notes or a map tool. */
  _export() {
    const { moves, route, routes, multipleGroups, stats, transgressions } = this.getData();
    const lines = ['# Darkest Woods — session log', ''];

    // One path per group once the party has split. Exporting the merged
    // chain instead produced exactly the zig-zag between two parties -- and
    // a phantom gap at every handover -- that per-group routes exist to
    // avoid; the display had been fixed and the export left behind.
    const sections = multipleGroups
      ? routes.map(r => ({ heading: `Path walked — ${r.groupName}`, ...r }))
      : [{ heading: 'Path walked', ...route }];

    for (const s of sections) {
      if (!s.chain?.length) continue;
      lines.push(`## ${s.heading}`, '', s.plainText, '');
      if (s.gapCount) {
        lines.push(`> **${s.gapCount} gap${s.gapCount === 1 ? '' : 's'} in the record:** `
          + s.gaps.join('; '), '');
      }
      if (s.revisited.length) {
        lines.push(`**Revisited:** ${s.revisited.join(', ')}`, '');
        lines.push('_Retracing the same path on consecutive days is a transgression._', '');
      }
    }

    if (moves.length) {
      lines.push('## Movements', '', '| # | From | To | Route | Took | Game time |', '|---|---|---|---|---|---|');
      // moves arrives newest-first for display; export reads better forwards
      [...moves].reverse().forEach(m => {
        lines.push(`| ${m.index} | ${m.from} | ${m.to} | ${m.label} | ${m.duration} | ${m.gameTime} |`);
      });
      lines.push('');
    }

    if (stats) {
      lines.push('## Dice', '');
      lines.push(`Rolls: **${stats.overall.total}** — `
        + `${stats.overall.success} success (${stats.overall.successPct}%), `
        + `${stats.overall.partial} partial, `
        + `${stats.overall.failure} failure (${stats.overall.failurePct}%)`, '');
      lines.push('| Character | Rolls | Success | Partial | Failure | Called the woods |',
                 '|---|---|---|---|---|---|');
      stats.byCharacter.forEach(c => {
        lines.push(`| ${c.who} | ${c.total} | ${c.success} (${c.successPct}%) | ${c.partial} | ${c.failure} | ${c.calledWoods} |`);
      });
      lines.push('', `Darkest Die 1s rolled: **${stats.onesRolled}**`);
      if (stats.overall.calledWoods) {
        lines.push(`Called upon the woods: **${stats.overall.calledWoods}** `
          + `(each one a Doom and a transgression)`);
      }
      lines.push('');
    }

    if (transgressions.length) {
      lines.push('## Transgressions', '');
      [...transgressions].reverse().forEach(t => {
        lines.push(`- ${t.region} → level ${t.level}${t.witch ? ` (${t.witch})` : ''}`);
      });
    }

    const text = lines.join('\n');
    // A dialog with the text selectable beats a file download: the GM is
    // usually pasting this straight into their own notes.
    new Dialog({
      title: 'Session log — copy this',
      content: `<textarea class="log-export-text" rows="20" style="width:100%;font-family:monospace;font-size:11px;">${foundry.utils.escapeHTML(text)}</textarea>`,
      buttons: {
        copy: {
          icon: '<i class="fas fa-copy"></i>',
          label: 'Copy to clipboard',
          callback: () => {
            game.clipboard.copyPlainText(text);
            ui.notifications.info('Session log copied.');
          }
        },
        close: { icon: '<i class="fas fa-times"></i>', label: 'Close' }
      },
      default: 'copy'
    }, { width: 640 }).render(true);
  }
}

export function registerSessionLog() {
  game.settings.register('darkest-system', SETTING_LOG, {
    name: 'Session Log',
    scope: 'world',
    config: false,
    type: Object,
    default: { entries: [] }
  });
}
