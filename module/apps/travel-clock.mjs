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

  /** Coarse phase of day, used for the dial icon and chat flavour. */
  static phaseOf(minutes) {
    const h = minutes / 60;
    if (h < 5) return 'night';
    if (h < 8) return 'dawn';
    if (h < 17) return 'day';
    if (h < 20) return 'dusk';
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
    const phase = fixed ? fixed.phase : TravelClock.phaseOf(clock.minutes);
    const meta = TravelClock.PHASE_META[phase];
    return {
      day: clock.day,
      time: TravelClock.formatTime(clock.minutes),
      phase,
      phaseLabel: fixed ? fixed.label : meta.label,
      icon: meta.icon,
      cls: meta.cls,
      fixed: !!fixed,
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
  el.title = game.user.isGM
    ? 'Click to open the Travel & Time tool'
    : `${state.phaseLabel} — Day ${state.day}`;
  el.innerHTML = `
    <i class="fas ${state.icon} dial-icon"></i>
    <div class="dial-readout">
      <span class="dial-time">${state.fixed ? state.phaseLabel : state.time}</span>
      <span class="dial-day">Day ${state.day}</span>
    </div>`;
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
    html.find('.time-skip').click((ev) => {
      const mins = parseInt(ev.currentTarget.dataset.minutes) || 0;
      this._passTime(mins, `Time passes.`);
    });

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
    const journey = route
      ? `${route.fromTitle} → ${route.toTitle || 'the unknown'}`
      : 'The party travels';

    await this._passTime(minutes, `${journey} at ${PACE_LABEL[pace].toLowerCase()} pace.`);
  }

  async _passTime(minutes, flavour) {
    const result = await TravelClock.advance(minutes);
    const state = TravelClock.displayState();

    let content = `<div class="travel-chat">
      <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> ${flavour}</div>
      <div class="travel-chat-body">
        <strong>${TravelClock.formatDuration(minutes)}</strong> passes.
        It is now <strong>${state.fixed ? state.phaseLabel : state.time}</strong>
        on <strong>Day ${result.day}</strong>.
      </div>`;

    if (result.daysPassed > 0) {
      // A day boundary is where the book's daily effects live (Winter's
      // Mercy exposure, 24h rest locks, per-day ability uses). Flag it
      // for the GM rather than applying anything automatically.
      content += `<div class="travel-chat-newday">
        <i class="fas fa-sun"></i> A new day dawns.
        <span class="travel-chat-hint">Check exposure, rest locks, and daily ability uses.</span>
      </div>`;
    }
    content += `</div>`;

    await ChatMessage.create({ content });
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

  game.socket.on('system.darkest-system', (data) => {
    if (data?.type === 'travelClockUpdate') TravelClock.refresh();
  });
}
