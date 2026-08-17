/**
 * The credits sequence.
 *
 * Three finished systems, shown together for the first time: the animated
 * route map on the book's own art, a feed of what happened at each place as
 * the line reaches it, and the dice statistics filling in as it goes.
 *
 * ---
 *
 * WHY THIS IS NOT A MODE ON RouteMapApp
 *
 * That app has a hardcoded singleton DOM id, which already produced a stacked
 * window once (see the note on broadcast() in route-map.mjs). It is also an
 * interactive tool -- pin renaming, style and speed pickers, static map first
 * -- where this is the opposite: no interaction, playhead from zero, nothing
 * to click. A flag would need a guard on every listener.
 *
 * Everything worth sharing is module-level and imported here: drawRoute,
 * paintBackdrop, buildPlan, buildTimeline. In particular buildTimeline is the
 * ONE timing contract -- two windows each deciding how long a stay lasts
 * would drift apart the first time either was tuned.
 *
 * ---
 *
 * HOW THE PANELS KEEP STEP
 *
 * One timeline, three consumers. Every event's wall-clock offset is computed
 * ONCE at play start by interpolating its game-time `when` between the steps
 * that bracket it. The tick loop then does a single comparison against a
 * monotonic cursor, so revealing is O(1) per frame and one-way -- which is
 * what lets a row animate in as it arrives.
 *
 * The feed is DOM rather than canvas because it must scroll and reflow, and
 * it is mutated through cached element references. render() is never called
 * during playback: a Foundry re-render would destroy and rebuild the canvas
 * mid-animation.
 */

import {
  MAP_DATA, RouteMap, drawRoute, paintBackdrop, buildTimeline, stayKind,
} from './route-map.mjs';
import { SessionLog } from './session-log.mjs';
import { TravelHistory } from './travel-history.mjs';

/**
 * Turn a game-time `when` into a wall-clock offset within the replay.
 *
 * Exported for the verification suite: this is the one piece of genuinely new
 * arithmetic in the feature, and the zero-denominator case below is easy to
 * regress.
 */
export function eventOffset(when, timeline) {
  const { steps, offsets, total } = timeline;
  // An unplaced event (no location, no bracket) is on screen from the start,
  // so an old campaign still shows a full statistics panel rather than an
  // empty one for the first several minutes.
  //
  // The check is for a NUMBER, not merely for presence. A string here compares
  // false against every numeric step time, so the event finds no bracket and
  // silently lands at zero -- which is how the whole back catalogue once
  // arrived on the first frame.
  if (!Number.isFinite(when)) return 0;

  let i = -1;
  for (let k = 0; k < steps.length; k++) {
    if (steps[k].when != null && steps[k].when <= when) i = k;
  }
  if (i < 0) return 0;
  if (i >= steps.length - 1) return total;

  const a = steps[i].when, b = steps[i + 1].when;
  // Two steps very often share a game minute -- a leg's arrival and the next
  // leg's departure. Interpolating then divides by zero, so the event simply
  // fires as the playhead leaves the step.
  if (b == null || b <= a) return offsets[i + 1];

  const frac = (when - a) / (b - a);
  return offsets[i] + frac * (offsets[i + 1] - offsets[i]);
}

/**
 * Everything that happened, in the order it will be revealed.
 *
 * Rolls carrying their own location (0.45.0+) are used as they are; older
 * ones are placed by SessionLog._bracketRolls and marked `inferred`.
 */
export function buildEvents(entries, moves) {
  const rolls = SessionLog._bracketRolls(
    entries.filter(e => e.kind === 'roll'), moves);

  const events = rolls.map(r => ({
    kind: 'roll',
    when: r.when ?? null,
    inferred: !!r.inferred,
    where: r.atTitle || r.atSlug || null,
    who: r.who || 'Someone',
    outcome: r.outcome || '',
    calledWoods: !!r.calledWoods,
    darkestDie: r.darkestDie,
    total: r.total,
    target: r.target,
    roll: r,                       // kept so _rollStats sees the real entry
  }));

  // Transgressions ride along: they are already dated in game time when
  // entered by hand, and they are the loudest thing that can happen at a
  // place. Ones with no day at all stay unplaced, like an unbracketed roll.
  for (const t of entries.filter(e => e.kind === 'transgression')) {
    events.push({
      kind: 'transgression',
      when: t.day != null ? SessionLog._legMinutes({ day: t.day, time: t.time }) : null,
      inferred: false,
      where: t.region || null,
      who: t.witch || 'The woods',
      level: t.level,
    });
  }

  // Harm. Only wounds the party TOOK -- a wound dealt to a wolf is the
  // mechanism, and the wolf falling over already tells that story. Scratches
  // are dropped for the same reason: "no wound inflicted" is not an event.
  //
  // These are bracketed like rolls, since the imported ones carry only a
  // wall clock; anything already placed keeps its own location.
  const harms = SessionLog._bracketRolls(
    entries.filter(e => e.kind === 'harm' && e.taken !== false && e.event !== 'scratch'),
    moves);
  for (const h of harms) {
    events.push({
      kind: 'harm',
      when: h.when ?? null,
      inferred: !!h.inferred,
      where: h.atTitle || h.atSlug || null,
      who: h.who || 'Someone',
      event: h.event || 'wound',
      rating: h.rating,
      woundType: h.woundType,
    });
  }

  // Sort by game time; unplaced events first, holding their recorded order so
  // a session with no dates at all still reads in sequence.
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const aw = a.e.when, bw = b.e.when;
      if (aw == null && bw == null) return a.i - b.i;
      if (aw == null) return -1;
      if (bw == null) return 1;
      return (aw - bw) || (a.i - b.i);
    })
    .map(x => x.e);
}

export class CreditsApp extends Application {

  constructor(options = {}) {
    super(options);
    this.mapSlug = null;
    this.playing = false;
    this._images = {};
    this._raf = null;
    this._seq = 0;              // starts at the beginning, unlike the route map
    this._plan = null;
    this._timeline = null;
    this._events = [];
    this._cursor = 0;
    this._revealed = [];        // roll entries revealed so far, for _rollStats
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'darkest-credits',
      title: 'Credits',
      template: 'systems/darkest-system/templates/apps/credits.hbs',
      classes: ['darkest-system', 'credits'],
      width: 1180,
      height: 800,
      resizable: true,
    });
  }

  /** @override */
  getData() {
    const moves = TravelHistory.moves();
    this._plan = RouteMap.buildPlan({ moves });
    this._events = buildEvents(SessionLog.getLog().entries, moves);

    // Open on whichever map carries the most of the journey, as the route map
    // does -- the replay follows the party from there.
    if (!this.mapSlug) {
      const tally = {};
      for (const g of this._plan.groups) {
        for (const s of g.steps) if (s.map) tally[s.map] = (tally[s.map] || 0) + 1;
      }
      this.mapSlug = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0]
        ?? this._plan.maps[0] ?? null;
    }

    return {
      available: RouteMap.available(),
      hasRoute: this._plan.totalSteps > 0,
      eventCount: this._events.length,
      unplaced: this._events.filter(e => e.when == null).length,
      playing: this.playing,
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Cached once. Everything during playback mutates these directly rather
    // than re-rendering, which would rebuild the canvas mid-animation.
    this._canvas = html.find('canvas.credits-canvas')[0] ?? null;
    this._stage = html.find('.credits-map')[0] ?? null;
    this._feed = html.find('.credits-feed-rows')[0] ?? null;
    this._statsEl = html.find('.credits-stats-body')[0] ?? null;
    this._playBtn = html.find('.credits-play')[0] ?? null;
    this._stopBtn = html.find('.credits-stop')[0] ?? null;

    html.find('.credits-play').click(() => this.play());
    html.find('.credits-stop').click(() => this.stop());

    // Always open on an EMPTY map. _seq survives a re-render, so painting at
    // its old value showed the finished route the moment the window opened.
    this._seq = 0;
    this._redraw(0);
    this._renderStats();
    this._setButtons();
  }

  // ── The map ───────────────────────────────────────────────────────────

  /**
   * The official art, always. The credits are an end-of-arc artefact shown on
   * the GM's screen -- the sketch style exists to keep the real maps away
   * from players, and there is no share path here.
   */
  async _loadImages() {
    const src = MAP_DATA.maps?.[this.mapSlug]?.image;
    if (!src || this._images[this.mapSlug]) return;
    await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { this._images[this.mapSlug] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  async _redraw(revealSeq = this._seq, { holdSeq = null, phase = 0 } = {}) {
    if (!this._canvas || !this._plan) return;
    await this._loadImages();

    const map = MAP_DATA.maps?.[this.mapSlug];
    // Measured from the PARENT, not the canvas. A canvas inside a flex child
    // reports its attribute width, so measuring itself feeds its own growth
    // back in and the thing swells every frame.
    const availW = this._stage?.clientWidth || 820;
    const availH = this._stage?.clientHeight || 600;
    const ratio = map ? (map.height / map.width) : 0.75;

    // FIT INSIDE BOTH dimensions, not just the width.
    //
    // Sizing to the width alone works for the landscape maps and clips the
    // portrait ones badly: The Lost is 1540x2000, so at 854px wide it wants
    // 1109px of height in a 724px space and the bottom third of the region
    // simply vanished. Take whichever constraint binds first.
    let w = availW;
    let h = Math.round(w * ratio);
    if (h > availH) {
      h = availH;
      w = Math.round(h / ratio);
    }

    // Assigning width/height CLEARS the canvas, so only do it on a change.
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }

    drawRoute(this._canvas.getContext('2d'), this._plan, {
      revealSeq,
      width: w,
      height: h,
      style: 'real',
      mapSlug: this.mapSlug,
      images: this._images,
      backdrop: this._backdrop(w, h),
      holdSeq,
      phase,
    });
  }

  /** The map art, painted once and blitted per frame. */
  _backdrop(w, h) {
    const key = `real:${this.mapSlug}:${w}x${h}`;
    if (this._backdropKey === key && this._backdropCanvas) return this._backdropCanvas;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    paintBackdrop(off.getContext('2d'), {
      width: w, height: h, style: 'real', image: this._images[this.mapSlug],
    });
    this._backdropKey = key;
    this._backdropCanvas = off;
    return off;
  }

  // ── The panels ────────────────────────────────────────────────────────

  _revealEvent(ev) {
    if (ev.kind === 'roll') this._revealed.push(ev.roll);
    this._appendRow(ev);
    this._renderStats();
  }

  _appendRow(ev) {
    if (!this._feed) return;
    const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');

    const row = document.createElement('div');
    row.className = `credits-row kind-${ev.kind}`;
    if (ev.calledWoods) row.classList.add('called-woods');

    // A place is worth showing only when it changes -- repeating "Glory's
    // Cabin" down twelve rows is noise, and the map already says where.
    const place = ev.where && ev.where !== this._lastPlace
      ? `<div class="credits-row-place">${esc(ev.where)}${ev.inferred ? ' <span class="credits-approx" data-tooltip="Placed by when it happened, not recorded">~</span>' : ''}</div>`
      : '';
    if (ev.where) this._lastPlace = ev.where;

    if (ev.kind === 'transgression') {
      row.innerHTML = `${place}
        <div class="credits-row-body">
          <span class="credits-who">${esc(ev.who)}</span>
          <span class="credits-detail">transgression ${esc(ev.level)}</span>
        </div>`;
    } else if (ev.kind === 'harm') {
      const what = ev.event === 'wound'
        ? `Rating ${esc(ev.rating)} ${esc(ev.woundType || '')} wound`
        : esc(ev.event);
      row.innerHTML = `${place}
        <div class="credits-row-body">
          <span class="credits-who">${esc(ev.who)}</span>
          <span class="credits-harm">${what}</span>
        </div>`;
    } else {
      const outcome = (ev.outcome || '').toLowerCase();
      const cls = outcome.includes('partial') ? 'partial'
        : outcome.includes('success') ? 'success' : 'failure';
      row.innerHTML = `${place}
        <div class="credits-row-body">
          <span class="credits-who">${esc(ev.who)}</span>
          <span class="credits-outcome ${cls}">${esc(ev.outcome)}</span>
          ${ev.calledWoods ? '<span class="credits-called" data-tooltip="Called upon the woods — a Doom and a transgression">called</span>' : ''}
        </div>`;
    }

    this._feed.appendChild(row);
    // Two frames, or the browser folds the insert and the transition into one
    // paint and the row simply appears.
    requestAnimationFrame(() => requestAnimationFrame(() => row.classList.add('shown')));
    this._feed.scrollTop = this._feed.scrollHeight;
  }

  /**
   * The running totals.
   *
   * Calls the session log's OWN _rollStats on the growing slice rather than
   * keeping a separate accumulator. It is O(n^2) in principle and trivial in
   * practice, and it guarantees the credits' final numbers are identical to
   * the session log's -- a second definition of the statistics would drift.
   */
  _renderStats() {
    if (!this._statsEl) return;
    const stats = SessionLog._rollStats(this._revealed);
    if (!stats) {
      this._statsEl.innerHTML = '<p class="credits-empty">No rolls yet.</p>';
      return;
    }
    const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');
    const o = stats.overall;

    const rows = stats.byCharacter.map(c => `
      <tr>
        <td>${esc(c.who)}</td>
        <td>${c.total}</td>
        <td class="credits-stat-success">${c.successPct}%</td>
        <td class="${c.calledWoods ? 'credits-stat-called' : 'credits-dim'}">${c.calledWoods}</td>
      </tr>`).join('');

    this._statsEl.innerHTML = `
      <div class="credits-stat-line">
        <strong>${o.total}</strong> roll${o.total === 1 ? '' : 's'} —
        ${o.success} success (${o.successPct}%), ${o.partial} partial, ${o.failure} failure
      </div>
      <div class="credits-stat-line">
        Darkest Die 1s: <strong>${stats.onesRolled}</strong>
        ${o.calledWoods ? ` · called upon the woods: <strong>${o.calledWoods}</strong>` : ''}
      </div>
      <table class="credits-stat-table">
        <thead><tr><th>Character</th><th>Rolls</th><th>Success</th><th>Called</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Playback ──────────────────────────────────────────────────────────

  async play() {
    this.stop();

    // Start clean: the feed and the totals rebuild from zero, so pressing
    // play twice does not show every event a second time.
    this._cursor = 0;
    this._revealed = [];
    this._lastPlace = null;
    if (this._feed) this._feed.innerHTML = '';
    this._renderStats();

    // Wind the map back BEFORE the first frame, and paint it empty.
    //
    // Without this the previous run's finished playhead was still on _seq, so
    // the whole route flashed up complete, vanished on the first tick, and
    // then animated -- which is exactly what it looked like. The paint has to
    // happen here rather than being left to the tick, because _redraw is
    // async (it awaits _loadImages) and the first tick can land before it.
    this._seq = 0;
    await this._redraw(0);

    this._timeline = buildTimeline(this._plan);
    const { steps, durations, total } = this._timeline;
    if (!steps.length) return;

    // Every event's wall-clock moment, computed ONCE. Recomputing per frame
    // would be the whole timeline per tick for no benefit.
    const scheduled = this._events
      .map(e => ({ ...e, at: eventOffset(e.when, this._timeline) }))
      .sort((a, b) => a.at - b.at);
    this._scheduled = scheduled;

    this.playing = true;
    this._setButtons();
    const startedAt = Date.now();

    const tick = () => {
      if (!this.playing) return;
      const elapsed = Date.now() - startedAt;

      // The same walk the route map's replay uses: fractional progress, with
      // a stay holding the line at its pin while the ring breathes.
      let acc = 0, progress = 0, holdSeq = null, holdPhase = 0;
      for (let i = 0; i < durations.length; i++) {
        const d = durations[i];
        if (elapsed >= acc + d) { progress = i + 1; acc += d; continue; }
        const into = Math.max(0, elapsed - acc) / d;
        if (steps[i].type === 'stay') {
          progress = i + 1;
          holdSeq = steps[i].seq;
          holdPhase = into;
        } else {
          progress = i + into;
        }
        acc = Infinity;
        break;
      }

      // Follow the party onto whichever map they are on now.
      const under = steps[Math.min(Math.floor(progress), steps.length - 1)];
      const onMap = under?.map ?? (under?.type === 'cross' ? under.to : null);
      if (onMap && onMap !== this.mapSlug) {
        this.mapSlug = onMap;
        this._loadImages();          // fire and forget; next frame draws it
      }

      // A monotonic cursor, not a filter: revealing is one-way, which is what
      // lets each row animate in exactly once.
      while (this._cursor < scheduled.length && scheduled[this._cursor].at <= elapsed) {
        this._revealEvent(scheduled[this._cursor]);
        this._cursor++;
      }

      this._seq = progress;
      this._redraw(progress, { holdSeq, phase: holdPhase });

      if (elapsed >= total) {
        // Anything still pending (an event past the last step) lands now, so
        // the totals always finish complete.
        while (this._cursor < scheduled.length) {
          this._revealEvent(scheduled[this._cursor]);
          this._cursor++;
        }
        this.playing = false;
        this._seq = steps.length;
        this._redraw(steps.length);
        // The buttons are toggled directly rather than by re-rendering.
        // render() rebuilds the DOM, which would throw away the feed the GM
        // has just watched fill -- and it re-runs activateListeners, whose
        // opening _redraw(this._seq) then repainted the FINISHED route as the
        // first thing the next run showed.
        this._setButtons();
        return;
      }
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Toggle the toolbar to match `playing`.
   *
   * Done by hand rather than through render(), which would rebuild the DOM
   * and take the feed with it.
   */
  _setButtons() {
    if (this._playBtn) this._playBtn.disabled = this.playing;
    if (this._stopBtn) this._stopBtn.disabled = !this.playing;
  }

  stop() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._setButtons();
  }

  /** @override */
  async close(options) {
    this.stop();
    return super.close(options);
  }
}
