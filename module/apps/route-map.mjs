/**
 * The party's route, drawn.
 *
 * Two things come out of this, and deliberately from one function: a static
 * map of where they have been, and an animated replay of getting there.
 * `drawRoute(ctx, plan, t)` renders the journey up to `t` (0..1) -- so `t = 1`
 * is the finished map and sweeping t is the replay. One code path means the
 * replay cannot drift from the map it ends on.
 *
 * ---
 *
 * WHY A CANVAS AND NOT FOUNDRY DRAWINGS
 *
 * A Drawing document is a shape on one scene. Drawing a route with them would
 * mean creating documents on the players' scenes every time the map is
 * regenerated, letting anyone drag them out of place, and -- decisively -- no
 * frame control at all, since animating would be a document update per frame
 * over the socket. Drawings also cannot cross scenes, and this route crosses
 * maps.
 *
 * ---
 *
 * ON SPOILERS. The region maps are FLOWCHARTS: every location is a labelled
 * blob and the secret birdsong paths are drawn in red. Showing one to players
 * reveals the whole region. So the real art is GM-only, and the player-facing
 * view is the sketch -- which draws only what the log says they have visited,
 * at the same coordinates, so it matches the true layout without giving away
 * what is still out there.
 */

import { TravelGroups } from './travel-groups.mjs';
import { TravelHistory } from './travel-history.mjs';

/** Injected by the content module. Empty without it, which means no map. */
export let MAP_DATA = { maps: {}, locationArea: {}, derived: {} };

const SETTING_NAMES = 'partyPlaceNames';
const SETTING_SPEED = 'routeReplaySpeed';

/** Seconds per leg in the replay. The GM's dial on how fast it reads. */
export function replayLegSeconds() {
  try {
    const v = game.settings.get('darkest-system', SETTING_SPEED);
    return typeof v === 'number' && v > 0 ? v : 1.6;
  } catch {
    return 1.6;
  }
}

/**
 * What the PARTY calls a place.
 *
 * The players rarely learn a location's printed name -- they call it "the
 * cabin with the typewriter" or "where Ida died", and that is what belongs on
 * a map they are meant to keep. Stored by slug rather than edited into the
 * log, so renaming a place fixes every mention of it at once, past and
 * future, and the real name is never lost underneath.
 */
export function partyNames() {
  try {
    return game.settings.get('darkest-system', SETTING_NAMES) || {};
  } catch {
    return {};
  }
}

export async function setPartyName(slug, name) {
  if (!game.user.isGM || !slug) return;
  const names = { ...partyNames() };
  const clean = (name || '').trim();
  if (clean) names[slug] = clean;
  else delete names[slug];      // cleared -- fall back to the book's name
  await game.settings.set('darkest-system', SETTING_NAMES, names);
}

export function registerRouteMapSettings() {
  game.settings.register('darkest-system', SETTING_SPEED, {
    name: 'Route replay speed',
    hint: 'Seconds the replay spends drawing each leg. Higher is slower and more readable; a long campaign at 3s a leg runs several minutes. Stays hold for longer than a leg, but never proportionally — a week somewhere is not thirty times a night.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0.4, max: 6, step: 0.2 },
    default: 1.6,
  });

  game.settings.register('darkest-system', SETTING_NAMES, {
    name: 'Party place names',
    hint: 'Internal: what the players call each place.',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });
}

Hooks.once('darkestSystem.registerMapData', (data) => {
  if (data?.maps) MAP_DATA = data;
});

/**
 * How long the replay pauses on a stay, in ms.
 *
 * Logarithmic and capped, NOT proportional. A night's sleep should read as a
 * night, but eight hours and two days must not differ by six times the screen
 * time -- the replay is a credits sequence, and sitting on an imprisonment
 * for half a minute kills it. This gives 0.56s for a quarter hour, 1.8s for a
 * night, 2.6s for two days, and never more however long they were held.
 */
export function stayPause(minutes) {
  const MIN = 250, MAX = 2600, CAP = 2880;   // cap at two days
  const m = Math.max(0, minutes || 0);
  const t = Math.min(1, Math.log10(1 + m / 15) / Math.log10(1 + CAP / 15));
  return Math.round(MIN + (MAX - MIN) * t);
}

/** Which stay flourish to play, if any. */
export function stayKind(minutes) {
  if ((minutes || 0) >= 480) return 'sleep';   // a night or more
  if ((minutes || 0) >= 60) return 'pause';    // long enough to notice
  return null;
}

/**
 * The journey as a schedule: what plays, for how long, and starting when.
 *
 * Extracted from RouteMapApp.play() so the replay and the credits sequence
 * share ONE timing contract. Two windows each deciding how long a stay lasts
 * would drift apart the first time either was tuned, and the credits panels
 * need `offsets` anyway to place an event on the timeline.
 *
 * `steps` is the whole plan in MERGED order -- across maps and across groups,
 * so steps[i] is the step whose seq is i. Two things depend on that: the
 * replay follows the party between maps instead of losing them at the
 * boundary, and two groups' legs interleave by game time rather than one
 * group waiting for the other to finish.
 *
 * @returns {{steps: object[], durations: number[], offsets: number[], total: number}}
 *   `offsets[i]` is when step i STARTS, in ms from the beginning; `total` is
 *   the length of the whole sequence.
 */
export function buildTimeline(plan) {
  const steps = (plan?.groups ?? [])
    .flatMap(g => g.steps)
    .sort((a, b) => a.seq - b.seq);

  // From the setting: how long the line takes to cross one leg. The default
  // reads at a walking pace; a GM showing this as a credits scene will want
  // it slower than one checking a route.
  const LEG = replayLegSeconds() * 1000;
  const CUT = 700;    // a beat on the new map before the line resumes
  const durations = steps.map(s =>
    s.type === 'stay' ? stayPause(s.minutes)
    : s.type === 'cross' ? CUT
    : s.type === 'break' ? 0
    : LEG
  );

  const offsets = [];
  let acc = 0;
  for (const d of durations) { offsets.push(acc); acc += d; }

  return { steps, durations, offsets, total: acc };
}

export const RouteMap = {

  available() {
    return Object.keys(MAP_DATA.maps || {}).length > 0;
  },

  /**
   * Does `outer` contain `inner`, following the area nesting?
   *
   * True when they are the same area, or when `outer` is an ancestor of
   * `inner` -- The Lost contains the Ghost Caves, the overview contains The
   * Lost. Walks the chain rather than checking one hop up, because the nesting
   * is three deep and a Ghost Caves room seen while the overview is drawn is
   * the same situation one level further out.
   *
   * The loop guard is not paranoia about the data (areas.json is a clean tree)
   * but about a future content update introducing a cycle: that would hang
   * Foundry on render with no clue why.
   */
  _contains(outer, inner) {
    if (!outer || !inner) return false;
    const parents = MAP_DATA.areaParents || {};
    let cur = inner;
    for (let hops = 0; cur && hops < 10; hops++) {
      if (cur === outer) return true;
      cur = parents[cur];
    }
    return false;
  },

  /**
   * Where a slug sits, and on which map.
   *
   * `prefer` keeps a run on the map it started on: 41 locations are pinned on
   * more than one map, and hopping between them mid-run would tear the line
   * apart for no reason.
   */
  resolvePin(slug, prefer = null) {
    if (!slug) return null;
    const maps = MAP_DATA.maps || {};

    const on = (mapSlug) => {
      const m = maps[mapSlug];
      const pin = m?.pins?.[slug];
      return pin ? { map: mapSlug, x: pin.x, y: pin.y, kind: pin.kind } : null;
    };

    // STAY ON THE MAP WE ARE ALREADY DRAWING -- but only OUTWARDS.
    //
    // The region maps draw their interiors as a bounded inset -- the Ghost
    // Caves are a box down the left of The Lost, with all four rooms in it --
    // and that reads better than cutting away to a separate screen for four
    // rooms. So a run inside the caves stays on The Lost when The Lost is
    // already up.
    //
    // The inverse is not true, and used to happen. The Ghost Caves map also
    // pins glorys-cabin and the-abandoned-campsite (they are the ways out), so
    // a journey whose FIRST point was a cave room left `prefer` set to the
    // cave map, and every later leg across The Lost was then drawn on the
    // caves -- a whole region's travel squeezed into an inset. Preferring a
    // map only when it CONTAINS the location (it is the home area, or an
    // ancestor of it) keeps the approved inset behaviour and drops that.
    //
    // Not every sub-area is pinned in full on its parent: the Ghost Caves and
    // A Town Called Dismal are, the Rootrealm only partly, and the Temple of
    // the Moon not at all. Those fall through to their own map and the replay
    // cuts to it -- which is why the crossing machinery still exists.
    const home = MAP_DATA.locationArea?.[slug];
    const hit = (RouteMap._contains(prefer, home) && on(prefer))
      || (home && on(home))
      || Object.keys(maps).map(on).find(Boolean);
    if (hit) return hit;

    // No pin anywhere: a build-time position derived from its neighbours.
    const d = MAP_DATA.derived?.[slug];
    if (d) return { map: d.map, x: d.x, y: d.y, kind: 'location', approximate: true };
    return null;
  },

  /**
   * Turn the log into something drawable.
   *
   * Split by GROUP first, then chain. Merged, two parties walking different
   * paths on the same day produce a line that zig-zags between them -- a
   * journey nobody made. Each group becomes its own polyline in its own
   * colour.
   *
   * Returns { maps: [...], groups: [{ id, name, colour, steps }] } where a
   * step is a point, a stay, or a break.
   */
  buildPlan({ moves = null } = {}) {
    const all = moves ?? TravelHistory.moves();
    const byGroup = new Map();
    const firstGroup = TravelGroups.all()[0]?.id ?? 'party';

    for (const m of all) {
      // Legs from before groups existed belong to the first group -- at the
      // time, there was only one.
      const key = m.groupId ?? firstGroup;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(m);
    }

    const usedMaps = new Set();
    const groups = [];

    for (const [groupId, legs] of byGroup) {
      const steps = [];
      let previousEnd = null;      // slug the group was last at
      let currentMap = null;       // keeps a run on one map
      let lastPlaced = null;       // for stays that can't place themselves

      const names = partyNames();
      const place = (slug, rawTitle) => {
        const pin = RouteMap.resolvePin(slug, currentMap);
        if (!pin) return null;
        // What the party calls it wins over the book's name.
        const title = names[slug] || rawTitle;
        // Crossing onto another map -- into the Ghost Caves, out to another
        // region. Marked so the line stops here rather than shooting across
        // to a point that isn't on this map at all, and so the replay can
        // cut between maps at the right moment.
        const crossed = currentMap && pin.map !== currentMap ? currentMap : null;
        currentMap = pin.map;
        usedMaps.add(pin.map);
        return { ...pin, slug, title, crossedFrom: crossed };
      };

      for (const leg of legs) {
        // When this leg happened, in whole minutes of game time. Carried on
        // every step so the finished plan can be sequenced across groups --
        // see the merge below. Departure where known, arrival otherwise;
        // undated legs get null and hold their recorded order.
        const when = RouteMap._legTime(leg);

        // A stay: no line, a ring on the pin. Its slug can be null when time
        // was skipped on a scene with no location (an area map, the
        // travelling scene), in which case it belongs where the group last
        // was -- they were somewhere before the clock moved.
        if (leg.stay) {
          const at = leg.toSlug
            ? place(leg.toSlug, leg.toTitle)
            : (lastPlaced ? { ...lastPlaced, assumed: true } : null);
          if (at) {
            steps.push({ type: 'stay', ...at, minutes: leg.minutes || 0, day: leg.day, when });
            lastPlaced = at;
          }
          continue;
        }

        // A break: this leg starts somewhere the group was not. Drawn as a
        // break rather than a line, or the map invents a journey.
        if (previousEnd && leg.fromSlug && leg.fromSlug !== previousEnd) {
          steps.push({ type: 'break', from: previousEnd, to: leg.fromSlug, when });
          currentMap = null;
        }

        if (!steps.length || steps[steps.length - 1]?.type === 'break') {
          const start = place(leg.fromSlug, leg.fromTitle);
          if (start) { steps.push({ type: 'point', ...start, day: leg.departDay ?? leg.day, when }); lastPlaced = start; }
        }

        const end = place(leg.toSlug, leg.toTitle);
        if (end?.crossedFrom) {
          // Walking onto another map -- into the Ghost Caves, out to another
          // region. Rather than the line simply stopping, draw the party
          // ARRIVING at the crossing point on the map they are leaving, so
          // you watch them reach the cave mouth before the view follows them
          // inside.
          //
          // The crossing point is usually pinned on BOTH maps (the Cave
          // Mouth is on The Lost and on the Ghost Caves), which is what
          // makes the hand-off drawable from either side.
          const doorOut = MAP_DATA.maps?.[end.crossedFrom]?.pins?.[end.slug];
          if (doorOut) {
            steps.push({
              type: 'point', map: end.crossedFrom,
              x: doorOut.x, y: doorOut.y,
              slug: end.slug, title: end.title, doorway: true,
              day: leg.day, minutes: leg.minutes || 0, when,
            });
          }
          steps.push({ type: 'cross', from: end.crossedFrom, to: end.map, at: end.slug, title: end.title, when });
        }
        if (end) {
          // Don't repeat a point the line is already sitting on. A leg that
          // ends where the previous one did (a there-and-back within one
          // leg, or a duplicate row) would otherwise add a zero-length
          // segment that draws as a blob.
          const last = steps[steps.length - 1];
          if (!(last?.type === 'point' && last.slug === end.slug)) {
            steps.push({
              type: 'point', ...end, day: leg.day,
              minutes: leg.minutes || 0, label: leg.label || '', when,
            });
          }
          lastPlaced = end;
        }
        if (leg.toSlug) previousEnd = leg.toSlug;
      }

      if (steps.length) {
        groups.push({
          id: groupId,
          name: TravelGroups.nameOf(groupId === firstGroup ? null : groupId) || TravelGroups.nameOf(groupId),
          colour: TravelGroups.colourOf(groupId),
          steps,
        });
      }
    }

    // ── One playhead across every group ──────────────────────────────────
    //
    // Number every step in a single merged ordering by game time. Two things
    // depend on this and both were broken without it:
    //
    //  - The replay reveals by sequence, not by counting into a per-map
    //    list. Counting broke the moment a journey crossed maps, because the
    //    count was global while the list was filtered -- so the second map
    //    arrived fully drawn.
    //  - Groups interleave. Drawing them one after another made a split
    //    party look like one group waiting for the other to finish.
    //
    // Stable sort, so steps of the same leg (and undated legs, which compare
    // equal) keep the order they were built in.
    const order = groups.flatMap(g => g.steps);
    order
      .map((step, i) => ({ step, i }))
      .sort((a, b) => {
        const aw = a.step.when, bw = b.step.when;
        if (aw == null || bw == null) return a.i - b.i;
        return (aw - bw) || (a.i - b.i);
      })
      .forEach((entry, seq) => { entry.step.seq = seq; });

    return { groups, maps: [...usedMaps], totalSteps: order.length };
  },

  /**
   * When a leg happened, in minutes of game time, or null if it is undated.
   *
   * Departure where recorded, arrival otherwise -- the same precedence
   * SessionLog._chronological uses, so the map and the log can never disagree
   * about what order things happened in.
   */
  _legTime(leg) {
    const day = leg.departDay ?? leg.day;
    if (day == null) return null;
    const raw = String(leg.departTime ?? leg.time ?? '');
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    // Fixed-time regions store a phase label ("Endless Night") rather than a
    // clock reading; those sort by day alone, which is the honest answer.
    const mins = m ? (Number(m[1]) * 60) + Number(m[2]) : 0;
    return (day * 1440) + mins;
  },
};

/* ----------------------------------------
   Drawing
---------------------------------------- */

/**
 * A deterministic wobble, so the sketch style looks hand-drawn without
 * changing between renders.
 *
 * Seeded from the slug rather than random: an exported image and the replay
 * that follows it must agree, and a line that squirmed on every redraw would
 * read as a glitch rather than as ink.
 */
function wobble(seed, i) {
  let h = 0;
  const s = `${seed}:${i}`;
  for (let n = 0; n < s.length; n++) h = ((h << 5) - h + s.charCodeAt(n)) | 0;
  return ((h % 1000) / 1000 - 0.5) * 2;   // -1..1
}

/**
 * The map behind the route: aged paper, or the real art knocked back.
 *
 * Separated out so the replay can paint it once to an offscreen canvas and
 * blit it each frame -- 260 speckle rects or a full-size image per frame is
 * the bulk of the drawing cost, and none of it changes while the line moves.
 */
export function paintBackdrop(ctx, { width, height, style = 'sketch', image = null, dim = 0.35 } = {}) {
  if (style === 'real' && image) {
    ctx.drawImage(image, 0, 0, width, height);
    // Knock the art back so the route reads over it.
    //
    // `dim` is a parameter because the two consumers want different things.
    // The route map is ABOUT the line, so the art is context and 0.35 keeps
    // the line legible over it. The credits show the map as the main event on
    // a large screen, where 0.35 visibly greys the book's colours -- the reds
    // and greens go flat -- so it passes a much lighter value. Zero skips the
    // wash entirely.
    if (dim > 0) {
      ctx.fillStyle = `rgba(10, 8, 6, ${dim})`;
      ctx.fillRect(0, 0, width, height);
    }
    return;
  }
  // Sketch: aged paper, nothing of the real map at all. This is the
  // player-facing view precisely because the real art names every location
  // they haven't found yet.
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#e8dfc8');
  g.addColorStop(1, '#d6c9aa');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(120, 90, 50, 0.06)';
  for (let i = 0; i < 260; i++) {
    const x = ((i * 7919) % 1000) / 1000 * width;
    const y = ((i * 104729) % 1000) / 1000 * height;
    ctx.fillRect(x, y, 2, 2);
  }
}

/**
 * Draw a route plan onto a 2D context.
 *
 * `revealSeq` is the playhead: a position in the plan's single merged
 * ordering (see buildPlan). A step draws when its `seq` is behind the
 * playhead, wherever it sits and whichever group walked it.
 *
 * This has to be a SEQUENCE and not a fraction-of-this-map's-steps. The old
 * version counted a global budget down against a per-map list, so the instant
 * a journey crossed onto a second map the whole of that map's route was
 * already "paid for" and appeared at once. Sequencing also gets group
 * concurrency for free: two groups' steps interleave in the merged order, so
 * both lines advance together instead of one waiting for the other.
 *
 * Omit `revealSeq` for the finished map.
 *
 * `holdSeq`/`phase` name the stay the replay is currently paused on and how
 * far through that pause it is (0..1). They drive the stay flourishes. A still
 * render passes neither, so every ring draws at rest and an exported map never
 * depends on frame timing.
 */
export function drawRoute(ctx, plan, {
  revealSeq = Infinity, width, height, style = 'sketch', mapSlug = null,
  images = {}, backdrop = null, holdSeq = null, phase = 0,
  view = null, mapDim = 0.35,
} = {}) {
  ctx.clearRect(0, 0, width, height);

  const map = MAP_DATA.maps?.[mapSlug];

  // THE CAMERA. `view` is a rectangle in the same percentage space the pins
  // already live in -- {x, y, w, h}, 0..100 of the map's own dimensions --
  // and null means the whole map, which is what every caller but the credits
  // sequence passes.
  //
  // Applied by REPLACING these two helpers rather than by transforming the
  // context, and that is deliberate. Every coordinate in this function goes
  // through px/py -- the line, the pins, the stay rings, the labels -- so
  // this is the single choke point. A ctx.scale() would also multiply every
  // SCREEN-space size: the line width, the pin radii, the stay ring (whose
  // radius encodes how long they stayed), the travelling mark, the label
  // font, the wobble. Eight sites to compensate, in a function whose whole
  // premise is that there is one path.
  //
  // It also simply looks better. A line that holds its weight while the
  // terrain grows underneath reads as a camera pushing in; a line that
  // thickens reads as an image being magnified.
  const vx = view?.x ?? 0, vy = view?.y ?? 0;
  const vw = view?.w ?? 100, vh = view?.h ?? 100;
  const px = (pct) => ((pct - vx) / vw) * width;
  const py = (pct) => ((pct - vy) / vh) * height;

  // ── Backdrop ───────────────────────────────────────────────────────────
  // Pre-painted by the caller when there is one to reuse (the replay paints
  // it once); drawn straight in otherwise, for one-off renders and exports.
  //
  // The cached backdrop is always the WHOLE map, so the camera crops it here
  // with a source rectangle rather than repainting. That is why the cache key
  // must not include the view: zooming never invalidates it.
  if (backdrop) {
    const sx = (vx / 100) * backdrop.width;
    const sy = (vy / 100) * backdrop.height;
    const sw = (vw / 100) * backdrop.width;
    const sh = (vh / 100) * backdrop.height;
    ctx.drawImage(backdrop, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    // One-off renders and exports never zoom, so paintBackdrop is untouched.
    paintBackdrop(ctx, { width, height, style, image: images[mapSlug], dim: mapDim });
  }

  const ink = style === 'real' ? '#f0e6d2' : '#3a3026';
  const dim = style === 'real' ? 'rgba(240,230,210,0.55)' : 'rgba(58,48,38,0.5)';

  // The playhead, split into the step under it and how far into that step we
  // are. The fraction is what lets the final segment be drawn part-way, so
  // the line CREEPS rather than snapping from pin to pin.
  const headSeq = Math.floor(revealSeq);
  const partial = Number.isFinite(revealSeq) ? revealSeq - headSeq : 0;

  for (const group of plan.groups) {
    // Only this map's steps are drawn, but they keep their global `seq`, so
    // "has the playhead reached this?" stays a question about the whole
    // journey rather than about this map's slice of it.
    //
    // A `cross` carries no `map` of its own, and `!s.map` used to let it
    // through onto EVERY map. That is what made the line flash complete at
    // each map change: on the destination map the filtered list began with
    // the leaked cross, so `show` was already non-zero the moment the map
    // swapped, while `headIsHere` stayed false until the playhead reached
    // one of this map's own steps. The first leg therefore drew at FULL
    // length, vanished as the playhead caught up, and then animated.
    //
    // A crossing belongs to the map being LEFT -- that is where you watch
    // the party reach the doorway -- so it is matched on `from`.
    //
    // A `break` carries slugs rather than a map, so it cannot be filtered by
    // map -- and it must NOT be dropped, or the line would join two points
    // the party never walked between, which is the whole reason it exists.
    // It is handled below instead, where `show` is counted.
    const steps = group.steps.filter(s =>
      s.type === 'cross' ? s.from === mapSlug
      : (!s.map || s.map === mapSlug));
    if (!steps.length) continue;

    // Steps whose sequence is behind the playhead. `show` is an index into
    // the FILTERED list; seq is the position in the merged order.
    let show = 0;
    while (show < steps.length && steps[show].seq <= headSeq) show++;
    if (show <= 0) continue;

    // Nothing is drawn on a map the playhead has not actually entered.
    //
    // `show` counts separators too -- a `break` has no map and rides along on
    // every one -- so on the frame a map change lands, a map whose own first
    // point is still ahead could already have show > 0. Its first leg then
    // drew at FULL length with no head on it, vanished as the playhead caught
    // up, and animated properly the second time. That is the flash at every
    // map change, and at Glory's Cabin in particular, where the boundary
    // between two sessions is a break.
    //
    // The honest test is whether any step BELONGING to this map is behind the
    // playhead. Separators are not drawable content and must not vote.
    const ownReached = steps.some(s =>
      s.seq <= headSeq && s.type !== 'break' && s.type !== 'cross');
    if (!ownReached) continue;

    // The head is only live when the step under the playhead is one of ours,
    // on this map -- otherwise another group (or another map) has it and our
    // line simply rests at its last pin.
    const headIsHere = partial > 0 && steps[show - 1]?.seq === headSeq;

    ctx.strokeStyle = group.colour;
    ctx.lineWidth = style === 'real' ? 3 : 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ── The line ─────────────────────────────────────────────────────────
    let drawing = false;
    let head = null;   // where the line has got to, for the travelling mark
    ctx.beginPath();
    for (let i = 0; i < show; i++) {
      const s = steps[i];
      if (s.type === 'break' || s.type === 'cross') {
        // A break is a missing leg; a cross is the party walking onto
        // another map. Either way the line STOPS -- joining across it would
        // draw a journey nobody made, or a line to a point that isn't on
        // this map.
        ctx.stroke();
        ctx.beginPath();
        drawing = false;
        continue;
      }
      if (s.type !== 'point' && s.type !== 'stay') continue;

      const w = style === 'sketch' ? 3 : 0;
      let x = px(s.x) + wobble(s.slug ?? 'x', i) * w;
      let y = py(s.y) + wobble(s.slug ?? 'y', i + 99) * w;

      // The head of the line: draw only part-way into the final segment, so
      // it advances smoothly rather than snapping to the next pin.
      const isHead = (i === show - 1) && headIsHere && drawing;
      if (isHead) {
        const prev = steps[i - 1];
        if (prev && (prev.type === 'point' || prev.type === 'stay')) {
          const pxr = px(prev.x) + wobble(prev.slug ?? 'x', i - 1) * w;
          const pyr = py(prev.y) + wobble(prev.slug ?? 'y', i + 98) * w;
          x = pxr + (x - pxr) * partial;
          y = pyr + (y - pyr) * partial;
        }
      }

      if (!drawing) { ctx.moveTo(x, y); drawing = true; }
      else ctx.lineTo(x, y);
      if (isHead) { head = { x, y, colour: group.colour }; }
    }
    ctx.stroke();

    // ── Pins, stays and labels ───────────────────────────────────────────
    // The final pin only appears once the line has actually reached it, so
    // the destination isn't revealed before they get there.
    const pinsToShow = headIsHere ? show - 1 : show;
    for (let i = 0; i < pinsToShow; i++) {
      const s = steps[i];
      if (s.type === 'break' || s.type === 'cross') continue;
      const x = px(s.x);
      const y = py(s.y);

      // A stay: a ring sized by how long they were there. Two days at the
      // Dark Lodge is a heavy mark; a fifteen-minute pause barely shows.
      if (s.type === 'stay') {
        let r = 7 + Math.min(14, Math.log10(1 + (s.minutes || 0) / 15) * 7);
        let alpha = 0.55;

        // The flourish, while the playhead is actually sitting on this stay.
        // A night's sleep BREATHES -- two slow cycles across the pause, so it
        // reads as time passing rather than as the replay having stalled. An
        // hour or two gets a single quiet pulse that settles. Anything shorter
        // gets nothing: every fifteen-minute search would otherwise throb, and
        // the point is to distinguish sleeping from waiting, not to decorate.
        //
        // Size and opacity both move, because on the real map the ring sits
        // over busy art where a size change alone is easy to miss.
        const kind = holdSeq != null && s.seq === holdSeq ? stayKind(s.minutes) : null;
        if (kind === 'sleep') {
          const breath = Math.sin(phase * Math.PI * 4);
          r *= 1 + breath * 0.13;
          alpha += breath * 0.2;
        } else if (kind === 'pause') {
          // One half-sine: swells and returns, rather than ending mid-throb.
          const pulse = Math.sin(Math.min(1, phase * 1.6) * Math.PI);
          r *= 1 + pulse * 0.1;
          alpha += pulse * 0.18;
        }

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = group.colour;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Bigger on the sketch: it is the only thing on an empty field, so a
      // small dot reads as a speck. On the real map the art is already busy,
      // so the marker stays modest.
      const r = style === 'sketch'
        ? (i === pinsToShow - 1 ? 9 : 7)
        : (i === pinsToShow - 1 ? 5.5 : 4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      // An approximate position (no pin in the source) is hollow, so it is
      // never mistaken for a surveyed one.
      if (s.approximate) {
        ctx.strokeStyle = group.colour;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = group.colour;
        ctx.fill();
        if (style === 'sketch') {
          // A rim in the paper colour lifts the pin off the field and stops
          // an overlapping line reading as part of the marker.
          ctx.strokeStyle = 'rgba(232, 223, 200, 0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Labels ONLY on the sketch. The real map already prints every name --
      // a second one on top is just noise over the art.
      if (s.title && style === 'sketch') {
        ctx.font = `${i === pinsToShow - 1 ? 'bold ' : ''}13px "Signika", sans-serif`;
        ctx.fillStyle = i === pinsToShow - 1 ? ink : dim;
        ctx.textAlign = 'center';
        ctx.fillText(s.title, x, y - r - 5);
      }
    }

    // The travelling mark -- the thing the eye follows while it moves.
    if (head) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = head.colour;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x, head.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = head.colour;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ── Legend, only when it means something ───────────────────────────────
  if (plan.groups.length > 1) {
    ctx.textAlign = 'left';
    ctx.font = '12px "Signika", sans-serif';
    let ly = height - 12 - (plan.groups.length - 1) * 16;
    for (const g of plan.groups) {
      ctx.fillStyle = g.colour;
      ctx.fillRect(12, ly - 8, 10, 10);
      ctx.fillStyle = ink;
      ctx.fillText(g.name, 28, ly + 1);
      ly += 16;
    }
  }

  if (map?.title) {
    ctx.textAlign = 'right';
    ctx.font = '13px "Signika", sans-serif';
    ctx.fillStyle = dim;
    ctx.fillText(map.title, width - 12, 20);
  }
}

/* ----------------------------------------
   The window
---------------------------------------- */

export class RouteMapApp extends Application {

  constructor(options = {}) {
    super(options);
    this.style = 'sketch';
    this.mapSlug = null;
    this.playing = false;
    // The playhead, in merged-sequence space. Infinity draws the finished
    // map, which is what a freshly opened window should show.
    //
    // It must be wound back to 0 before a replay starts -- see play(). A
    // finished playhead surviving into a run is what painted the whole route
    // complete, then wiped it on the first tick.
    this._seq = Infinity;
    this._paintSeq = 0;         // paint ticket; see _redraw
    this._images = {};
    this._raf = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'darkest-route-map',
      title: 'The Party\u2019s Route',
      template: 'systems/darkest-system/templates/apps/route-map.hbs',
      classes: ['darkest-system', 'route-map'],
      width: 900,
      height: 780,
      resizable: true,
    });
  }

  getData() {
    // A plan that arrived over the socket wins over rebuilding one: this
    // window is replaying what the GM sent, and a locally-built plan could
    // differ (a mid-write log, different party place-names) which would put
    // the clients quietly out of step.
    const plan = this._injectedPlan ?? RouteMap.buildPlan();
    // Default to the map the party has spent the most steps on -- almost
    // always where they are.
    if (!this.mapSlug || !plan.maps.includes(this.mapSlug)) {
      const tally = {};
      for (const g of plan.groups) for (const s of g.steps) if (s.map) tally[s.map] = (tally[s.map] || 0) + 1;
      this.mapSlug = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? plan.maps[0] ?? null;
    }
    this._plan = plan;

    return {
      available: RouteMap.available(),
      hasRoute: plan.groups.length > 0,
      isGM: game.user.isGM,
      style: this.style,
      playing: this.playing,
      maps: plan.maps.map(slug => ({
        slug,
        title: MAP_DATA.maps[slug]?.title ?? slug,
        active: slug === this.mapSlug,
      })),
      groups: plan.groups.map(g => ({ name: g.name, colour: g.colour, steps: g.steps.length })),
      speeds: [
        { value: 0.8, label: 'Brisk' },
        { value: 1.6, label: 'Walking' },
        { value: 2.6, label: 'Slow' },
        { value: 4, label: 'Credits' },
      ].map(o => ({ ...o, active: Math.abs(o.value - replayLegSeconds()) < 0.01 })),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._canvas = html.find('canvas.route-canvas')[0];

    // Only paint the opening frame when NOT already playing.
    //
    // This method runs on every re-render, and _redraw is async: a re-render
    // landing mid-replay would issue a paint at whatever _seq held and drop
    // it on top of the running animation. Worse, playShared() renders the
    // window and only starts play() 400ms later, so this call painted the
    // FINISHED route (_seq is Infinity until play winds it back) and the
    // first ticks then wiped it -- the "draws complete, vanishes, then
    // animates" flash. The credits window guards the same call for the same
    // reason; this is its sibling and was missed.
    if (this._canvas && !this.playing) this._redraw();

    html.find('[name="mapSlug"]').on('change', (ev) => {
      this.mapSlug = ev.currentTarget.value;
      this._redraw();
    });

    html.find('[name="speed"]').on('change', async (ev) => {
      await game.settings.set('darkest-system', SETTING_SPEED, Number(ev.currentTarget.value));
    });

    html.find('[name="style"]').on('change', (ev) => {
      this.style = ev.currentTarget.value;
      this._redraw();
    });

    // Click a pin to rename it. The players almost never learn a place's
    // printed name -- they call it "the cabin with the typewriter" -- and
    // that is what belongs on a map they keep.
    if (this._canvas) {
      this._canvas.addEventListener('click', (ev) => this._onCanvasClick(ev));
      this._canvas.style.cursor = game.user.isGM ? 'pointer' : 'default';
    }

    html.find('.route-play').click(() => this.play());
    html.find('.route-stop').click(() => this.stop());
    html.find('.route-share').click(() => this.share());
    html.find('.route-broadcast').click(() => this.broadcast());
  }

  /** Rename whatever pin was clicked. */
  async _onCanvasClick(ev) {
    if (!game.user.isGM || !this._plan || this.playing) return;
    const rect = this._canvas.getBoundingClientRect();
    const scale = this._canvas.width / rect.width;
    const cx = (ev.clientX - rect.left) * scale;
    const cy = (ev.clientY - rect.top) * scale;

    // Nearest pin on this map, within reach of the click.
    let best = null;
    for (const g of this._plan.groups) {
      for (const s of g.steps) {
        if (s.map !== this.mapSlug || !s.slug) continue;
        const dx = (s.x / 100) * this._canvas.width - cx;
        const dy = (s.y / 100) * this._canvas.height - cy;
        const d = Math.hypot(dx, dy);
        if (d < 18 && (!best || d < best.d)) best = { d, step: s };
      }
    }
    if (!best) return;

    const slug = best.step.slug;
    const current = partyNames()[slug] ?? '';
    const content = `<form class="darkest-dialog">
      <p class="notes">What do the players call this place? Leave it empty to
      use the book's name.</p>
      <div class="form-group">
        <label>${best.step.title}</label>
        <input type="text" name="partyName" value="${foundry.utils.escapeHTML?.(current) ?? current}"
               placeholder="e.g. where Ida died" />
      </div>
    </form>`;

    new Dialog({
      title: 'What the party calls it',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Save',
          callback: async (html) => {
            await setPartyName(slug, html.find('[name="partyName"]').val());
            this.render(false);
            this._plan = RouteMap.buildPlan();
            this._redraw();
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'save',
    }, { width: 380 }).render(true);
  }

  /** Load any map art the real style needs, once. */
  async _loadImages() {
    if (this.style !== 'real') return;
    const src = MAP_DATA.maps?.[this.mapSlug]?.image;
    if (!src || this._images[this.mapSlug]) return;
    await new Promise((resolve) => {
      const img = new Image();
      // Same origin, but declared so toBlob() can't taint on an odd setup.
      img.crossOrigin = 'anonymous';
      img.onload = () => { this._images[this.mapSlug] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  async _redraw(revealSeq = this._seq, { holdSeq = null, phase = 0 } = {}) {
    if (!this._canvas || !this._plan) return;

    // Frames must land in the order they were issued.
    //
    // This is async, so two overlapping calls can resolve out of order and an
    // older frame can paint over a newer one. Stamp each paint and drop any
    // that has been overtaken. Dormant while style is 'sketch' -- the await
    // below returns immediately then, which is every path RouteMapApp
    // currently uses -- but the guard keeps this file's contract identical to
    // the credits window's, so switching to 'real' art cannot quietly
    // reintroduce the flash that guard was added there to fix.
    const ticket = ++this._paintSeq;
    await this._loadImages();
    if (ticket !== this._paintSeq) return;   // overtaken; the newer frame won

    const ctx = this._canvas.getContext('2d');
    const map = MAP_DATA.maps?.[this.mapSlug];

    // Reading clientWidth forces a layout, so it is measured once per resize
    // rather than once per frame -- at 60fps during a replay that is the
    // single most expensive thing in the loop.
    if (!this._w || this._w !== (this._canvas.clientWidth || 860)) {
      this._w = this._canvas.clientWidth || 860;
    }
    const w = this._w;
    const ratio = map ? (map.height / map.width) : 0.75;
    const h = Math.round(w * ratio);
    // Assigning width/height also CLEARS the canvas, so only do it when the
    // size actually changed; otherwise it is a needless full-buffer reset
    // every frame.
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }

    drawRoute(ctx, this._plan, {
      revealSeq, width: w, height: h, style: this.style,
      mapSlug: this.mapSlug, images: this._images,
      backdrop: this._backdrop(w, h),
      holdSeq, phase,
    });
  }

  /**
   * The map behind the route, painted once and reused.
   *
   * The sketch backdrop is a gradient plus 260 speckles and the real one is a
   * full image plus a scrim -- repainting either every frame is pure waste,
   * since neither changes while the line advances. Keyed on everything that
   * can change it, so a style or map switch simply misses the cache.
   */
  _backdrop(w, h) {
    const key = `${this.style}:${this.mapSlug}:${w}x${h}`;
    if (this._backdropKey === key && this._backdropCanvas) return this._backdropCanvas;

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    paintBackdrop(off.getContext('2d'), {
      width: w, height: h, style: this.style,
      image: this._images[this.mapSlug],
    });
    this._backdropKey = key;
    this._backdropCanvas = off;
    return off;
  }

  /**
   * The credits scene.
   *
   * Steps advance on a wall clock rather than per frame, so the pacing is the
   * same on a slow machine as a fast one -- and a stay holds the frame for
   * stayPause(), which is logarithmic so a week doesn't stall the film.
   */
  async play({ startedAt = Date.now() } = {}) {
    this.stop();
    this.playing = true;

    // Wind the playhead back BEFORE the first frame, and paint it empty.
    //
    // _seq starts at Infinity (a freshly opened window shows the finished
    // map) and survives a previous run, so without this the whole route was
    // already on screen when the replay began -- it then vanished on the
    // first tick and animated from nothing. Setting it here, synchronously,
    // is what matters: _redraw is async, so leaving it to the tick lets the
    // stale paint win the race.
    this._seq = 0;
    this._redraw(0);

    const { steps, durations, total } = buildTimeline(this._plan);
    if (!steps.length) return;

    const tick = () => {
      if (!this.playing) return;
      const elapsed = Date.now() - startedAt;

      // Fractional progress: how far INTO the current step we are, not just
      // how many are done. That fraction is what lets the line creep along
      // the segment instead of snapping from pin to pin.
      //
      // A stay's slice is spent standing still, so the line holds at its pin
      // while the ring is on screen -- the pause reads as time passing
      // rather than as the animation stalling.
      let acc = 0, progress = 0;
      // The stay currently being held on, and how far through the hold we
      // are. Tracked separately from `progress` because a stay deliberately
      // advances the playhead to i+1 (the line rests AT the pin, so the pin
      // must count as reached) -- which means the stay is never the step the
      // reveal logic calls the head, and the flourish cannot be keyed on it.
      let holdSeq = null, holdPhase = 0;
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

      // Follow the party onto whichever map they are on now. With a merged
      // playhead this is simply the map of the step under it -- no scanning
      // for the last crossing, which also means a gap that changes maps
      // (and so emits no 'cross') is followed correctly.
      const under = steps[Math.min(Math.floor(progress), steps.length - 1)];
      const onMap = under?.map ?? (under?.type === 'cross' ? under.to : null);
      if (onMap && onMap !== this.mapSlug) {
        this.mapSlug = onMap;
        this._loadImages();          // fire and forget; next frame draws it
      }

      this._seq = progress;
      this._redraw(progress, { holdSeq, phase: holdPhase });
      if (elapsed >= total) {
        this.playing = false;
        this._seq = steps.length;
        this._redraw(steps.length);
        this.render(false);
        return;
      }
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  async close(options) {
    this.stop();
    return super.close(options);
  }

  /**
   * Play it on every client at once.
   *
   * Sends the PLAN, not frames -- each client animates locally from a shared
   * start time, exactly as the travel veil does. Sending the plan (rather
   * than letting each client build its own) is what guarantees everyone
   * replays the same journey: a client rebuilding mid-write, or one whose
   * party place-names differ, would otherwise animate something subtly else.
   *
   * Always the sketch style: the real art names every location they have not
   * found and draws the secret paths in red.
   */
  broadcast() {
    if (!game.user.isGM) return;
    const startedAt = Date.now() + 800;   // a beat for everyone to open
    game.socket.emit('system.darkest-system', {
      type: 'routeReplay',
      plan: this._plan,
      mapSlug: this.mapSlug,
      startedAt,
    });
    // Play in THIS window rather than opening another. playShared() spawns a
    // fresh app, and since every RouteMapApp shares one DOM id the GM ended
    // up with a second window stacked on the one they clicked from.
    this.style = 'sketch';
    this.play({ startedAt });
    this.render(false);
    ui.notifications.info('Playing the route for everyone.');
  }

  /** Open a replay window and run it. Used by the socket handler. */
  static playShared({ plan, mapSlug, startedAt }) {
    const app = new RouteMapApp();
    // Injected, not just assigned: render() calls getData(), which would
    // otherwise rebuild the plan locally and throw this one away -- making
    // the whole socket payload dead weight.
    app._injectedPlan = plan;
    app.mapSlug = mapSlug;
    app.style = 'sketch';
    app.render(true);
    // Wait for the canvas to exist before starting.
    setTimeout(() => app.play({ startedAt }), 400);
  }

  /**
   * Hand the map to the players as an image.
   *
   * Uploaded when the host allows it so it persists in a journal; otherwise
   * shown straight from the data URL. Upload fails on some hosted setups, so
   * it must never be the only route.
   */
  async share() {
    if (!game.user.isGM || !this._canvas) return;
    if (this.style === 'real') {
      const ok = await Dialog.confirm({
        title: 'Share the real map?',
        content: '<p>The region maps are flowcharts — they name <strong>every</strong> location and draw the secret birdsong paths in red.</p><p>Share the sketch instead unless you mean to reveal all of it.</p>',
        defaultYes: false,
      });
      if (!ok) return;
    }
    try {
      const url = this._canvas.toDataURL('image/png');
      const popout = new ImagePopout({ src: url, window: { title: 'The Party\u2019s Route' } });
      popout.render(true);
      popout.shareImage?.();
    } catch (err) {
      console.error('Darkest System | could not share the route map', err);
      ui.notifications.error('Could not share the map — see the console.');
    }
  }
}
