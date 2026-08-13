/**
 * The woods getting worse.
 *
 * The transgression track already escalates in words -- _publicStirMessage()
 * steps its wording at 5 and 10 -- but for a long time nothing else did. This
 * puts a sound and a screen effect under those same two steps, so one
 * escalation is felt three ways rather than three schedules being kept in
 * sync.
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
 * Syrinscape Controller the playlist entries are inert; without FXMaster or
 * Sequencer the screen simply doesn't change. The chat message always posts.
 * Nothing in this file is allowed to throw into the caller -- a failed
 * flourish must never stop a transgression being recorded.
 *
 * ONLY THE PRIMARY GM DRIVES THIS. Syrinscape's own session sync carries
 * audio to players, and the screen effects fan out over their own modules'
 * sockets -- firing on five clients would play everything five times.
 */

import { isPrimaryGM } from '../helpers/gm.mjs';

const SETTING_ENABLED = 'transgressionFx';

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
  play(regionSlug, level) {
    if (!isPrimaryGM()) return;
    if (!this.enabled()) return;

    const tier = tierOf(level);
    // Awaited internally but not by the caller; every branch swallows its
    // own errors so a missing module can't surface as an unhandled rejection.
    this._playTier(regionSlug, tier).catch(err =>
      console.warn('Darkest System | transgression flourish failed', err));
  },

  async _playTier(regionSlug, tier) {
    await this._stinger(regionSlug, tier);
    if (this.mode() === 'all') await this._screen(tier);
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
  async _stinger(regionSlug, tier) {
    const ids = TRANSGRESSION_SOUNDS[regionSlug]?.[tier]
      ?? TRANSGRESSION_SOUNDS[regionSlug]?.[String(tier)]
      ?? [];
    if (!ids.length) return;

    const playlist = game.playlists?.find(
      p => p.getFlag('darkest-woods', 'audio')?.contentType === 'syrinscape-stingers'
    );
    if (!playlist) return;

    for (const id of ids) {
      const sound = playlist.sounds?.find(
        s => s.getFlag('darkest-woods', 'syrinscapeId') === id
      );
      if (!sound) {
        console.warn(`Darkest System | no stinger entry for Syrinscape element ${id}`);
        continue;
      }
      try {
        await sound.update({ playing: true });
      } catch (err) {
        console.warn(`Darkest System | could not play stinger ${id}`, err);
      }
    }
  },

  /**
   * The screen effect, through whichever FX module is installed.
   *
   * Sequencer is preferred where present: it plays a timed effect and cleans
   * up after itself, which is exactly the shape wanted here. FXMaster is the
   * fallback because it is already a soft dependency for region weather --
   * but its filters are SCENE-PERSISTENT, so anything applied has to be
   * removed on a timer or the scene keeps it forever. region-weather.js
   * learned that the hard way.
   *
   * Both globals are probed rather than the module's `active` flag: a module
   * can be active before its global exists, the same race region-weather.js
   * documents for FXMaster.
   */
  async _screen(tier) {
    const spec = TRANSGRESSION_FX[tier] ?? TRANSGRESSION_FX[String(tier)];
    if (!spec) return;   // tier 1 is deliberately silent on screen

    if (globalThis.Sequence && spec.sequencer) {
      try {
        await new Sequence()
          .effect()
          .file(spec.sequencer.effect)
          .screenSpace()
          .screenSpaceAboveUI()
          .opacity(spec.sequencer.opacity ?? 0.4)
          .duration(spec.sequencer.duration ?? 2000)
          .fadeOut(spec.sequencer.fadeOut ?? 800)
          .play();
        return;
      } catch (err) {
        // Most likely a missing effect file (JB2A not installed, or the free
        // version lacking this one). Fall through to FXMaster rather than
        // leaving the tier with no visual at all.
        console.warn('Darkest System | Sequencer effect failed, trying FXMaster', err);
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
    hint: 'As a region\'s transgression track rises, play a sound chosen for that region\'s witch — and, at level 5 and above, briefly mark the screen. Tiers match the chat message: 1–4, 5–9, and 10. Needs the content module for the sounds, Syrinscape Controller to play them, and Sequencer or FXMaster for the screen effect; anything missing is simply skipped.',
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
}
