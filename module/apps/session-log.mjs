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
  static recordRoll({ who, characterRating, taskRating, target, total, darkestDie, outcome }) {
    return SessionLog.record({
      kind: 'roll', who, characterRating, taskRating, target, total, darkestDie, outcome
    });
  }

  /** A transgression fired. */
  static recordTransgression({ region, level, witch }) {
    return SessionLog.record({ kind: 'transgression', region, level, witch });
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
        when: SessionLog._clock(t)
      })).reverse(),
      transgressionCount: transgressions.length
    };
  }

  static _clock(e) {
    const d = new Date(e.t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
    const byGroup = new Map();
    for (const m of moves) {
      // Legs from before groups existed belong to the first group, which is
      // what they were recorded as.
      const key = m.groupId ?? '__legacy__';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(m);
    }
    return [...byGroup.entries()].map(([groupId, legs]) => ({
      groupId: groupId === '__legacy__' ? null : groupId,
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
      const out = { total: list.length, success: 0, partial: 0, failure: 0 };
      for (const r of list) {
        const o = (r.outcome || '').toLowerCase();
        if (o.includes('partial')) out.partial++;
        else if (o.includes('success')) out.success++;
        else out.failure++;
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

    html.find('.log-add-move').click(async () => {
      const { TravelHistory } = await import('./travel-history.mjs');
      await TravelHistory.addMoveDialog();
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
    const { moves, route, stats, transgressions } = this.getData();
    const lines = ['# Darkest Woods — session log', ''];

    if (route.chain.length) {
      lines.push('## Path walked', '', route.plainText, '');
      if (route.gapCount) {
        lines.push(`> **${route.gapCount} gap${route.gapCount === 1 ? '' : 's'} in the record:** `
          + route.gaps.join('; '), '');
      }
      if (route.revisited.length) {
        lines.push(`**Revisited:** ${route.revisited.join(', ')}`, '');
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
      lines.push('| Character | Rolls | Success | Partial | Failure |', '|---|---|---|---|---|');
      stats.byCharacter.forEach(c => {
        lines.push(`| ${c.who} | ${c.total} | ${c.success} (${c.successPct}%) | ${c.partial} | ${c.failure} |`);
      });
      lines.push('', `Darkest Die 1s rolled: **${stats.onesRolled}**`, '');
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
