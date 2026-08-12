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

import { SessionLog } from './session-log.mjs';
import { TravelGroups } from './travel-groups.mjs';
import { TravelHistory } from './travel-history.mjs';

/** Injected by the content module. Empty without it, which means no map. */
export let MAP_DATA = { maps: {}, locationArea: {}, derived: {} };

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

export const RouteMap = {

  available() {
    return Object.keys(MAP_DATA.maps || {}).length > 0;
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

    // The map we're already drawing on, then the location's own area, then
    // anywhere it appears at all.
    const home = MAP_DATA.locationArea?.[slug];
    const hit = (prefer && on(prefer)) || (home && on(home))
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

      const place = (slug, title) => {
        const pin = RouteMap.resolvePin(slug, currentMap);
        if (!pin) return null;
        currentMap = pin.map;
        usedMaps.add(pin.map);
        return { ...pin, slug, title };
      };

      for (const leg of legs) {
        // A stay: no line, a ring on the pin. Its slug can be null when time
        // was skipped on a scene with no location (an area map, the
        // travelling scene), in which case it belongs where the group last
        // was -- they were somewhere before the clock moved.
        if (leg.stay) {
          const at = leg.toSlug
            ? place(leg.toSlug, leg.toTitle)
            : (lastPlaced ? { ...lastPlaced, assumed: true } : null);
          if (at) {
            steps.push({ type: 'stay', ...at, minutes: leg.minutes || 0, day: leg.day });
            lastPlaced = at;
          }
          continue;
        }

        // A break: this leg starts somewhere the group was not. Drawn as a
        // break rather than a line, or the map invents a journey.
        if (previousEnd && leg.fromSlug && leg.fromSlug !== previousEnd) {
          steps.push({ type: 'break', from: previousEnd, to: leg.fromSlug });
          currentMap = null;
        }

        if (!steps.length || steps[steps.length - 1]?.type === 'break') {
          const start = place(leg.fromSlug, leg.fromTitle);
          if (start) { steps.push({ type: 'point', ...start, day: leg.departDay ?? leg.day }); lastPlaced = start; }
        }

        const end = place(leg.toSlug, leg.toTitle);
        if (end) {
          // Don't repeat a point the line is already sitting on. A leg that
          // ends where the previous one did (a there-and-back within one
          // leg, or a duplicate row) would otherwise add a zero-length
          // segment that draws as a blob.
          const last = steps[steps.length - 1];
          if (!(last?.type === 'point' && last.slug === end.slug)) {
            steps.push({
              type: 'point', ...end, day: leg.day,
              minutes: leg.minutes || 0, label: leg.label || '',
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

    return { groups, maps: [...usedMaps] };
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
 * Draw a route plan onto a 2D context.
 *
 * `t` is how much of the journey to show, 0..1 across ALL groups against a
 * shared clock -- so two groups animate concurrently and a split reads as a
 * split rather than as one party teleporting.
 */
export function drawRoute(ctx, plan, {
  t = 1, width, height, style = 'sketch', mapSlug = null, images = {},
} = {}) {
  ctx.clearRect(0, 0, width, height);

  const map = MAP_DATA.maps?.[mapSlug];
  const px = (pct) => (pct / 100) * width;
  const py = (pct) => (pct / 100) * height;

  // ── Backdrop ───────────────────────────────────────────────────────────
  if (style === 'real' && images[mapSlug]) {
    ctx.drawImage(images[mapSlug], 0, 0, width, height);
    // Knock the art back so the route reads over it.
    ctx.fillStyle = 'rgba(10, 8, 6, 0.35)';
    ctx.fillRect(0, 0, width, height);
  } else {
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

  const ink = style === 'real' ? '#f0e6d2' : '#3a3026';
  const dim = style === 'real' ? 'rgba(240,230,210,0.55)' : 'rgba(58,48,38,0.5)';

  // How many steps to reveal, shared across groups so they move together.
  const total = Math.max(1, plan.groups.reduce((n, g) => n + g.steps.length, 0));
  let budget = Math.round(total * Math.max(0, Math.min(1, t)));

  for (const group of plan.groups) {
    const steps = group.steps.filter(s => !s.map || s.map === mapSlug);
    if (!steps.length) continue;

    const show = Math.min(steps.length, Math.max(0, budget));
    budget -= steps.length;
    if (show <= 0) continue;

    ctx.strokeStyle = group.colour;
    ctx.lineWidth = style === 'real' ? 3 : 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ── The line ─────────────────────────────────────────────────────────
    let drawing = false;
    ctx.beginPath();
    for (let i = 0; i < show; i++) {
      const s = steps[i];
      if (s.type === 'break') {
        // A leg is missing. The line STOPS -- joining across it would draw a
        // journey nobody made, which is the whole reason gaps are flagged.
        ctx.stroke();
        ctx.beginPath();
        drawing = false;
        continue;
      }
      if (s.type !== 'point' && s.type !== 'stay') continue;

      const w = style === 'sketch' ? 3 : 0;
      const x = px(s.x) + wobble(s.slug ?? 'x', i) * w;
      const y = py(s.y) + wobble(s.slug ?? 'y', i + 99) * w;
      if (!drawing) { ctx.moveTo(x, y); drawing = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Pins, stays and labels ───────────────────────────────────────────
    for (let i = 0; i < show; i++) {
      const s = steps[i];
      if (s.type === 'break') continue;
      const x = px(s.x);
      const y = py(s.y);

      // A stay: a ring sized by how long they were there. Two days at the
      // Dark Lodge is a heavy mark; a fifteen-minute pause barely shows.
      if (s.type === 'stay') {
        const r = 7 + Math.min(14, Math.log10(1 + (s.minutes || 0) / 15) * 7);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = group.colour;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(x, y, i === show - 1 ? 5.5 : 4, 0, Math.PI * 2);
      // An approximate position (no pin in the source) is hollow, so it is
      // never mistaken for a surveyed one.
      if (s.approximate) {
        ctx.strokeStyle = group.colour;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = group.colour;
        ctx.fill();
      }

      if (s.title) {
        ctx.font = `${style === 'sketch' ? 12 : 11}px "Signika", sans-serif`;
        ctx.fillStyle = i === show - 1 ? ink : dim;
        ctx.textAlign = 'center';
        ctx.fillText(s.title, x, y - 10);
      }
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
    this._t = 1;
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
    const plan = RouteMap.buildPlan();
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
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._canvas = html.find('canvas.route-canvas')[0];
    if (this._canvas) this._redraw();

    html.find('[name="mapSlug"]').on('change', (ev) => {
      this.mapSlug = ev.currentTarget.value;
      this._redraw();
    });

    html.find('[name="style"]').on('change', (ev) => {
      this.style = ev.currentTarget.value;
      this._redraw();
    });

    html.find('.route-play').click(() => this.play());
    html.find('.route-stop').click(() => this.stop());
    html.find('.route-share').click(() => this.share());
    html.find('.route-broadcast').click(() => this.broadcast());
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

  async _redraw(t = this._t) {
    if (!this._canvas || !this._plan) return;
    await this._loadImages();
    const ctx = this._canvas.getContext('2d');
    const map = MAP_DATA.maps?.[this.mapSlug];
    // Match the canvas to the map's aspect so nothing is stretched.
    const w = this._canvas.width = this._canvas.clientWidth || 860;
    const ratio = map ? (map.height / map.width) : 0.75;
    const h = this._canvas.height = Math.round(w * ratio);
    drawRoute(ctx, this._plan, {
      t, width: w, height: h, style: this.style,
      mapSlug: this.mapSlug, images: this._images,
    });
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

    const steps = this._plan.groups.flatMap(g => g.steps.filter(s => !s.map || s.map === this.mapSlug));
    if (!steps.length) return;

    // Each step gets a slice of the run, stays get their pause on top.
    const LEG = 420;
    const durations = steps.map(s => (s.type === 'stay' ? stayPause(s.minutes) : LEG));
    const total = durations.reduce((a, b) => a + b, 0);

    const tick = () => {
      if (!this.playing) return;
      const elapsed = Date.now() - startedAt;
      let acc = 0, shown = 0;
      for (let i = 0; i < durations.length; i++) {
        acc += durations[i];
        if (elapsed >= acc) shown = i + 1;
      }
      this._t = Math.min(1, shown / steps.length);
      this._redraw(this._t);
      if (elapsed >= total) { this.playing = false; this._t = 1; this._redraw(1); this.render(false); return; }
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
   * start time, exactly as the travel veil does. Players cannot read the
   * GM-scoped log, so the plan has to travel; it is a few tens of KB, once.
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
    RouteMapApp.playShared({ plan: this._plan, mapSlug: this.mapSlug, startedAt });
    ui.notifications.info('Playing the route for everyone.');
  }

  /** Open a replay window and run it. Used by the socket handler too. */
  static playShared({ plan, mapSlug, startedAt }) {
    const app = new RouteMapApp();
    app._plan = plan;
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
