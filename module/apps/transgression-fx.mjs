/**
 * The woods getting worse.
 *
 * The transgression track already escalates in words -- _publicStirMessage()
 * steps its wording at 5 and 10 -- but for a long time nothing else did. This
 * puts a sound and a screen effect under those same two steps, so one
 * escalation is felt three ways rather than three schedules being kept in
 * sync.
 *
 * TRIGGERED BY THE GM, NOT BY THE DICE. These fired automatically when the
 * track advanced, which sounds right and plays badly: a Darkest Die can land
 * mid-sentence, in the middle of another player's turn, or three rolls deep
 * into a combat round, and a howl arriving there steps on the table instead
 * of landing on it. The tracker now carries a speaker button per region and
 * the GM plays the cue when it will land. Recording a transgression is
 * unchanged -- the track advances and the players get their stir message
 * exactly as before.
 *
 *     tier 1   levels 1-4    a stinger, brief and low. No visual: a level-1
 *                            transgression happens several times a session,
 *                            and a screen effect on each stops being ominous
 *                            by the third.
 *     tier 2   levels 5-9    a heavier stinger, and the screen notices.
 *     tier 3   level 10      the witch's signature, and it lingers.
 *
 * Sounds are chosen per WITCH, not per region, so what the players hear is
 * the thing actually hunting them: wolves for the Isolating Pack, dripping
 * and butchery for Old Jenny, chimes for the Moon. The ids live in the
 * content module (transgression_sounds.py), because they are content.
 *
 * ---
 *
 * EVERY INTEGRATION HERE IS OPTIONAL, and each is probed separately at call
 * time. With no content module there are no ids and nothing plays; without
 * Syrinscape Controller the playlist entries are inert. The screen effect
 * needs nothing installed at all -- it is a vignette this system draws. The
 * chat message always posts. Nothing in this file is allowed to throw into
 * the caller -- a failed flourish must never stop a transgression being
 * recorded.
 *
 * ONLY THE PRIMARY GM DRIVES THIS. Syrinscape's own session sync carries
 * audio to players, and the screen effects fan out over their own modules'
 * sockets -- firing on five clients would play everything five times.
 */

import { isPrimaryGM } from '../helpers/gm.mjs';

const SETTING_ENABLED = 'transgressionFx';
const SETTING_CUE_SECONDS = 'transgressionCueSeconds';

// Injected by the darkest-woods module. Empty without it, which means this
// whole file does nothing rather than erroring.
export let TRANSGRESSION_SOUNDS = {};
export let TRANSGRESSION_FX = {};

Hooks.once('darkestSystem.registerTransgressionFx', (data) => {
  if (data?.sounds) TRANSGRESSION_SOUNDS = data.sounds;
  if (data?.fx) TRANSGRESSION_FX = data.fx;
});

/**
 * Which tier a level belongs to.
 *
 * These boundaries are NOT arbitrary and must not drift: they are the same
 * ones _publicStirMessage() uses for its wording. If they diverge, the
 * players get tier-3 words over a tier-2 sound at exactly the moment the
 * track is most dramatic.
 */
export function tierOf(level) {
  const n = Number(level) || 0;
  if (n >= 10) return 3;
  if (n >= 5) return 2;
  return 1;
}

export const TransgressionFx = {

  enabled() {
    try { return game.settings.get('darkest-system', SETTING_ENABLED) !== 'off'; }
    catch { return false; }
  },

  /** How long a cue is allowed to run, in ms, before it is stopped. */
  cueLength() {
    try {
      const s = game.settings.get('darkest-system', SETTING_CUE_SECONDS);
      return Math.max(1, Number(s) || 12) * 1000;
    } catch {
      return 12000;
    }
  },

  /**
   * Has this region got any cue at all?
   *
   * Drives whether the tracker shows a play button on the row. A custom
   * region the GM added has no witch sounds, and offering a button that can
   * only ever do nothing is worse than offering none.
   */
  hasSounds(regionSlug) {
    const tiers = TRANSGRESSION_SOUNDS[regionSlug];
    if (!tiers) return false;
    return Object.values(tiers).some(ids => Array.isArray(ids) && ids.length);
  },

  /** What the setting allows: 'off' | 'sound' | 'all'. */
  mode() {
    try { return game.settings.get('darkest-system', SETTING_ENABLED) ?? 'all'; }
    catch { return 'all'; }
  },

  /**
   * Play the escalation for a transgression that just advanced.
   *
   * Fire-and-forget by design: the caller is mid-way through recording a
   * transgression and must not wait on audio, nor fail because of it.
   */
  /**
   * @param {boolean} [verbose]  Say why nothing happened, rather than
   *   returning silently. On by default when called by hand from a macro or
   *   the console -- both guards below are legitimate reasons to do nothing
   *   during play, but when a GM is testing, "undefined and no sound" is
   *   indistinguishable from a broken feature. Passing false keeps the live
   *   path quiet.
   */
  play(regionSlug, level, { verbose = true } = {}) {
    if (!isPrimaryGM()) {
      if (verbose) console.warn('Darkest System | transgression flourish skipped: not the primary GM');
      return;
    }
    if (!this.enabled()) {
      if (verbose) console.warn(`Darkest System | transgression flourish skipped: setting is "${this.mode()}"`);
      return;
    }

    const tier = tierOf(level);
    // Awaited internally but not by the caller; every branch swallows its
    // own errors so a missing module can't surface as an unhandled rejection.
    return this._playTier(regionSlug, tier, verbose).catch(err =>
      console.warn('Darkest System | transgression flourish failed', err));
  },

  async _playTier(regionSlug, tier, verbose = false) {
    if (verbose) {
      console.log(`Darkest System | transgression flourish: ${regionSlug}, level tier ${tier}`);
      if (!Object.keys(TRANSGRESSION_SOUNDS).length) {
        console.warn('Darkest System |   no sound data registered — is the content module active and up to date?');
      } else if (!TRANSGRESSION_SOUNDS[regionSlug]) {
        console.warn(`Darkest System |   "${regionSlug}" has no stingers. Known: ${Object.keys(TRANSGRESSION_SOUNDS).join(', ')}`);
      }
    }
    // Started TOGETHER, not one after the other. _stinger awaits a document
    // update per element, which round-trips to the server; awaiting it first
    // delayed the vignette by however long that took, so the sound and the
    // darkness arrived at visibly different moments.
    const screen = this.mode() === 'all'
      ? this._screen(tier, verbose)
      : Promise.resolve();
    await Promise.all([this._stinger(regionSlug, tier, verbose), screen]);
  },

  /**
   * The Syrinscape one-shot.
   *
   * Played through a PlaylistSound exactly as scene-ambience does, not
   * through syrinscapeControl.utils directly: that API's only stop is a
   * global one that would also kill the ambience bed and anything the GM
   * started by hand. A PlaylistSound is individually controllable, carries
   * its own volume, and degrades to an inert row when the module is absent.
   *
   * Deliberately NOT stopped or tracked afterwards. These are one-shots over
   * the top of the bed; the ambience code's diff never sees them because
   * they live in a different playlist with a different contentType.
   */
  async _stinger(regionSlug, tier, verbose = false) {
    const ids = TRANSGRESSION_SOUNDS[regionSlug]?.[tier]
      ?? TRANSGRESSION_SOUNDS[regionSlug]?.[String(tier)]
      ?? [];
    if (!ids.length) {
      if (verbose) console.warn(`Darkest System |   no tier-${tier} sounds for "${regionSlug}"`);
      return;
    }

    // The playlist has to be IMPORTED INTO THE WORLD, not merely present in
    // the module's compendium -- game.playlists holds world documents only.
    // This is the likeliest reason a correctly-configured table hears
    // nothing, so it says so rather than returning quietly.
    const playlist = game.playlists?.find(
      p => p.getFlag('darkest-woods', 'audio')?.contentType === 'syrinscape-stingers'
    );
    if (!playlist) {
      if (verbose) {
        console.warn('Darkest System |   the "Transgression stingers" playlist is not in this world. '
          + 'Import it from the module\'s Playlists compendium, or run the region importer.');
      }
      return;
    }
    if (verbose) console.log(`Darkest System |   playing ${ids.length} element(s): ${ids.join(', ')}`);

    for (const id of ids) {
      const sound = playlist.sounds?.find(
        s => s.getFlag('darkest-woods', 'syrinscapeId') === id
      );
      if (!sound) {
        console.warn(`Darkest System | no stinger entry for Syrinscape element ${id}`);
        continue;
      }
      try {
        // `playing` is STATE, not a trigger. Setting it true on a sound that
        // is already true is a no-op, so the same stinger fired twice in a
        // session played once and then never again -- and the row sat lit in
        // the sidebar for the rest of the night because nothing ever set it
        // back. Syrinscape's own player has finished long before; Foundry
        // just never hears about it, since a Syrinscape sound has no local
        // audio whose `ended` event could clear the flag.
        //
        // So: force it off, then on. The off is awaited because the two
        // updates must not coalesce into a single no-op write.
        if (sound.playing) await sound.update({ playing: false, pausedTime: null });
        await sound.update({ playing: true });

        // Cut it off after the cue length. "oneshot" means "does not loop",
        // not "is short" -- several of these run long enough to talk over.
        TransgressionFx._scheduleStop(sound);
      } catch (err) {
        console.warn(`Darkest System | could not play stinger ${id}`, err);
      }
    }
  },

  /**
   * Stop a fired stinger after its allotted time.
   *
   * This is a REAL STOP, not just bookkeeping. Syrinscape Controller
   * intercepts `playing: false` on its PlaylistSound and stops the element,
   * exactly as scene-ambience._stopUuid relies on -- an earlier version of
   * this comment claimed otherwise and it was wrong.
   *
   * That matters because "oneshot" in Syrinscape's catalogue means "does not
   * loop", NOT "is short". Several perfectly good cues -- screams and roars,
   * a crushing wave, the Tomb of the Nine Gods stinger -- run far longer than
   * a punctuation mark should, and left alone they play over whatever the GM
   * says next. Cutting them at a fixed length makes every cue behave like a
   * cue regardless of the source material.
   *
   * The default gives a cue room to land without running under the next
   * thing said at the table. A GM who wants a whole soundscape has the
   * Playlists sidebar; this is the bounded version.
   */
  _scheduleStop(sound, ms = TransgressionFx.cueLength()) {
    const uuid = sound.uuid;
    clearTimeout(TransgressionFx._stopTimers.get(uuid));
    TransgressionFx._stopTimers.set(uuid, setTimeout(async () => {
      TransgressionFx._stopTimers.delete(uuid);
      try {
        const live = fromUuidSync(uuid);
        // pausedTime null: Syrinscape cannot resume, so a stop is a stop
        // rather than a pause. scene-ambience._stopUuid does the same.
        if (live?.playing) await live.update({ playing: false, pausedTime: null });
      } catch (err) {
        console.warn('Darkest System | could not clear stinger state', err);
      }
    }, ms));
  },

  /** uuid -> pending reset, so a re-trigger replaces its own timer. */
  _stopTimers: new Map(),

  /**
   * The screen effect.
   *
   * The vignette below needs nothing installed. FXMaster remains only as a
   * fallback for a client where the overlay cannot be drawn -- and its
   * filters are SCENE-PERSISTENT, so anything applied has to be removed on a
   * timer or the scene keeps it forever. region-weather.js learned that the
   * hard way.
   *
   * The global is probed rather than the module's `active` flag: a module
   * can be active before its global exists, the same race region-weather.js
   * documents for FXMaster.
   */
  // A _hasAsset() guard lived here, checking Sequencer's database before
  // playing a JB2A file. Gone with the sprite it protected: the vignette is
  // drawn by this system and has no asset to be missing.

  /**
   * Darkness closing in from the edges of the screen, then letting go.
   *
   * A single fixed-position div carrying a radial gradient: transparent at
   * the centre, opaque at the corners. Animating the gradient's inner radius
   * makes the dark advance and retreat, which is the shape of "the woods are
   * closing in" -- where a sprite in the middle of the screen was the shape
   * of "something is standing in front of you".
   *
   * pointer-events none throughout: this must never eat a click. It sits
   * above the UI so the effect reaches chat and the sidebars too, not just
   * the map canvas the way an FXMaster filter would.
   *
   * @param {object} v
   * @param {number} v.reach     how far in the darkness comes, 0..1
   * @param {number} v.hold      ms to sit at full reach
   * @param {number} v.fade      ms of the ease in and of the ease out
   * @param {string} [v.colour]  the dark, so a witch can tint it
   */
  async _vignette({ reach = 0.5, hold = 400, fade = 700, colour = '0, 0, 0' } = {}) {
    const ID = 'darkest-transgression-vignette';
    document.getElementById(ID)?.remove();   // a re-trigger replaces its own

    // `reach` drives BOTH how far in the dark comes and how heavy it gets.
    //
    // It used to drive the radius alone, against a fixed 0.95 peak opacity,
    // and the radius barely moved: reach 0.35 shifted the clear centre from
    // 45% to 29%, which is invisible on a real screen. Only tier 3 read as
    // anything, which is exactly what the table reported. Scaling opacity
    // with it as well gives the tiers somewhere to actually differ.
    //
    // The open state is 80%: a wide, faint frame rather than nothing, so the
    // fade-in has something to travel from.
    const OPEN = 80;
    const inner = Math.round(OPEN - reach * 70);        // 80% -> 10% at full reach
    const peak = Math.min(0.95, 0.35 + reach * 0.8);    // faint -> near-opaque

    const gradient = (stop, alpha) =>
      `radial-gradient(ellipse at center, rgba(${colour},0) ${stop}%, rgba(${colour},${alpha}) 100%)`;

    // TRANSFORM, not `background`.
    //
    // CSS cannot interpolate between two radial gradients -- `background` is
    // not an animatable property, in any browser. The first version animated
    // both opacity and background together, so the gradient SNAPPED and only
    // the fade was real. Tier 3 still read, because 0.95 alpha is obvious
    // even when it appears instantly; tiers 1 and 2 at 0.59 and 0.79 faded in
    // and out too fast to notice. That is exactly the "only tier 3 does
    // anything" the table saw, and it is why raising the reach values alone
    // did not fix it.
    //
    // So the gradient is painted ONCE at its closed-in size, and the element
    // is scaled instead. transform and opacity are both compositor
    // properties: they interpolate smoothly and cost nothing per frame.
    // Starting oversized and settling to 1 makes the dark travel inward.
    const OPEN_SCALE = 1 + (OPEN - inner) / 100;   // wider when reach is deeper

    const el = document.createElement('div');
    el.id = ID;
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1000',              // above the UI, below dialogs
      pointerEvents: 'none',
      opacity: '0',
      willChange: 'opacity, transform',
      transform: `scale(${OPEN_SCALE})`,
      transition: `opacity ${fade}ms ease-in-out, transform ${fade}ms ease-in-out`,
      background: gradient(inner, peak),
    });
    document.body.appendChild(el);

    // Two frames before the first change, or the browser folds the initial
    // style and the transition into one paint and nothing animates.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Closing in: the oversized gradient settles to its true size.
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';

    await new Promise(r => setTimeout(r, fade + hold));

    // And letting go, back out the way it came.
    el.style.opacity = '0';
    el.style.transform = `scale(${OPEN_SCALE})`;

    await new Promise(r => setTimeout(r, fade));
    el.remove();
  },

  async _screen(tier, verbose = false) {
    const spec = TRANSGRESSION_FX[tier] ?? TRANSGRESSION_FX[String(tier)];
    if (!spec) {
      // Tier 1 is deliberately silent on screen; anything else means the
      // module's fx data didn't arrive.
      if (verbose && tier !== 1) {
        console.warn(`Darkest System |   no screen effect defined for tier ${tier}`);
      }
      return;
    }

    if (verbose) {
      console.log('Darkest System |   vignette:', !!spec.vignette,
        '| FXMaster fallback:', !!(globalThis.FXMASTER ?? globalThis.FXMaster));
    }

    // The vignette, drawn by this system rather than by a module.
    //
    // This replaced a JB2A sprite played through Sequencer, which put a round
    // black blob in the middle of the screen -- one centred sprite, whatever
    // the screen's shape. What the woods closing in actually wants is the
    // EDGES darkening, and that is a radial gradient, not a picture.
    //
    // Drawing it here means no JB2A, no Sequencer, nothing to 404, nothing to
    // install, and it covers the whole viewport by construction. FXMaster is
    // still tried below when this is unavailable for any reason.
    if (spec.vignette) {
      try {
        await TransgressionFx._vignette(spec.vignette);
        return;
      } catch (err) {
        console.warn('Darkest System | vignette failed, trying FXMaster', err);
      }
    }

    const fx = globalThis.FXMASTER ?? globalThis.FXMaster;
    if (!fx || !spec.fxmaster) return;
    try {
      const name = `darkest-transgression-${tier}`;
      await FXMASTER.filters.addFilter(name, spec.fxmaster.filter, spec.fxmaster.options ?? {});
      // Removed on a timer. An FXMaster filter is stored on the SCENE, so
      // one left behind would tint every session from here on.
      setTimeout(() => {
        FXMASTER.filters.removeFilter(name)
          .catch(err => console.warn('Darkest System | could not clear transgression filter', err));
      }, spec.durationMs ?? 2000);
    } catch (err) {
      console.warn('Darkest System | FXMaster effect failed', err);
    }
  },
};

export function registerTransgressionFxSettings() {
  game.settings.register('darkest-system', SETTING_ENABLED, {
    name: 'Transgression stingers',
    hint: 'What the speaker button on each row of the Transgression Tracker plays: a sound chosen for that region\'s witch, and from level 5 a brief mark on the screen. Tiers follow the track and match the chat message — 1–4, 5–9, and 10. Triggered by you, never automatically, so a Darkest Die landing mid-sentence does not step on the table. Needs the content module for the sounds and Syrinscape Controller to play them; the screen effect needs nothing. Anything missing is simply skipped.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      all: 'Sound and screen effects',
      sound: 'Sound only',
      off: 'Off',
    },
    default: 'all',
  });

  // Syrinscape's "oneshot" means "does not loop", NOT "is short" -- several
  // of the chosen cues run long enough to talk over. Rather than restrict the
  // selection to brief sounds (which would rule out most of the good ones,
  // and the catalogue does not publish durations to select on anyway), every
  // cue is cut off after this long.
  game.settings.register('darkest-system', SETTING_CUE_SECONDS, {
    name: 'Transgression cue length',
    hint: 'How long a transgression cue plays before it is stopped, in seconds. Syrinscape labels these one-shots, which only means they do not loop — several run far longer than a sting should. 12 lets a cue breathe without talking over the table; drop it to 5 or 6 if you want sharper punctuation.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 2, max: 30, step: 1 },
    default: 12,
  });
}
