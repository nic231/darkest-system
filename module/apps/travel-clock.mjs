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

// Travel routes injected by the darkest-woods module. Empty without it.
export let TRAVEL_ROUTES = [];

Hooks.once('darkestSystem.registerTravelRoutes', (data) => {
  if (Array.isArray(data?.routes)) TRAVEL_ROUTES = data.routes;
});

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
   * Phase boundaries for a given day number, as hours from the START of
   * the cycle (which is dawn, not midnight -- in woods that eventually
   * lose the sun entirely, a solar clock is meaningless, so the displayed
   * time is really "position in the current cycle" and 00:00 is daybreak).
   * Returns the START hour of each phase.
   */
  static dayStructure(day) {
    // Progress from 0 (day 1, normal) to 1 (fully merged dusk/night).
    const t = Math.min(1, Math.max(0, (day - 1) / TravelClock.DAYLIGHT_DECAY_DAYS));

    const lerp = (from, to) => from + (to - from) * t;

    // Day 1: 2h dawn, 10h day, 3h dusk, 9h night (a normal-ish cycle).
    // End state: no dawn, no day, 10h dusk, 14h night.
    const dawnLength = lerp(2, 0);
    const dayLength = lerp(10, 0);
    const duskLength = lerp(3, 10);

    // Night fills whatever is left, landing on 14h at the end state.
    const nightStart = dawnLength + dayLength + duskLength;

    return {
      dawnStart: 0,
      dayStart: dawnLength,
      duskStart: dawnLength + dayLength,
      nightStart,
      // Exposed for the tool/dial so the GM can see the woods closing in.
      daylightHours: Math.round(dayLength * 10) / 10,
      merged: dayLength <= 0.05 && dawnLength <= 0.05,
    };
  }

  /** Coarse phase of day, for the dial icon and chat flavour. */
  static phaseOf(minutes, day = 1) {
    const h = minutes / 60;
    const s = TravelClock.dayStructure(day);

    // Night wraps past midnight, so anything before dawn ends is night
    // once the cycle has collapsed far enough that dawn no longer exists.
    if (h >= s.nightStart) return 'night';
    if (h >= s.duskStart) return 'dusk';
    if (h >= s.dayStart) return 'day';
    if (s.dayStart > 0) return 'dawn';
    return 'night';
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
    const tool = Object.values(ui.windows).find(w => w instanceof TravelTool);
    if (tool) tool.render();
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

  // The shrinking daylight is the point -- surface it on hover so players
  // can feel the woods closing in without the GM having to say it.
  const lightNote = state.fixed
    ? 'The sun never rises here.'
    : state.merged
      ? 'The sun no longer rises.'
      : `About ${state.daylightHours}h of true daylight left in the day.`;
  el.title = `${state.phaseLabel} — Day ${state.day}\n${lightNote}${game.user.isGM ? '\n\nClick to open the Travel & Time tool' : ''}`;

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

    // Routes leaving the location the GM is currently looking at come
    // first -- with 318 routes in the book, an unsorted list is unusable.
    const hereSlug = canvas?.scene?.flags?.['darkest-woods']?.locationSlug ?? null;
    const here = [];
    const elsewhere = [];
    for (const r of TRAVEL_ROUTES) {
      const entry = {
        key: `${r.fromSlug}::${r.label}`,
        label: TravelTool._routeLabel(r),
        known: r.km !== null || r.hours !== null,
      };
      (r.fromSlug === hereSlug ? here : elsewhere).push(entry);
    }
    elsewhere.sort((a, b) => a.label.localeCompare(b.label));

    return {
      day: clock.day,
      time: TravelClock.formatTime(clock.minutes),
      phaseLabel: state.phaseLabel,
      isFixedRegion: state.fixed,
      daylightHours: state.daylightHours,
      merged: state.merged,
      hereName: hereSlug ? (TRAVEL_ROUTES.find(r => r.fromSlug === hereSlug)?.fromTitle ?? null) : null,
      hereRoutes: here,
      otherRoutes: elsewhere,
      hasRoutes: TRAVEL_ROUTES.length > 0,
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
      if (!route) return;
      if (route.km) html.find('[name="km"]').val(route.km);
      else html.find('[name="km"]').val('');
      html.find('[name="hours"]').val(route.hours ?? '');
      this._updatePreview(html);
    });

    html.find('[name="km"], [name="hours"], [name="pace"]').on('change keyup', () => this._updatePreview(html));

    html.find('.travel-go').click(() => this._travel(html));
    // Passing time deliberately gets NO regional flavour -- the GM
    // narrates waiting themselves. Only travel is dressed automatically.
    html.find('.time-skip').click((ev) => {
      const mins = parseInt(ev.currentTarget.dataset.minutes) || 0;
      const label = mins >= 480 ? 'The party rests.'
        : mins >= 60 ? 'The party waits.'
        : 'The party lingers a while.';
      this._passTime(mins, label);
    });

    html.find('.clock-reset').click(() => this._promptReset());

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
      preview.text('Enter a distance or pick a route.');
      return;
    }
    const dayNote = days > 0 ? ` (+${days} day${days > 1 ? 's' : ''})` : '';
    preview.text(`${TravelClock.formatDuration(minutes)} — arrive ${arrival}${dayNote}`);
  }

  async _travel(html) {
    const minutes = this._computeMinutes(html);
    if (!minutes) {
      ui.notifications.warn('Enter a distance, or pick a route with a known one.');
      return;
    }
    const pace = html.find('[name="pace"]').val() || 'normal';
    const routeKey = html.find('[name="route"]').val();
    const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === routeKey);

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

    let content = `<div class="travel-chat">
      <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> ${flavour}</div>
      ${flavourLine ? `<div class="travel-chat-flavour">${flavourLine}</div>` : ''}
      <div class="travel-chat-body">
        <strong>${TravelClock.formatDuration(minutes)}</strong> passes.
        It is now <strong>${state.fixed ? state.phaseLabel : state.time}</strong>
        on <strong>Day ${result.day}</strong>.
      </div>`;

    if (result.daysPassed > 0) {
      // A day boundary is where the book's daily effects live (Winter's
      // Mercy exposure, 24h rest locks, per-day ability uses). Flag it
      // for the GM rather than applying anything automatically.
      //
      // It's also where the woods eat the daylight, so say so in-world --
      // the party should notice the light failing without being told the
      // mechanic outright.
      const before = TravelClock.dayStructure(result.day - result.daysPassed);
      const now = TravelClock.dayStructure(result.day);

      let lightLine = '';
      if (now.merged && !before.merged) {
        lightLine = `<div class="travel-chat-light">
          Dawn does not come. Dusk and night have merged -- the sun will not rise again.
        </div>`;
      } else if (now.daylightHours < before.daylightHours) {
        lightLine = `<div class="travel-chat-light">
          The daylight is shorter again -- barely ${now.daylightHours} hours of true light remain.
        </div>`;
      }

      content += `<div class="travel-chat-newday">
        <i class="fas ${now.merged ? 'fa-moon' : 'fa-sun'}"></i>
        ${now.merged ? 'Another lightless day begins.' : 'A new day dawns.'}
        <span class="travel-chat-hint">Check exposure, rest locks, and daily ability uses.</span>
      </div>${lightLine}`;
    }
    content += `</div>`;

    await ChatMessage.create({ content });

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
}

/**
 * Register hooks that keep the dial in sync.
 */
export function registerTravelClockHooks() {
  Hooks.on('canvasReady', () => renderDial());
  Hooks.on('ready', () => renderDial());
  // The player list changes height as people connect/disconnect, and the
  // dial sits directly on top of it -- re-measure whenever it redraws.
  Hooks.on('renderPlayerList', () => renderDial());

  game.socket.on('system.darkest-system', (data) => {
    if (data?.type === 'travelClockUpdate') TravelClock.refresh();
  });
}
