/**
 * Scene darkness driven by the world clock.
 *
 * Every scene the module ships is fully lit, permanently, in a game whose
 * central premise is that the light is dying. Meanwhile the travel clock
 * already models the daylight decay precisely -- days shorten until dusk and
 * night merge and the sun stops rising at all. This connects the two.
 *
 * The phase cycle is the obvious part. The real payoff is the DECAY: as the
 * daylight window shrinks, midday itself stops reaching full brightness, so
 * by the time the sun no longer rises the brightest hour of the day is
 * dusk-level. Players watch the world dim across the campaign without ever
 * being told a number.
 *
 * Off by default. It is easy to overdo, and a GM who has lit their scenes by
 * hand should never have that work overwritten -- see the ownership flag
 * below.
 */

import { TravelClock } from './travel-clock.mjs';
import { isPrimaryGM } from '../helpers/gm.mjs';

const SETTING_ENABLED = 'sceneDarkness';
const SETTING_INTENSITY = 'sceneDarknessIntensity';

/** Marks a scene as ours to manage. Absent = the GM owns its lighting. */
const OWNED_FLAG = 'autoDarkness';

// Deliberately short of 1.0 even at night: this is a mood layer, not a
// vision mechanic. No scene has walls or token light sources, so full dark
// would just make the map unreadable rather than atmospheric.
const PHASE_DARKNESS = {
  day: 0.0,
  dawn: 0.35,
  dusk: 0.55,
  night: 0.85,
};

const ANIMATE_MS = 4000;

export const SceneDarkness = {

  enabled() {
    try {
      return game.settings.get('darkest-system', SETTING_ENABLED) === true;
    } catch {
      return false;
    }
  },

  intensity() {
    try {
      const v = game.settings.get('darkest-system', SETTING_INTENSITY);
      return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0.8;
    } catch {
      return 0.8;
    }
  },

  /**
   * Darkness for the current clock state, 0-1.
   *
   * Reads displayState() rather than recomputing the phase, so fixed-time
   * regions (the Road's endless night) are honoured for free.
   */
  currentLevel() {
    const state = TravelClock.displayState();
    const base = PHASE_DARKNESS[state.phase] ?? 0;
    return Math.round(base * SceneDarkness.intensity() * 100) / 100;
  },

  /**
   * Apply to the active scene.
   *
   * Only the primary GM writes -- a scene update from several GM clients at
   * once would fight. Everyone else simply sees the result.
   */
  async apply({ force = false } = {}) {
    if (!isPrimaryGM()) return;
    const scene = canvas?.scene;
    if (!scene) return;

    // The travelling scene is not a place, it's a transition. Its art carries
    // its own light, so dimming it by the clock would darken a card rather
    // than a sky. Guarding here rather than at the travelArrive hook because
    // canvasReady and clockChanged both reach this too -- activating it for a
    // hold fires the first, and time passing during the roleplay fires the
    // second.
    // Matched by FLAG as well as by the stored uuid. The travelling scene now
    // falls back to the content module's own when the GM has chosen nothing
    // (see TravelTool.travelScene), so a uuid comparison alone stopped
    // recognising it -- and the clock would then darken a stylised woodcut
    // road as though it were a sky.
    try {
      if (scene.getFlag('darkest-woods', 'contentType') === 'travel') return;
      const travelUuid = game.settings.get('darkest-system', 'travelSceneUuid');
      if (travelUuid && scene.uuid === travelUuid) return;
    } catch { /* setting not registered yet; nothing to exclude */ }

    if (!SceneDarkness.enabled()) return;

    // Never touch a scene the GM has lit themselves. We only manage scenes
    // we have previously claimed, or ones still at Foundry's default.
    const owned = scene.getFlag('darkest-system', OWNED_FLAG) === true;
    const current = scene.environment?.darknessLevel ?? 0;
    if (!owned && current !== 0 && !force) return;

    const level = SceneDarkness.currentLevel();
    if (!force && owned && Math.abs(current - level) < 0.01) return;

    try {
      // v12 migrated Scene#darkness to Scene#environment.darknessLevel and
      // v14 removed the compatibility shim, so the nested path is the only
      // one that works here. animateDarkness eases the change instead of
      // snapping it.
      await scene.update(
        { 'environment.darknessLevel': level, [`flags.darkest-system.${OWNED_FLAG}`]: true },
        { animateDarkness: ANIMATE_MS }
      );
    } catch (err) {
      console.warn('Darkest System | could not set scene darkness', err);
    }
  },

  // A release() lived here to hand a scene back to the GM by clearing
  // OWNED_FLAG. Nothing called it and no UI offered it. The flag is set the
  // first time the clock dims a scene and is only ever read to decide whether
  // this system owns that scene's darkness -- so the way to take a scene back
  // is to turn the setting off, which is the control the GM already has.
};

export function registerSceneDarknessSettings() {
  game.settings.register('darkest-system', SETTING_ENABLED, {
    name: 'Darken scenes with the clock',
    hint: 'Scenes dim through dawn, dusk and night — and as the days shorten, even midday stops reaching full light. Only affects scenes this system manages; anything you have lit by hand is left alone.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => SceneDarkness.apply({ force: true }),
  });

  game.settings.register('darkest-system', SETTING_INTENSITY, {
    name: 'Scene darkness intensity',
    hint: 'How far the dimming goes. 1 is the full curve (night is deeply gloomy but still readable); lower values keep it subtle. 0 disables it.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8,
    onChange: () => SceneDarkness.apply({ force: true }),
  });
}

export function registerSceneDarknessHooks() {
  // A new canvas, or the party arriving somewhere.
  Hooks.on('canvasReady', () => SceneDarkness.apply());
  Hooks.on('darkestSystem.travelArrive', () => SceneDarkness.apply());
  // Time passing in place should darken the scene the party is standing in.
  Hooks.on('darkestSystem.clockChanged', () => SceneDarkness.apply());
}
