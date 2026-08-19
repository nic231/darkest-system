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

/** The overview: the whole woods, with an `area` pin for every region. */
const OVERVIEW = 'the-darkest-woods';

/** The whole of whatever map is showing. */
export const WHOLE = Object.freeze({ x: 0, y: 0, w: 100, h: 100 });

/**
 * Where a REGION sits on the overview map.
 *
 * Walks outward through areaParents rather than looking the slug up directly,
 * because three regions have no overview pin at all and must resolve to a
 * parent: a-town-called-dismal -> the-dismal, the-ghost-caves -> the-lost,
 * the-temple-of-the-moon -> the-keepers.
 *
 * DELIBERATELY NOT RouteMap.resolvePin(slug, OVERVIEW), which looks like it
 * would do this and does something else. Twenty-five locations carry their
 * own pin on the overview, so that call returns the LOCATION rather than its
 * region -- and because _contains(OVERVIEW, anything) is true (the overview
 * is an ancestor of every region), passing it as `prefer` would also stick
 * every dual-pinned location on the overview for the rest of the run. That is
 * the Ghost Caves inset-squeeze bug with a wider blast radius; see the note
 * at resolvePin in route-map.mjs.
 *
 * It lives here rather than on RouteMap so it cannot be reached by accident.
 */
export function overviewPinForMap(mapSlug, data = MAP_DATA) {
  const pins = data.maps?.[OVERVIEW]?.pins || {};
  const parents = data.areaParents || {};
  let cur = mapSlug;
  // The hop guard is not paranoia about the data (areas.json is a clean tree)
  // but about a future content update introducing a cycle, which would hang
  // the replay with no clue why.
  for (let hops = 0; cur && hops < 10; hops++) {
    // The overview carries a decorative pin for ITSELF. Reaching it means we
    // walked past every real region, and centring the camera on a title mark
    // would be wrong.
    if (cur === OVERVIEW) return null;
    const p = pins[cur];
    // `kind` must be 'area': a region slug that collided with a location pin
    // would otherwise win and put the camera in the wrong place.
    if (p && p.kind === 'area') return { x: p.x, y: p.y, slug: cur };
    cur = parents[cur];
  }
  return null;
}

/** Cubic in-out. Both ends of every move here are stationary holds. */
const ease = (t) => {
  const k = Math.max(0, Math.min(1, t));
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};

/**
 * Blend two views.
 *
 * Both must be on the SAME map. Interpolating across maps is meaningless --
 * the percentages refer to different images -- so a cross-map move is done by
 * routing through the overview and cutting at matched scale, never by
 * blending two backdrops.
 */
export function lerpView(a, b, t) {
  const k = ease(t);
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    w: a.w + (b.w - a.w) * k,
    h: a.h + (b.h - a.h) * k,
  };
}

/**
 * A view of the given size centred on a point, kept inside the map.
 *
 * The clamp is what stops the camera drifting off the edge when the party is
 * near a corner -- without it the backdrop's source rectangle would run past
 * the image and the frame would show empty canvas.
 */
export function centredView(cx, cy, w, h) {
  const ww = Math.max(1, Math.min(100, w));
  const hh = Math.max(1, Math.min(100, h));
  return {
    x: Math.max(0, Math.min(100 - ww, cx - ww / 2)),
    y: Math.max(0, Math.min(100 - hh, cy - hh / 2)),
    w: ww,
    h: hh,
  };
}

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
    this._paintSeq = 0;         // paint ticket; see _redraw
    this._plan = null;
    this._timeline = null;
    this._events = [];
    this._cursor = 0;
    this._revealed = [];        // roll entries revealed so far, for _rollStats

    // ── The camera ──────────────────────────────────────────────────────
    //
    // Its map is deliberately a SEPARATE field from this.mapSlug. The tick's
    // map-following sets mapSlug from the replay's steps; the camera may be
    // over the overview at the same moment. Conflating them means the two
    // fight every frame -- and worse, letting the overview reach anything
    // that feeds resolvePin sticks every dual-pinned location on it.
    // The kill switch. This runs live at the end of an arc, so there has to
    // be a way to fall back to the plain per-map replay without a code
    // change; with it off, every view is the whole map and the camera never
    // starts a phase.
    this._camera = true;
    this._cam = null;           // { phase, map, from, to, startedAt, ms, ... }
    this._camMap = null;        // which map the camera is looking at
    this._camView = { ...WHOLE };
    this._camCentre = null;     // the damped follow target, in map percent

    // Wall-clock time the camera has taken. Subtracted from the replay's
    // elapsed, so the replay's clock FREEZES while the camera moves and the
    // timeline stays byte-identical to the one buildTimeline produced.
    this._cameraDebt = 0;

    // Backdrops, keyed by map. Multi-slot rather than the single slot the
    // route map uses: a crossing swaps map twice, and repainting a full-size
    // backdrop mid-transition is exactly the frame where it shows.
    this._backdrops = new Map();
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

    // Takes effect on the next play rather than mid-flight: switching the
    // camera off halfway through would strand it in whatever view it had.
    const cam = html.find('[name="camera"]')[0];
    if (cam) {
      cam.checked = this._camera;
      cam.addEventListener('change', () => { this._camera = cam.checked; });
    }

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
  /**
   * Load a map's art.
   *
   * Returns a cached image SYNCHRONOUSLY -- `true` rather than a promise --
   * so a caller can avoid awaiting at all when there is nothing to wait for.
   * Every await inside a per-frame paint is a chance for frames to land out
   * of order, and the steady state is that the art is already loaded.
   */
  _loadImages(mapSlug = this.mapSlug) {
    const src = MAP_DATA.maps?.[mapSlug]?.image;
    if (!src || this._images[mapSlug]) return true;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { this._images[mapSlug] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  /**
   * Have a map's art and backdrop ready before the camera needs them.
   *
   * A crossing knows its destination 900ms ahead, and the prologue's opening
   * hold is free time. Without this the first frame after each cut is a blank
   * map while the image resolves.
   */
  async _prewarm(mapSlug) {
    if (!mapSlug) return;
    await this._loadImages(mapSlug);
    if (this._stageW) this._backdrop(mapSlug, this._stageW, this._stageH);
  }

  /**
   * The stage: ONE canvas size for the whole sequence.
   *
   * Sized from the OVERVIEW's ratio, because the sequence opens and closes on
   * it and it is the widest frame available.
   *
   * Fixed rather than per-map, and that is a prerequisite rather than a
   * preference. Every region map is portrait (1540x2000, ratio 1.299) while
   * the overview is landscape (2560x1662, ratio 0.649) -- so a camera that
   * swapped maps mid-move would change the canvas SHAPE, and assigning
   * canvas.width clears the buffer, so the frame would flash. A whole region
   * is pillarboxed against the canvas's own black, which is what a 4:3 film
   * looks like on a 16:9 screen, and the camera is zoomed in most of the time
   * anyway.
   */
  _measureStage() {
    const availW = this._stage?.clientWidth || 820;
    const availH = this._stage?.clientHeight || 600;
    const ov = MAP_DATA.maps?.[OVERVIEW];
    const ratio = ov ? (ov.height / ov.width) : 0.65;

    let w = availW;
    let h = Math.round(w * ratio);
    if (h > availH) { h = availH; w = Math.round(h / ratio); }
    this._stageW = w;
    this._stageH = h;
    return { w, h };
  }

  async _redraw(revealSeq = this._seq, { holdSeq = null, phase = 0, view = null, map = null } = {}) {
    if (!this._canvas || !this._plan) return;

    // Which map is on screen is the CAMERA's business when it is running, and
    // the replay's otherwise.
    const showMap = map ?? this._camMap ?? this.mapSlug;

    // ── Frames must land in the order they were issued ──────────────────
    //
    // This method is async, and the await below only actually suspends on the
    // frame where a map's art is first needed -- which is exactly the frame a
    // map change happens on. Two paints then resolve out of order: a later
    // frame's full line is drawn, and the earlier frame's near-empty map
    // repaints over it. That is the "drawn instantly, disappears, then
    // animates" seen from the first map change onward.
    //
    // So stamp each paint and drop any that has been overtaken. Cheaper and
    // more robust than trying to keep the loads ordered.
    const ticket = ++this._paintSeq;
    const pending = this._loadImages(showMap);
    if (pending !== true) await pending;
    if (ticket !== this._paintSeq) return null;   // overtaken; that frame won

    const { w, h } = this._measureStage();

    // Assigning width/height CLEARS the canvas, so only do it on a change --
    // which, with a fixed stage, now only happens when the window is resized.
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }

    drawRoute(this._canvas.getContext('2d'), this._plan, {
      revealSeq,
      width: w,
      height: h,
      style: 'real',
      mapSlug: showMap,
      images: this._images,
      backdrop: this._backdrop(showMap, w, h),
      holdSeq,
      phase,
      view,
    });

    return { ctx: this._canvas.getContext('2d'), w, h };
  }

  /** The map art, painted once and blitted per frame. */
  /**
   * The map art, painted once per map and blitted per frame.
   *
   * The key does NOT include the view, deliberately: the backdrop is always
   * the whole map, and drawRoute crops it with a source rectangle. So zooming
   * never invalidates the cache, which is the whole reason to crop at blit
   * time rather than pre-cropping.
   *
   * Multi-slot, unlike the route map's single slot. A crossing swaps map
   * twice, and with one slot each swap discards the other map and repaints a
   * full-size backdrop -- mid-transition, on the frames where smoothness
   * actually shows.
   */
  _backdrop(mapSlug, w, h) {
    const key = `${mapSlug}:${w}x${h}`;
    const hit = this._backdrops.get(key);
    if (hit) return hit;

    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    paintBackdrop(off.getContext('2d'), {
      width: w, height: h, style: 'real', image: this._images[mapSlug],
    });

    // A resize changes every key at once, so drop stale sizes rather than
    // letting them accumulate. The overview is kept whatever happens -- every
    // transition passes through it.
    for (const k of [...this._backdrops.keys()]) {
      if (!k.endsWith(`:${w}x${h}`) && !k.startsWith(`${OVERVIEW}:`)) {
        this._backdrops.delete(k);
      }
    }
    this._backdrops.set(key, off);
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

  // ── The camera ────────────────────────────────────────────────────────

  /**
   * How tightly the camera sits on the party once it is on a region map, as a
   * percentage of that map.
   *
   * 100 -- the WHOLE region, held still. The zoom belongs on the overview,
   * where it says "here is where in the woods this is"; on a region map it
   * only hides the rest of the route and makes the art harder to follow.
   *
   * At 100 centredView clamps to exactly WHOLE from any centre, so the follow
   * damping below becomes a no-op rather than dead code needing a branch.
   * Lower this and the follow simply switches back on.
   */
  static FOLLOW = 100;

  /** Phase lengths, in ms. The camera's own clock -- see _cameraDebt. */
  static BEATS = {
    holdWide: 1200,   // prologue: the whole woods, before anything moves
    pushIn: 1400,     // overview -> the region
    settle: 700,      // the region, wide -> the follow view
    // A crossing is the one moment the whole map is on screen, and it is what
    // makes the journey legible -- so it gets time to read. The pull back and
    // the hop are both slower than the push in for that reason.
    pullBack: 1400,   // crossing: the region -> its whole extent
    hop: 2600,        // crossing: between two region pins on the overview
    hopHold: 900,     // and a beat on the whole woods before diving back in
    epilogue: 1600,   // the last pull back out
  };

  /**
   * Begin a camera move. Returns nothing; the tick reads _cam each frame.
   *
   * `map` is the map this phase LOOKS AT, which is not always the map the
   * replay is on -- that separation is the point.
   */
  _camGo(phase, { map, from, to, ms, hop = null }) {
    this._cam = { phase, map, from, to, ms, hop, startedAt: Date.now() };
    this._camMap = map;
  }

  /**
   * The whole-map view of a region, framed as the overview sees it.
   *
   * Used as the far end of a pull back and the near end of a push in, so the
   * two frames match in scale at the moment of the cut and the hard cut reads
   * as continuous motion rather than as an edit.
   */
  _wholeOf() { return { ...WHOLE }; }

  /**
   * The overview view centred on a region's pin, at the scale a region map
   * occupies -- the frame the push-in starts from and the pull-back ends on.
   */
  _overviewViewFor(mapSlug) {
    const pin = overviewPinForMap(mapSlug);
    if (!pin) return { ...WHOLE };
    return centredView(pin.x, pin.y, 34, 34);
  }

  /**
   * Advance the camera. Returns the view to draw, or null when it is idle.
   *
   * Every phase that ends hands straight to the next, so a crossing runs
   * pullBack -> hop -> pushIn -> settle without the tick having to sequence
   * it. While any of this is running the replay's clock is frozen by
   * _cameraDebt, so none of it costs the timeline anything.
   */
  _camTick() {
    const cam = this._cam;
    if (!cam) return null;

    const t = (Date.now() - cam.startedAt) / cam.ms;
    if (t < 1) return lerpView(cam.from, cam.to, t);

    // This phase is done. Bank its wall-clock cost and start the next.
    this._cameraDebt += cam.ms;
    const B = CreditsApp.BEATS;

    switch (cam.phase) {
      case 'holdWide':
        this._camGo('pushIn', {
          map: OVERVIEW,
          from: { ...WHOLE },
          to: this._overviewViewFor(cam.hop.to),
          ms: B.pushIn,
          hop: cam.hop,
        });
        this._prewarm(cam.hop.to);
        return this._camTick();

      case 'pushIn':
        // THE CUT. Matched scale: we leave the overview framing the region at
        // roughly the size the region map now fills, so the swap reads as the
        // same movement continuing rather than as an edit.
        this._camGo('settle', {
          map: cam.hop.to,
          from: { ...WHOLE },
          to: this._followView(cam.hop.to),
          ms: B.settle,
          hop: cam.hop,
        });
        return this._camTick();

      case 'pullBack':
        // Across the WHOLE woods, not between two tight framings. Both pins
        // have to be on screen at once or "they travelled from here to there"
        // is not actually being shown -- and a hop between two 34% frames
        // barely moves, which was the version that read as too fast.
        this._camGo('hop', {
          map: OVERVIEW,
          from: { ...WHOLE },
          to: { ...WHOLE },
          ms: B.hop,
          hop: cam.hop,
        });
        this._prewarm(cam.hop.to);
        return this._camTick();

      case 'hop':
        // A beat on the finished line before diving back in, so the crossing
        // has a moment to land rather than being snatched away the instant
        // the mark arrives.
        this._camGo('hopHold', {
          map: OVERVIEW,
          from: { ...WHOLE },
          to: { ...WHOLE },
          ms: B.hopHold,
          hop: cam.hop,
        });
        return this._camTick();

      case 'hopHold':
        this._camGo('pushIn', {
          map: OVERVIEW,
          from: { ...WHOLE },
          to: this._overviewViewFor(cam.hop.to),
          ms: B.pushIn,
          hop: cam.hop,
        });
        return this._camTick();

      default:
        // settle, epilogue: hand back to the follow.
        this._cam = null;
        this._camMap = cam.map;
        this._camView = { ...cam.to };
        return null;
    }
  }

  /** A first guess at the follow view for a map, before the party has moved. */
  _followView(mapSlug) {
    const c = this._camCentre;
    if (c && this._camMap === mapSlug) return centredView(c.x, c.y, CreditsApp.FOLLOW, CreditsApp.FOLLOW);
    return centredView(50, 50, CreditsApp.FOLLOW, CreditsApp.FOLLOW);
  }

  /**
   * Ease the follow toward a point, framerate-independently.
   *
   * A raw per-frame lerp converges at whatever rate the machine happens to
   * render at, so the same sequence drifts differently on a slow client. The
   * exponential form makes the time constant real.
   */
  _followTo(x, y, dt) {
    if (!this._camCentre) this._camCentre = { x, y };
    const k = 1 - Math.pow(1 - 0.06, Math.max(0, dt) / 16.7);
    this._camCentre.x += (x - this._camCentre.x) * k;
    this._camCentre.y += (y - this._camCentre.y) * k;
    return centredView(this._camCentre.x, this._camCentre.y,
                       CreditsApp.FOLLOW, CreditsApp.FOLLOW);
  }

  /**
   * The dashed line between two regions, drawn on the overview.
   *
   * Painted here rather than in drawRoute because it is not part of the plan:
   * buildPlan emits no steps for it, RouteMapApp must never show it, and it
   * needs its own progress, which has nothing to do with revealSeq.
   *
   * Dashed rather than solid on purpose -- this is a summary of travel, not
   * the surveyed route the solid lines represent.
   */
  _paintOverviewLeg(ctx, { from, to, view, w, h, t }) {
    const a = overviewPinForMap(from);
    const b = overviewPinForMap(to);
    if (!a || !b) return;

    const px = (pct) => ((pct - view.x) / view.w) * w;
    const py = (pct) => ((pct - view.y) / view.h) * h;
    const ax = px(a.x), ay = py(a.y), bx = px(b.x), by = py(b.y);

    ctx.save();
    ctx.strokeStyle = '#f0e6d2';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 8]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    // Drawn only as far as the mark has travelled, so the line grows with it.
    ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t);
    ctx.stroke();
    ctx.setLineDash([]);

    // Both ends, so the departure and the destination read as places.
    ctx.fillStyle = '#f0e6d2';
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // The travelling mark, the same shape the route uses.
    const hx = ax + (bx - ax) * t, hy = ay + (by - ay) * t;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(hx, hy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

    this._timeline = buildTimeline(this._plan);
    const { steps, durations, total } = this._timeline;
    if (!steps.length) return;

    // ── The camera's opening ────────────────────────────────────────────
    //
    // The prologue and everything after it run on the camera's own clock:
    // _cameraDebt grows while it moves, so the replay's elapsed stays pinned
    // at 0 and the timeline is never touched. "Before offset 0" and
    // "a synthetic prologue" turn out to be the same thing.
    this._cameraDebt = 0;
    this._cam = null;
    this._camCentre = null;
    this._camMap = null;
    this._camView = { ...WHOLE };
    // Reset, or a second play skips the closing shot.
    this._epilogueDone = false;

    // The first map the party is actually on. Not steps[0] outright -- that
    // could be a cross, which carries no map.
    const firstMap = steps.find(s => s.map)?.map ?? this._plan.maps[0] ?? null;
    this.mapSlug = firstMap;

    if (this._camera && firstMap && overviewPinForMap(firstMap)) {
      // The overview and the first region are both needed within two seconds,
      // and the opening hold is free time to fetch them in.
      await this._prewarm(OVERVIEW);
      this._camGo('holdWide', {
        map: OVERVIEW,
        from: { ...WHOLE },
        to: { ...WHOLE },
        ms: CreditsApp.BEATS.holdWide,
        hop: { from: null, to: firstMap },
      });
    } else {
      // Camera off, or no overview pin to fly to: open on the region itself.
      this._camMap = firstMap;
      this._camView = { ...WHOLE };
    }

    await this._redraw(0, { view: this._camView, map: this._camMap });

    // Every event's wall-clock moment, computed ONCE. Recomputing per frame
    // would be the whole timeline per tick for no benefit.
    const scheduled = this._events
      .map(e => ({ ...e, at: eventOffset(e.when, this._timeline) }))
      .sort((a, b) => a.at - b.at);

    // ── The undated backlog ─────────────────────────────────────────────
    //
    // Session 1 was played before the travel tool existed, so its rolls sit
    // before the first recorded leg and have nothing to attribute to;
    // imported transgressions carry no game-day at all. Both are genuinely
    // unplaceable -- eventOffset correctly returns 0 for them.
    //
    // But "unplaceable" was being rendered as "all on screen before the line
    // moves", which is a wall of rows nobody can read. Deal them out across
    // the opening instead, in their recorded order, so they arrive as a
    // recap while the camera is still out over the woods.
    const undated = scheduled.filter(e => e.at <= 0);
    if (undated.length > 1) {
      // Finish just before the replay proper starts, so the backlog never
      // competes with the first real event.
      const B = CreditsApp.BEATS;
      const window = this._camera
        ? B.holdWide + B.pushIn + B.settle - 200
        : Math.min(2600, (scheduled.find(e => e.at > 0)?.at ?? 2600) - 100);
      const gap = Math.max(90, window / undated.length);
      // _backlog marks these as running on the wall clock rather than on the
      // replay's frozen `elapsed` -- see the reveal loop.
      undated.forEach((e, i) => { e.at = i * gap; e._backlog = true; });
    }
    scheduled.sort((a, b) => a.at - b.at);
    this._scheduled = scheduled;

    this.playing = true;
    this._setButtons();
    const startedAt = Date.now();

    let lastFrame = Date.now();

    const tick = () => {
      if (!this.playing) return;

      const now = Date.now();
      const dt = now - lastFrame;
      lastFrame = now;

      // ── The camera's clock ────────────────────────────────────────────
      //
      // While the camera is moving, its wall-clock cost goes into
      // _cameraDebt, so the replay's `elapsed` stays exactly where it was.
      // The transition costs the timeline nothing -- which is why
      // buildTimeline, eventOffset and every scheduled offset are untouched
      // by this feature.
      const camView = this._camTick();
      const elapsed = now - startedAt - this._cameraDebt;

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

      // Follow the party onto whichever map they are on now. This is the
      // REPLAY's map -- the camera's is separate, and may be the overview at
      // this very moment.
      const under = steps[Math.min(Math.floor(progress), steps.length - 1)];
      const onMap = under?.map ?? (under?.type === 'cross' ? under.to : null);
      if (onMap && onMap !== this.mapSlug) {
        const leftMap = this.mapSlug;
        this.mapSlug = onMap;
        this._loadImages(onMap);     // fire and forget; next frame draws it

        // A crossing: pull out to the woods, hop between the two regions,
        // push back in. Only when both ends actually have an overview pin --
        // a move between two maps of the same region (into the Ghost Caves,
        // say) resolves to the same pin and is not a journey worth flying.
        const a = overviewPinForMap(leftMap);
        const b = overviewPinForMap(onMap);
        if (this._camera && !this._cam && a && b && a.slug !== b.slug) {
          this._camGo('pullBack', {
            map: leftMap,
            from: this._camView,
            to: { ...WHOLE },
            ms: CreditsApp.BEATS.pullBack,
            hop: { from: leftMap, to: onMap },
          });
          this._prewarm(OVERVIEW);
        }
      }

      // A monotonic cursor, not a filter: revealing is one-way, which is what
      // lets each row animate in exactly once.
      //
      // The backlog is dealt out on WALL CLOCK, not on `elapsed`. The replay
      // clock is frozen at 0 for the whole of the camera's opening (that is
      // what _cameraDebt does), so anything scheduled inside the prologue
      // would otherwise wait for the camera to finish and then arrive all at
      // once -- the very pile-up the spreading is there to prevent.
      const wall = now - startedAt;
      while (this._cursor < scheduled.length) {
        const ev = scheduled[this._cursor];
        const due = ev.at <= 0 || ev._backlog ? wall : elapsed;
        if (ev.at > due) break;
        this._revealEvent(ev);
        this._cursor++;
      }

      // The view: the camera's while it moves, the damped follow otherwise.
      let view = camView;
      let showMap = this._camMap;
      if (!view) {
        showMap = this.mapSlug;
        this._camMap = showMap;
        const head = under && under.x != null ? under : null;
        view = this._camera && head
          ? this._followTo(head.x, head.y, dt)
          : { ...WHOLE };
        this._camView = view;
      }

      this._seq = progress;
      const painted = this._redraw(progress, {
        holdSeq, phase: holdPhase, view, map: showMap,
      });

      // The region-to-region line, drawn over the overview during a hop.
      // _redraw is async, so this waits on the frame it belongs to.
      //
      // It stays up through hopHold and the push-in that follows, at full
      // length -- the line is the whole point of going out there, and having
      // it vanish the moment the mark arrives is what made the crossing feel
      // like it was over before it registered.
      if (this._cam && (this._cam.phase === 'hop' || this._cam.phase === 'hopHold'
                        || (this._cam.phase === 'pushIn' && this._cam.hop?.from
                            && this._cam.hop.from !== this._cam.hop.to))) {
        const cam = this._cam;
        const t = cam.phase === 'hop'
          ? Math.min(1, (now - cam.startedAt) / cam.ms)
          : 1;
        painted?.then?.((p) => {
          if (p) this._paintOverviewLeg(p.ctx, {
            from: cam.hop.from, to: cam.hop.to, view, w: p.w, h: p.h, t,
          });
        });
      }

      if (elapsed >= total) {
        // Anything still pending (an event past the last step) lands now, so
        // the totals always finish complete.
        while (this._cursor < scheduled.length) {
          this._revealEvent(scheduled[this._cursor]);
          this._cursor++;
        }

        // The closing shot: pull back out to the whole woods. Runs on the
        // camera's clock like everything else, so it simply extends the
        // sequence rather than needing anywhere to live on the timeline.
        if (this._camera && !this._epilogueDone && overviewPinForMap(this.mapSlug)) {
          this._epilogueDone = true;
          this._camGo('epilogue', {
            map: OVERVIEW,
            from: this._overviewViewFor(this.mapSlug),
            to: { ...WHOLE },
            ms: CreditsApp.BEATS.epilogue,
            hop: { from: this.mapSlug, to: this.mapSlug },
          });
          this._prewarm(OVERVIEW);
          this._raf = requestAnimationFrame(tick);
          return;
        }

        this.playing = false;
        this._seq = steps.length;
        this._redraw(steps.length, { view: this._camView, map: this._camMap });
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
