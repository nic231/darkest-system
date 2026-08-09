/**
 * Travel & Time Tracker
 *
 * Two pieces that share one world clock:
 *  - TravelTool: a GM window for advancing time by travelling a route.
 *    Routes come from the companion module (which owns the book's
 *    distances) via the darkestSystem.registerTravelRoutes hook, so the
 *    system works standalone with manual entry only.
 *  - The dial overlay: a small always-visible sun/moon readout everyone
 *    sees, rendered by renderDial() into Foundry's UI.
 *
 * The clock announces time passing and day rollovers in chat, but never
 * auto-applies mechanical consequences (Winter's Mercy exposure wounds,
 * 24-hour rest locks, per-day ability refreshes). Those stay GM calls --
 * the dial tells you when, it doesn't decide for you.
 */

const SETTING_CLOCK = 'travelClock';
const SETTING_BIRDSONGS = 'knownBirdsongs';

// Travel routes injected by the darkest-woods module. Empty without it.
export let TRAVEL_ROUTES = [];

Hooks.once('darkestSystem.registerTravelRoutes', (data) => {
  if (Array.isArray(data?.routes)) TRAVEL_ROUTES = data.routes;
});

// The birds whose songs unlock secret trails. One route in the book is a
// birdsong path without a named bird, hence the catch-all.
export const BIRDSONGS = [
  { key: 'thrush', label: 'Wood Thrush' },
  { key: 'cardinal', label: 'Cardinal' },
  { key: 'grackle', label: 'Grackle' },
  { key: 'dove', label: 'Mourning Dove' },
  { key: 'warbler', label: 'Pine Warbler' },
  { key: 'nightingale', label: 'Nightingale' },
  { key: 'unnamed', label: 'Unnamed birdsong' },
];

// Walking speed in km/h. Only the travel time changes with pace -- pace
// deliberately carries no other mechanical effect (not a published rule).
const PACE_SPEED = {
  slow: 3,
  normal: 4,
  fast: 5,
};

const PACE_LABEL = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};

// Regions whose time of day never changes, regardless of the world clock.
// "The Road: Paved road with faded yellow stripe. Night always."
const FIXED_TIME_REGIONS = {
  'the-road': { phase: 'night', label: 'Endless Night' },
};

/**
 * Region-specific travel flavour, added at random to the public travel
 * message.
 *
 * These describe CONDITIONS ONLY -- terrain, weather, temperature, light,
 * smell, footing. Nothing here may imply an event, a presence, or
 * anything uncanny: no "something moves", no tracks that stop, no
 * birdsong in the wrong place. Those beats belong to the GM, and a random
 * line stealing one undercuts it. If a line could make a player ask
 * "wait, what was that?", it does not belong in this table.
 *
 * Drawn from each region's stated conditions: The Lost is temperate and
 * rainy with no wind, The Dismal is a humid swamp, Ravages is an endless
 * fire, The Keepers is cold pine mountains, The Flood is constant rain,
 * Winter's Mercy is lethal cold, The Backwoods is dense and untravelled,
 * and The Road is a paved road under permanent night.
 */
const REGION_FLAVOUR = {
  'the-lost': [
    'The trees stand close, and the light through the canopy stays thin and grey.',
    'Rain comes and goes. There is no wind to carry it.',
    'Damp leaf litter deadens every footstep.',
    'The undergrowth is low and even, and the ground stays soft.',
    'The air is cool and still, and smells of wet bark.',
    'Roots cross the path often enough to keep everyone watching their feet.',
  ],
  'the-dismal': [
    'The muddy ground gives underfoot, and the air tastes of stagnant water.',
    'The stink of rot thickens, then thins, then thickens again.',
    'Insects hang in curtains over the wet ground.',
    'Standing water spreads across the low ground, black and unmoving.',
    'The humidity is total. Clothes cling and never dry.',
    'Moss and dead creeper hang from every branch within reach.',
  ],
  'the-ravages-of-flame': [
    'Ash falls steadily, settling in hair and collars.',
    'The heat never eases. Breathing is work.',
    'The smoke thins just enough to show more burning ahead.',
    'The ground is hot through boot leather, and blackened underfoot.',
    'Everything is the colour of char and old orange light.',
    'The air is dry enough to crack lips within the hour.',
  ],
  'the-keepers': [
    'The pines close overhead and the cold settles into everything.',
    'Loose stone shifts underfoot on the climb.',
    'The air is thin and sharp, and the going is slow.',
    'Mist pools in the hollows below, thick and unmoving.',
    'Fallen needles carpet the slope, slick where they are wet.',
    'The grade never quite levels out. The legs feel it.',
  ],
  'the-flood': [
    'The rain does not stop. It has not stopped for a long time.',
    'Water runs over the path ankle-deep, then knee-deep, then shallow again.',
    'Everything is soaked through and stays that way.',
    'The sound of running water comes from every direction at once.',
    'The ground beneath the water is soft, and the footing is uncertain.',
    'Debris collects against the trees where the current slows.',
  ],
  'winters-mercy': [
    'The cold gets into the joints and stays there.',
    'Fresh snow hides whatever the ground is really doing.',
    'Breath freezes in the air with every step.',
    'The white glare gives way to blue shadow, and the temperature drops again.',
    'Snow comes to mid-calf, and every stride costs.',
    'Ice sheathes the branches and cracks when they are touched.',
  ],
  'the-backwoods': [
    'The undergrowth thickens until the way ahead has to be forced.',
    'There is no trail here worth the name.',
    'The canopy closes overhead and takes what light there was.',
    'Thorns catch at sleeves and packs with every few steps.',
    'The ground is damp and cold, and stays that way.',
    'Deadfall crosses the route often enough to slow everything down.',
  ],
  'the-road': [
    'The faded yellow stripe runs on ahead into the dark.',
    'The asphalt is cracked but level, and the walking is easy.',
    'The dark past the shoulder is complete, and stays that way.',
    'Weeds push up through the seams in the road surface.',
    'The night air is cool and dry, and the road holds the day it never had.',
    'The verge is gravel and dead grass, and the treeline sits well back.',
  ],
};

/** A random atmospheric line for a region, or null if we have none. */
function regionFlavour(regionSlug) {
  const lines = REGION_FLAVOUR[regionSlug];
  if (!lines?.length) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * Turn an exit label into a description of the journey that names no
 * destination.
 *
 * Route labels in the book are already written from the party's own point
 * of view -- "Trail to the North", "Track to the South", "Back Down the
 * Road" -- which is exactly what a lost group would know. Naming the
 * destination in public chat would spoil it (the players don't know
 * they're walking to Baba Yaga's Hut until they arrive), so the GM's
 * dropdown keeps the real name and the chat gets this instead.
 *
 * ~91% of routes match the Trail/Track/Road/Path + direction pattern.
 * Anything unusual ("Cave Opening", "Stairs", "Mordecai's Door") is
 * distinctive enough to read well verbatim.
 */
function describeJourney(label) {
  if (!label) return 'The party travels on';

  // "Trail to the North" / "Trail Northwest" -> "follows the trail north"
  const directed = label.match(
    /^(?:(Flooded|Steep|Narrow|Winding|Overgrown)\s+)?(Trail|Track|Road|Path|Way|Stairs?|Tunnel|Bridge)\s+(?:(?:to|toward)\s+the\s+)?(North|South|East|West|Northeast|Northwest|Southeast|Southwest)$/i
  );
  if (directed) {
    const [, adj, kind, dir] = directed;
    const surface = `${adj ? adj.toLowerCase() + ' ' : ''}${kind.toLowerCase()}`;
    return `The party follows the ${surface} ${dir.toLowerCase()}`;
  }

  // The Road's stock directions read naturally as-is.
  if (/^Farther Up the Road$/i.test(label)) return 'The party continues up the road';
  if (/^Back Down the Road$/i.test(label)) return 'The party heads back down the road';
  if (/^The Road Back$/i.test(label)) return 'The party heads back down the road';
  if (/^The Road on the (Left|Right)$/i.test(label)) {
    return `The party takes the road on the ${RegExp.$1.toLowerCase()}`;
  }

  // A label that already names a route ("Secret Path of the Grackle",
  // "Stairs Down") slots in after "takes the". Anything else is a phrase
  // rather than a noun ("Exiting the Woods", "Woodfolk Symbol") and would
  // read as nonsense there, so fall back to something always grammatical.
  if (/\b(trail|track|road|path|way|stairs?|tunnel|bridge|pier|door|opening|gate|steps)\b/i.test(label)) {
    return `The party takes the ${label.replace(/^The\s+/i, '').toLowerCase()}`;
  }
  return 'The party presses on';
}

export class TravelClock {

  // ── Clock state ───────────────────────────────────────────────────────

  static getClock() {
    const defaults = { day: 1, minutes: 8 * 60 }; // Day 1, 08:00
    try {
      return game.settings.get('darkest-system', SETTING_CLOCK) || defaults;
    } catch (e) {
      return defaults;
    }
  }

  static async setClock(clock) {
    await game.settings.set('darkest-system', SETTING_CLOCK, clock);
  }

  /**
   * Advance the clock by a number of minutes, rolling over days.
   * Returns { day, minutes, daysPassed } describing the new state.
   */
  static async advance(minutes) {
    const clock = TravelClock.getClock();
    const total = clock.minutes + Math.round(minutes);
    const daysPassed = Math.floor(total / 1440);
    const next = {
      day: clock.day + daysPassed,
      minutes: ((total % 1440) + 1440) % 1440,
    };
    await TravelClock.setClock(next);
    TravelClock.broadcastUpdate();
    return { ...next, daysPassed };
  }

  // ── Birdsongs ─────────────────────────────────────────────────────────

  /** Birdsongs the party has learned, as a set of keys. */
  static getKnownBirdsongs() {
    try {
      return new Set(game.settings.get('darkest-system', SETTING_BIRDSONGS) || []);
    } catch (e) {
      return new Set();
    }
  }

  static async setKnownBirdsongs(keys) {
    await game.settings.set('darkest-system', SETTING_BIRDSONGS, [...keys]);
    TravelClock.broadcastUpdate();
  }

  /** Toggle one birdsong on or off. GM-only in practice. */
  static async toggleBirdsong(key) {
    const known = TravelClock.getKnownBirdsongs();
    if (known.has(key)) known.delete(key);
    else known.add(key);
    await TravelClock.setKnownBirdsongs(known);
  }

  /** Whether a given route is currently passable. */
  static canUseRoute(route, known = null) {
    if (!route.birdsong) return true;
    const songs = known ?? TravelClock.getKnownBirdsongs();
    return songs.has(route.bird ?? 'unnamed');
  }

  // ── Route finding ─────────────────────────────────────────────────────

  /**
   * Travel time for a single route, in minutes, at the given pace.
   *
   * Routes the book never quantified are charged a small nominal cost
   * rather than nothing. Treating them as free made the route finder
   * prefer absurd paths -- a 16-leg detour through the Rootrealm scored
   * "faster" than an 8-leg walk purely because its legs were unmeasured.
   * A few minutes each keeps them cheap without making them free.
   */
  static UNMEASURED_LEG_MINUTES = 15;

  static routeMinutes(route, pace = 'normal') {
    if (route.hours) return route.hours * 60 * (PACE_SPEED.normal / PACE_SPEED[pace]);
    if (route.km) return (route.km / PACE_SPEED[pace]) * 60;
    // km === 0 means "a few steps" -- genuinely negligible.
    if (route.km === 0) return 0;
    return TravelClock.UNMEASURED_LEG_MINUTES;
  }

  /**
   * Shortest path between two locations by travel time (Dijkstra).
   *
   * The map is a single connected component of 131 locations, so a path
   * almost always exists -- but only across routes the party can actually
   * use, which is why birdsong trails are filtered out unless known.
   *
   * Returns { legs, minutes } or null if unreachable. This finds the
   * QUICKEST route, not the one the party knows; whether they'd actually
   * find it is the GM's call, which is why the result is shown as an
   * editable plan rather than executed directly.
   */
  static findRoute(fromSlug, toSlug, pace = 'normal') {
    if (!fromSlug || !toSlug || fromSlug === toSlug) return null;

    const known = TravelClock.getKnownBirdsongs();
    const adjacency = new Map();
    for (const route of TRAVEL_ROUTES) {
      if (!route.fromSlug || !route.toSlug) continue;
      if (!TravelClock.canUseRoute(route, known)) continue;
      if (!adjacency.has(route.fromSlug)) adjacency.set(route.fromSlug, []);
      adjacency.get(route.fromSlug).push(route);
    }

    const best = new Map([[fromSlug, 0]]);
    const prev = new Map();
    // A simple priority queue is fine at this size (131 nodes).
    const queue = [{ slug: fromSlug, cost: 0 }];

    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      const { slug, cost } = queue.shift();
      if (slug === toSlug) break;
      if (cost > (best.get(slug) ?? Infinity)) continue;

      for (const route of adjacency.get(slug) ?? []) {
        const next = cost + TravelClock.routeMinutes(route, pace);
        if (next < (best.get(route.toSlug) ?? Infinity)) {
          best.set(route.toSlug, next);
          prev.set(route.toSlug, route);
          queue.push({ slug: route.toSlug, cost: next });
        }
      }
    }

    if (!prev.has(toSlug)) return null;

    const legs = [];
    let cursor = toSlug;
    while (cursor !== fromSlug) {
      const route = prev.get(cursor);
      if (!route) return null;
      legs.unshift(route);
      cursor = route.fromSlug;
    }

    return { legs, minutes: best.get(toSlug) ?? 0 };
  }

  /** Every location that appears in the route graph, for the pickers. */
  static allLocations() {
    const seen = new Map();
    for (const route of TRAVEL_ROUTES) {
      if (route.fromSlug && !seen.has(route.fromSlug)) seen.set(route.fromSlug, route.fromTitle);
      if (route.toSlug && !seen.has(route.toSlug)) seen.set(route.toSlug, route.toTitle);
    }
    return [...seen.entries()]
      .map(([slug, title]) => ({ slug, title: title || slug }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // ── Display helpers ───────────────────────────────────────────────────

  /** "14:35" from minutes-since-midnight. */
  static formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** "4h 20m" / "45m" from a duration in minutes. */
  static formatDuration(minutes) {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  /**
   * The light dies as the woods take hold. Per the book:
   *
   *   "The characters' first day and night in the woods pass normally...
   *    After that first day, however, the days begin to grow drastically
   *    shorter, with dusk and dawn growing longer until finally they
   *    merge. Eventually, it becomes standard that a 'day' consists of
   *    about ten hours of dusk and fourteen hours of night."
   *
   * So day 1 is a normal 24h cycle, and the end state has NO true daylight
   * at all -- just 10h of dusk and 14h of night. We interpolate between
   * the two across DAYLIGHT_DECAY_DAYS: true daylight shrinks toward zero
   * while dusk expands to swallow it, and night grows to 14h.
   *
   * Even "normal" daylight here is only half-light -- the canopy is thick
   * and nights are pitch black -- but that's flavour for the GM to
   * narrate, not something the clock needs to model.
   */
  static DAYLIGHT_DECAY_DAYS = 5;

  /**
   * Phase boundaries for a given day number, as clock hours (0-24).
   *
   * The light is centred on midday and eaten from both ends: as the days
   * shorten, dawn starts later and night starts earlier, with dusk
   * growing to fill the gap. Night wraps through midnight, as it should.
   *
   * Day 1 is a normal day -- dawn ~06:00, daylight to ~16:00, dusk to
   * ~19:00, night after. By the end state there is no dawn or daylight at
   * all: 10h of dusk (centred on midday, ~07:00-17:00) and 14h of night.
   */
  static dayStructure(day) {
    // Progress from 0 (day 1, normal) to 1 (fully merged dusk/night).
    const t = Math.min(1, Math.max(0, (day - 1) / TravelClock.DAYLIGHT_DECAY_DAYS));

    const lerp = (from, to) => from + (to - from) * t;

    // Lengths, interpolated toward the book's stated end state.
    const dawnLength = lerp(2, 0);   // 2h -> none
    const dayLength = lerp(10, 0);   // 10h -> none
    const duskLength = lerp(3, 10);  // 3h -> 10h

    // Keep the lit part of the cycle centred on midday (12:00) so the
    // clock still reads the way people expect -- morning is morning,
    // afternoon is afternoon -- while the light narrows around noon.
    const litLength = dawnLength + dayLength + duskLength;
    const dawnStart = 12 - litLength / 2;

    return {
      dawnStart,
      dayStart: dawnStart + dawnLength,
      duskStart: dawnStart + dawnLength + dayLength,
      nightStart: dawnStart + litLength,
      // Exposed for the tool/dial so the GM can see the woods closing in.
      daylightHours: Math.round(dayLength * 10) / 10,
      merged: dayLength <= 0.05 && dawnLength <= 0.05,
    };
  }

  /** Coarse phase of day, for the dial icon and chat flavour. */
  static phaseOf(minutes, day = 1) {
    const h = minutes / 60;
    const s = TravelClock.dayStructure(day);

    // Night wraps through midnight, so it's everything outside the lit
    // window rather than a single trailing block.
    if (h < s.dawnStart || h >= s.nightStart) return 'night';
    if (h >= s.duskStart) return 'dusk';
    if (h >= s.dayStart) return 'day';
    return 'dawn';
  }

  static PHASE_META = {
    dawn: { icon: 'fa-sun', label: 'Dawn', cls: 'phase-dawn' },
    day: { icon: 'fa-sun', label: 'Day', cls: 'phase-day' },
    dusk: { icon: 'fa-cloud-sun', label: 'Dusk', cls: 'phase-dusk' },
    night: { icon: 'fa-moon', label: 'Night', cls: 'phase-night' },
  };

  /** The region slug of the currently-viewed scene, if it has one. */
  static currentRegion() {
    return canvas?.scene?.flags?.['darkest-woods']?.region
      ?? game.scenes?.active?.flags?.['darkest-woods']?.region
      ?? null;
  }

  /**
   * What the dial should show right now. Regions with fixed time (The
   * Road's endless night) override the underlying clock's phase, but the
   * clock itself keeps running -- time still passes there.
   */
  static displayState() {
    const clock = TravelClock.getClock();
    const region = TravelClock.currentRegion();
    const fixed = region ? FIXED_TIME_REGIONS[region] : null;
    const phase = fixed ? fixed.phase : TravelClock.phaseOf(clock.minutes, clock.day);
    const meta = TravelClock.PHASE_META[phase];
    const structure = TravelClock.dayStructure(clock.day);
    return {
      day: clock.day,
      time: TravelClock.formatTime(clock.minutes),
      phase,
      phaseLabel: fixed ? fixed.label : meta.label,
      icon: meta.icon,
      cls: meta.cls,
      fixed: !!fixed,
      daylightHours: structure.daylightHours,
      merged: structure.merged,
    };
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  static broadcastUpdate() {
    game.socket.emit('system.darkest-system', { type: 'travelClockUpdate' });
  }

  static refresh() {
    renderDial();
    // Re-render the tool too: its "From here" route list and the region
    // it reads for flavour both depend on the active scene, so it goes
    // stale the moment the GM switches scenes by any other means.
    const tool = Object.values(ui.windows).find(w => w instanceof TravelTool);
    if (tool?.rendered) tool.render();
  }
}

/* ----------------------------------------
   The dial overlay
---------------------------------------- */

/**
 * Sit the dial directly above the player list. The list grows upward as
 * players connect, so a fixed offset works at an empty table and gets
 * covered at a full one -- measure the real element instead.
 */
function positionDial(el) {
  const players = document.getElementById('players');
  if (!players) return;
  const gap = 10;
  el.style.bottom = `${players.offsetHeight + gap}px`;
}

/**
 * Render (or update) the always-visible dial. Kept as a plain DOM node
 * docked to the UI rather than an Application, so it doesn't occupy a
 * window slot or need opening -- it's ambient, like a clock on the wall.
 */
export function renderDial() {
  if (!game.ready) return;

  const state = TravelClock.displayState();
  let el = document.getElementById('darkest-travel-dial');

  if (!el) {
    el = document.createElement('div');
    el.id = 'darkest-travel-dial';
    document.body.appendChild(el);
    // GMs get one-click access to the travel tool from the dial itself.
    el.addEventListener('click', () => {
      if (!game.user.isGM) return;
      const existing = Object.values(ui.windows).find(w => w instanceof TravelTool);
      if (existing) existing.bringToTop();
      else new TravelTool().render(true);
    });
  }

  el.className = `darkest-travel-dial ${state.cls}${game.user.isGM ? ' gm-clickable' : ''}`;

  // Players get the phase and day only. The exact daylight remaining is
  // GM information -- the characters have no way to measure it, and
  // noticing the light failing is a realisation the players should reach
  // themselves. Once the sun has stopped rising entirely that IS plainly
  // observable, so both sides get told.
  let lightNote;
  if (state.fixed) lightNote = 'The sun never rises here.';
  else if (state.merged) lightNote = 'The sun no longer rises.';
  else if (game.user.isGM) lightNote = `GM: about ${state.daylightHours}h of true daylight left.`;
  else lightNote = null;

  el.title = [
    `${state.phaseLabel} — Day ${state.day}`,
    lightNote,
    game.user.isGM ? '\nClick to open the Travel & Time tool' : null,
  ].filter(Boolean).join('\n');

  el.innerHTML = `
    <i class="fas ${state.icon} dial-icon"></i>
    <div class="dial-readout">
      <span class="dial-time">${state.fixed ? state.phaseLabel : state.time}</span>
      <span class="dial-day">Day ${state.day}${state.merged && !state.fixed ? ' · sunless' : ''}</span>
    </div>`;

  positionDial(el);
}

/* ----------------------------------------
   The travel tool (GM)
---------------------------------------- */

export class TravelTool extends Application {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'darkest-travel-tool',
      title: 'Travel & Time',
      template: 'systems/darkest-system/templates/apps/travel-tool.hbs',
      classes: ['darkest-system', 'travel-tool'],
      width: 400,
      height: 'auto',
      resizable: false,
      minimizable: true,
      popOut: true,
    });
  }

  getData() {
    const clock = TravelClock.getClock();
    const state = TravelClock.displayState();

    // Only routes leaving where the party actually is. Listing all 318 was
    // unusable, and the useful ones are always the exits from here.
    // A queued multi-leg journey continues from its LAST leg's
    // destination, not the current scene -- otherwise you can only ever
    // add neighbours of where you started.
    const originSlug = this._legs?.length
      ? this._legs[this._legs.length - 1].route.toSlug
      : (canvas?.scene?.flags?.['darkest-woods']?.locationSlug ?? null);

    const hereRoutes = TRAVEL_ROUTES
      .filter(r => r.fromSlug === originSlug)
      .map(r => ({
        key: `${r.fromSlug}::${r.label}`,
        label: TravelTool._routeLabel(r),
      }));

    // Prefer the last leg's own destination title -- a dead-end location
    // has no outgoing routes, so looking it up by fromSlug would fail.
    const originName = this._legs?.length
      ? (this._legs[this._legs.length - 1].route.toTitle ?? null)
      : (originSlug ? (TRAVEL_ROUTES.find(r => r.fromSlug === originSlug)?.fromTitle ?? null) : null);

    // Queued legs, with a running total so the GM can see the whole trip.
    const legs = (this._legs ?? []).map((l, i) => ({
      index: i,
      label: l.route.toTitle || 'Unknown',
      via: l.route.label,
      duration: l.minutes >= 1 ? TravelClock.formatDuration(l.minutes) : '—',
    }));
    const legTotal = (this._legs ?? []).reduce((sum, l) => sum + l.minutes, 0);

    const known = TravelClock.getKnownBirdsongs();

    return {
      day: clock.day,
      time: TravelClock.formatTime(clock.minutes),
      phaseLabel: state.phaseLabel,
      isFixedRegion: state.fixed,
      daylightHours: state.daylightHours,
      merged: state.merged,
      originName,
      originSlug,
      hereRoutes,
      hasHereRoutes: hereRoutes.length > 0,
      hasRoutes: TRAVEL_ROUTES.length > 0,
      legs,
      hasLegs: legs.length > 0,
      legTotal: legTotal >= 1 ? TravelClock.formatDuration(legTotal) : null,
      // Cross-map planning: pick two places, get a route.
      locations: TravelClock.allLocations(),
      birdsongs: BIRDSONGS.map(b => ({ ...b, known: known.has(b.key) })),
      paces: Object.keys(PACE_SPEED).map(p => ({
        key: p,
        label: PACE_LABEL[p],
        speed: PACE_SPEED[p],
      })),
    };
  }

  static _routeLabel(r) {
    const dest = r.toTitle || 'Unknown';
    let dist;
    if (r.km === 0) dist = 'a few steps';
    else if (r.km) dist = `${r.km} km`;
    else if (r.hours) dist = `~${r.hours}h`;
    else dist = 'distance unknown';
    return `${r.fromTitle} → ${dest} (${dist})`;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Selecting a known route fills the manual distance box, so the GM can
    // still nudge it before committing.
    html.find('[name="route"]').on('change', (ev) => {
      const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === ev.currentTarget.value);
      // Always reset both boxes first -- otherwise clearing the dropdown,
      // or picking a route with no distance, silently leaves the previous
      // selection's numbers behind and travels the wrong distance.
      html.find('[name="km"]').val(route?.km ? route.km : '');
      html.find('[name="hours"]').val(route?.hours ?? '');
      this._updatePreview(html);
    });

    html.find('[name="km"], [name="hours"], [name="pace"]').on('change keyup', () => this._updatePreview(html));

    // Multi-leg journeys: queue several hops, then walk them as one trip.
    html.find('.leg-add').click(() => this._addLeg(html));
    html.find('.leg-remove').click((ev) => {
      const i = parseInt(ev.currentTarget.dataset.index);
      this._legs.splice(i, 1);
      this.render();
    });
    html.find('.leg-clear').click(() => {
      this._legs = [];
      this.render();
    });

    html.find('.travel-go').click(() => this._travel(html));
    // Passing time gets no flavour and no narration at all -- the GM
    // describes what happened and triggers whatever follows. The message
    // exists only to record that the clock moved.
    html.find('.time-skip').click((ev) => {
      const mins = parseInt(ev.currentTarget.dataset.minutes) || 0;
      this._passTime(mins, 'Time has passed.');
    });

    html.find('.clock-reset').click(() => this._promptReset());

    // Birdsong toggles -- shared state with the Transgression Tracker.
    html.find('.birdsong-toggle').click(async (ev) => {
      await TravelClock.toggleBirdsong(ev.currentTarget.dataset.bird);
      TravelClock.refresh();
    });

    // Cross-map planning: work out a route between two arbitrary places.
    html.find('.plan-find').click(() => this._findRoute(html));
    html.find('[name="planTo"]').on('change', () => this._findRoute(html));

    this._updatePreview(html);
  }

  /** Minutes implied by the current form values. */
  _computeMinutes(html) {
    const pace = html.find('[name="pace"]').val() || 'normal';
    const hours = parseFloat(html.find('[name="hours"]').val());
    const km = parseFloat(html.find('[name="km"]').val());

    if (!isNaN(hours) && hours > 0) {
      // A route quoted in hours is a "normal pace" figure; scale it so
      // pace still matters, using the ratio of walking speeds.
      return hours * 60 * (PACE_SPEED.normal / PACE_SPEED[pace]);
    }
    if (!isNaN(km) && km > 0) {
      return (km / PACE_SPEED[pace]) * 60;
    }
    return 0;
  }

  _updatePreview(html) {
    const minutes = this._computeMinutes(html);
    const clock = TravelClock.getClock();
    const after = clock.minutes + Math.round(minutes);
    const days = Math.floor(after / 1440);
    const arrival = TravelClock.formatTime(((after % 1440) + 1440) % 1440);

    const preview = html.find('.travel-preview');
    if (!minutes) {
      // A route with no distance still travels -- it just doesn't move
      // the clock. Say so, rather than implying the button won't work.
      const hasRoute = !!html.find('[name="route"]').val();
      preview.text(hasRoute
        ? 'No distance — travels and switches scene without advancing the clock.'
        : 'Enter a distance or pick a route.');
      return;
    }
    const dayNote = days > 0 ? ` (+${days} day${days > 1 ? 's' : ''})` : '';
    preview.text(`${TravelClock.formatDuration(minutes)} — arrive ${arrival}${dayNote}`);
  }

  /**
   * Plan a route between two arbitrary locations and load it into the leg
   * queue, where the GM can edit it before committing.
   *
   * This finds the QUICKEST usable path, which is not the same as the one
   * the party would actually find -- they may not know the way at all.
   * That's why the result lands in the editable queue rather than
   * travelling immediately: the tool does the arithmetic, the GM decides
   * whether the party could plausibly walk it.
   */
  _findRoute(html) {
    const from = html.find('[name="planFrom"]').val();
    const to = html.find('[name="planTo"]').val();
    const pace = html.find('[name="pace"]').val() || 'normal';

    if (!from || !to) {
      ui.notifications.warn('Pick where the party is starting and where they are going.');
      return;
    }
    if (from === to) {
      ui.notifications.warn('The party is already there.');
      return;
    }

    const result = TravelClock.findRoute(from, to, pace);
    if (!result) {
      const known = TravelClock.getKnownBirdsongs();
      ui.notifications.warn(known.size < BIRDSONGS.length
        ? 'No route the party can currently walk — a secret trail may be needed. Check the birdsongs they know.'
        : 'No route found between those locations.');
      return;
    }

    this._legs = result.legs.map(route => ({
      route,
      minutes: TravelClock.routeMinutes(route, pace),
    }));
    this.render();
  }

  /**
   * Queue the currently-selected route as another leg of a longer
   * journey. The party often crosses several locations in one push, and
   * doing that as separate trips means a chat message and a scene change
   * for each -- this collapses it into one journey with one arrival.
   */
  _addLeg(html) {
    const routeKey = html.find('[name="route"]').val();
    const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === routeKey);
    if (!route) {
      ui.notifications.warn('Pick a route to add.');
      return;
    }

    this._legs ??= [];
    this._legs.push({ route, minutes: this._computeMinutes(html) });
    // Re-rendering repoints the dropdown at the new last stop, so the next
    // pick continues the journey rather than starting over.
    this.render();
  }

  /**
   * Walk a queued multi-leg journey as a single trip: one chat message,
   * one arrival, the clock advanced by the whole duration.
   */
  async _travelLegs() {
    const legs = this._legs;
    const totalMinutes = legs.reduce((sum, l) => sum + l.minutes, 0);
    const last = legs[legs.length - 1];

    // Describe only the FIRST leg -- the party set out that way, and
    // naming every turn would spell out the route they're discovering.
    const opening = describeJourney(legs[0].route.label);
    const legNote = legs.length > 1
      ? `, and keeps going for ${legs.length} stretches of trail`
      : '';

    this._legs = [];
    await this._passTime(totalMinutes, `${opening}${legNote}.`, {
      region: TravelClock.currentRegion(),
      route: last.route,
    });
  }

  async _travel(html) {
    // A queued journey takes precedence over whatever is in the form.
    if (this._legs?.length) return this._travelLegs();

    const minutes = this._computeMinutes(html);
    const pace = html.find('[name="pace"]').val() || 'normal';
    const routeKey = html.find('[name="route"]').val();
    const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === routeKey);

    // A route with no distance is still a real journey -- "a few steps"
    // between adjacent locations, or one the book never quantified. Those
    // should still move the party and switch the scene, just without
    // advancing the clock. Only block when there's nothing to act on at
    // all: no route picked AND no distance typed.
    if (!minutes && !route) {
      ui.notifications.warn('Pick a route, or enter a distance.');
      return;
    }

    // Public text never names the destination -- the party doesn't know
    // where they're going until they get there. See describeJourney().
    const journey = route ? describeJourney(route.label) : 'The party travels';
    const paceNote = pace === 'normal' ? '' : ` at a ${PACE_LABEL[pace].toLowerCase()} pace`;

    await this._passTime(minutes, `${journey}${paceNote}.`, {
      region: TravelClock.currentRegion(),
      route,
    });
  }

  /**
   * Set the day and time directly. Sessions don't always start where the
   * last one ended -- a flashback, a time skip between arcs, or simply
   * fixing a misclick all need the clock moved by hand rather than
   * advanced.
   */
  async _promptReset() {
    const clock = TravelClock.getClock();
    const h = String(Math.floor(clock.minutes / 60)).padStart(2, '0');
    const m = String(clock.minutes % 60).padStart(2, '0');

    const content = `<form class="darkest-dialog">
      <div class="form-group">
        <label>Day</label>
        <input type="number" name="day" min="1" step="1" value="${clock.day}" />
      </div>
      <div class="form-group">
        <label>Time</label>
        <input type="time" name="time" value="${h}:${m}" />
      </div>
      <p class="hint">Sets the clock directly. No time is counted as having passed.</p>
    </form>`;

    if (this._resetDialog?.rendered) await this._resetDialog.close();

    this._resetDialog = new Dialog({
      title: 'Set Day &amp; Time',
      content,
      buttons: {
        set: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Set',
          callback: async (html) => {
            const day = Math.max(1, parseInt(html.find('[name="day"]').val()) || 1);
            const [hh, mm] = (html.find('[name="time"]').val() || '08:00').split(':').map(Number);
            const minutes = ((hh || 0) * 60 + (mm || 0)) % 1440;

            await TravelClock.setClock({ day, minutes });
            TravelClock.broadcastUpdate();
            TravelClock.refresh();
            this.render();

            await ChatMessage.create({
              content: `<div class="travel-chat">
                <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> The clock is set.</div>
                <div class="travel-chat-body">
                  It is <strong>${TravelClock.formatTime(minutes)}</strong> on <strong>Day ${day}</strong>.
                </div>
              </div>`
            });
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' }
      },
      default: 'set',
      close: () => { this._resetDialog = null; }
    }, { width: 300 });
    this._resetDialog.render(true);
  }

  /**
   * Switch to the destination's scene after travelling, if one exists and
   * has been imported into the world. Compendium scenes aren't activatable
   * until imported, so a missing scene is normal, not an error -- the GM
   * may simply not have imported that region yet.
   */
  async _activateDestinationScene(route) {
    if (!route?.toSlug) return null;

    const scene = game.scenes.find(s =>
      s.getFlag('darkest-woods', 'locationSlug') === route.toSlug
    );
    if (!scene) return null;

    await scene.activate();
    return scene;
  }

  async _passTime(minutes, flavour, opts = {}) {
    // Capture the region BEFORE any scene change, so the flavour describes
    // the ground actually crossed rather than wherever the party ends up.
    const flavourLine = opts.region ? regionFlavour(opts.region) : null;

    const result = await TravelClock.advance(minutes);
    const state = TravelClock.displayState();

    // A journey of a few steps (or one the book never quantified) moves
    // the party without moving the clock -- report the time rather than
    // claiming "0m passes".
    const timeLine = minutes >= 1
      ? `<strong>${TravelClock.formatDuration(minutes)}</strong> passes.
         It is now <strong>${state.fixed ? state.phaseLabel : state.time}</strong>
         on <strong>Day ${result.day}</strong>.`
      : `It is <strong>${state.fixed ? state.phaseLabel : state.time}</strong>
         on <strong>Day ${result.day}</strong>.`;

    let content = `<div class="travel-chat">
      <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> ${flavour}</div>
      ${flavourLine ? `<div class="travel-chat-flavour">${flavourLine}</div>` : ''}
      <div class="travel-chat-body">${timeLine}</div>`;

    const now = TravelClock.dayStructure(result.day);

    if (result.daysPassed > 0) {
      // Public side says only that a day turned. The shrinking daylight
      // is deliberately NOT announced: the characters have no way to
      // measure it (on day 2 there's nothing to compare against), and
      // noticing the light failing is exactly the realisation the players
      // should reach on their own.
      content += `<div class="travel-chat-newday">
        <i class="fas ${now.merged ? 'fa-moon' : 'fa-sun'}"></i>
        ${now.merged ? 'Another lightless day begins.' : 'A new day dawns.'}
      </div>`;
    }
    content += `</div>`;

    await ChatMessage.create({ content });

    // The GM's side of a day boundary: the book's daily effects to check,
    // and how far the light has actually fallen. Whispered, because both
    // are GM bookkeeping rather than anything the party can perceive.
    if (result.daysPassed > 0) {
      const before = TravelClock.dayStructure(result.day - result.daysPassed);
      let lightNote;
      if (now.merged && !before.merged) {
        lightNote = 'The sun no longer rises. Dusk and night have fully merged.';
      } else if (now.merged) {
        lightNote = 'Still sunless — 10h dusk, 14h night.';
      } else {
        lightNote = `Daylight is down to about ${now.daylightHours}h.`;
      }

      const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
      if (gmIds.length) {
        await ChatMessage.create({
          content: `<div class="travel-chat">
            <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> Day ${result.day} begins.</div>
            <div class="travel-chat-light">${lightNote}</div>
            <div class="travel-chat-hint">Check exposure, rest locks, and daily ability uses.</div>
          </div>`,
          whisper: gmIds,
        });
      }
    }

    // Move the party to where they actually walked to.
    if (opts.route) {
      const scene = await this._activateDestinationScene(opts.route);
      if (scene) {
        ui.notifications.info(`Now viewing: ${scene.name}`);
      } else if (opts.route.toSlug) {
        ui.notifications.warn(
          `No scene imported for ${opts.route.toTitle || 'that destination'} -- import its region to travel there automatically.`
        );
      }
    }

    TravelClock.refresh();
    this.render();
  }
}

/**
 * Register the world-scoped clock setting.
 */
export function registerTravelClockSettings() {
  game.settings.register('darkest-system', SETTING_CLOCK, {
    name: 'Travel Clock',
    hint: 'Current in-world day and time',
    scope: 'world',
    config: false,
    type: Object,
    default: { day: 1, minutes: 8 * 60 },
  });

  // Shared by the travel tool and the Transgression Tracker -- both read
  // and write this one setting, so toggling in either place is reflected
  // in the other.
  game.settings.register('darkest-system', SETTING_BIRDSONGS, {
    name: 'Known Birdsongs',
    hint: 'Which birdsongs the party has learned, unlocking secret trails',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });
}

/**
 * Register hooks that keep the dial in sync.
 */
export function registerTravelClockHooks() {
  // A scene change moves the party: the dial's region-specific time and
  // the tool's "From here" routes both depend on it, so refresh both
  // rather than just redrawing the dial.
  Hooks.on('canvasReady', () => TravelClock.refresh());
  Hooks.on('ready', () => renderDial());
  // The player list changes height as people connect/disconnect, and the
  // dial sits directly on top of it -- re-measure whenever it redraws.
  Hooks.on('renderPlayerList', () => renderDial());

  game.socket.on('system.darkest-system', (data) => {
    if (data?.type === 'travelClockUpdate') TravelClock.refresh();
  });
}
