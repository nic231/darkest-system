/**
 * Syrinscape scene ambience.
 *
 * Each place has a layered soundscape rather than one file: a core that runs
 * whatever the hour, a `light` layer for dawn/day/dusk, a `dark` layer for
 * night, and a `sunless` layer that is ADDED once dusk and night have merged
 * on day 6. Only the layers that change are touched, so the core never
 * restarts and a phase change has no audible seam.
 *
 * ---
 *
 * WHY PLAYLISTS RATHER THAN THE SYRINSCAPE API
 *
 * Calling `syrinscapeControl.utils.playElement(id)` directly works, but the
 * only stop it offers is a global one that would also kill anything the GM
 * started by hand. Syrinscape Controller already solves this: a normal
 * Foundry PlaylistSound carrying
 *
 *     flags['syrinscape-control'].soundType   'element' | 'mood'
 *     flags['syrinscape-control'].soundId     4251062
 *
 * is played through its SyrinscapeSound wrapper, so it behaves like any other
 * Foundry sound -- individual play/stop, per-sound volume, fade, and the whole
 * Playlists sidebar. The build script generates one playlist per region; this
 * file only ever plays and stops documents.
 *
 * That also means the GM can audition or override any element from the
 * sidebar without waiting on a rebuild, and that the whole thing degrades to
 * inert playlist entries when Syrinscape Controller isn't installed.
 *
 * ---
 *
 * ONLY THE PRIMARY GM DRIVES THIS. Syrinscape's own session sync carries the
 * audio to players -- fanning out over our socket would make five clients
 * fire the same sounds at one Syrinscape account.
 */

import { TravelClock, TravelTool } from './travel-clock.mjs';
import { isPrimaryGM } from '../helpers/gm.mjs';

const SETTING_ENABLED = 'sceneAmbienceEnabled';
const SETTING_VOLUME = 'sceneAmbienceVolume';

// Assignments injected by the darkest-woods module. Empty without it, which
// means silence rather than an error.
export let REGION_AMBIENCE = {};
export let SCENE_AMBIENCE = {};

Hooks.once('darkestSystem.registerAmbience', (data) => {
  if (data?.regions) REGION_AMBIENCE = data.regions;
  if (data?.scenes) SCENE_AMBIENCE = data.scenes;
});

/**
 * What is playing right now.
 *   cue    the soundscape key, so we can tell "same place" from "moved"
 *   ids    Map of Syrinscape id -> the uuid of the PlaylistSound WE started
 *
 * The uuid is stored per id rather than a single region for the whole set.
 * The same element can appear in several regions' playlists, so after the
 * party crosses a border, re-resolving by region would find a DIFFERENT
 * document than the one actually sounding -- stopping the wrong copy and
 * leaving the real one playing forever with nothing holding a handle to it.
 */
let _playing = { cue: null, ids: new Map() };
// Serialises apply() calls. Scene change and clock change can land in the
// same tick, and two interleaved runs would each diff against a stale
// _playing and fight over what's started.
let _queue = Promise.resolve();
// Guards against stacking several unlock listeners when the GM toggles the
// setting a few times before clicking anything.
let _unlockArmed = false;

export const SceneAmbience = {

  enabled() {
    try {
      return game.settings.get('darkest-system', SETTING_ENABLED) === true;
    } catch {
      return false;
    }
  },

  volume() {
    try {
      const v = game.settings.get('darkest-system', SETTING_VOLUME);
      return typeof v === 'number' ? v : 0.5;
    } catch {
      return 0.5;
    }
  },

  /**
   * Is Syrinscape Controller actually there?
   *
   * Probes the global rather than game.modules.get(...).active: the module
   * can be active before its global exists, the same race region-weather.js
   * documents for FXMaster.
   */
  available() {
    return !!globalThis.syrinscapeControl?.utils?.playElement;
  },

  /**
   * Which layers should be audible at this moment.
   *
   * `light` deliberately spans dawn, day AND dusk -- birds are most active at
   * dawn and dusk, so this is "whenever there is any light at all" rather
   * than "daytime". `sunless` is additive: from day 6 the sun never rises,
   * and what plays over the endless dusk is what makes that wrong.
   */
  activeLayers() {
    const state = TravelClock.displayState();
    const layers = ['core'];
    if (state.phase === 'night') layers.push('dark');
    else layers.push('light');
    if (state.merged) layers.push('sunless');
    return layers;
  },

  /**
   * The soundscape for a scene: its own if it has one, else its region's.
   *
   * Returns { cue, region, layers, own } -- cue identifies the soundscape so
   * moving between two places that resolve to the same bed can be detected
   * and left alone.
   */
  resolve(scene = canvas?.scene) {
    if (!scene) return null;
    const slug = scene.getFlag('darkest-woods', 'locationSlug');
    let region = scene.getFlag('darkest-woods', 'region');

    if (slug && SCENE_AMBIENCE[slug]) {
      return { cue: `scene:${slug}`, region, layers: SCENE_AMBIENCE[slug], own: true };
    }

    // The travelling scene is generic -- it stands in for every region, so
    // it carries no region flag of its own and would otherwise resolve to
    // nothing, silencing the road for the whole roleplay scene.
    //
    // While a journey is held, the party is somewhere: the ground they're
    // crossing, which the hold recorded when they set out. Play that bed, so
    // the woods keep sounding around them while they talk.
    if (!region) {
      const hold = TravelTool.getHold?.();
      if (hold?.region) region = hold.region;
    }

    if (region && REGION_AMBIENCE[region]) {
      return { cue: `region:${region}`, region, layers: REGION_AMBIENCE[region], own: false };
    }
    return null;
  },

  /** The ids that should be sounding right now, given the clock. */
  wantedIds(resolved) {
    const ids = new Set();
    if (!resolved) return ids;
    for (const layer of SceneAmbience.activeLayers()) {
      for (const id of (resolved.layers[layer] ?? [])) ids.add(id);
    }
    return ids;
  },

  /**
   * Find the PlaylistSound document for a Syrinscape id.
   *
   * Searched by flag rather than by name so the GM can rename anything in the
   * sidebar without breaking it. Preferring the region's own playlist keeps
   * per-region volume tweaks meaningful when the same element appears in two.
   */
  findSound(id, region) {
    const lists = game.playlists?.filter(
      p => p.getFlag('darkest-woods', 'audio')?.contentType === 'syrinscape-ambience'
    ) ?? [];
    const mine = lists.filter(p => p.getFlag('darkest-woods', 'audio')?.region === region);
    for (const playlist of [...mine, ...lists]) {
      const sound = playlist.sounds?.find(
        s => s.getFlag('darkest-woods', 'syrinscapeId') === id
      );
      if (sound) return sound;
    }
    return null;
  },

  /**
   * Bring the soundscape into line with where the party is and what time it is.
   *
   * Queued rather than run directly: a travel arrival fires both a scene
   * change and a clock change, and two overlapping runs would each diff
   * against a stale picture of what's playing.
   */
  apply(opts = {}) {
    _queue = _queue.then(() => SceneAmbience._applyUnsafe(opts)).catch(err => {
      console.error('Darkest System | scene ambience failed', err);
    });
    return _queue;
  },

  async _applyUnsafe({ force = false } = {}) {
    // Every bail below is silent by design -- none of them is an error, and
    // a GM without Syrinscape shouldn't see warnings. But silent-by-design
    // made "nothing happens" impossible to diagnose from the table, so each
    // one now says why at debug level. Turn on with:
    //   CONFIG.debug.darkestAmbience = true
    const log = (msg) => {
      if (CONFIG.debug?.darkestAmbience) console.log(`Darkest System | ambience: ${msg}`);
    };

    if (!isPrimaryGM()) return log('not the primary GM');

    if (!SceneAmbience.enabled()) {
      log('setting is off — stopping anything we started');
      await SceneAmbience.stopAll();
      return;
    }
    // Nothing to play through. Not an error -- the GM may simply not use
    // Syrinscape, in which case this whole subsystem stays dormant.
    if (!SceneAmbience.available()) return log('syrinscapeControl global not available');
    // Foundry refuses to build a Sound before the first user gesture, and
    // Syrinscape Controller's _createSound() throws outright if we try.
    if (game.audio?.locked) {
      // Arm the watcher here too: whatever triggered this apply (a scene
      // change, say) happened before the user clicked, and without this
      // nothing would retry once audio unlocks.
      SceneAmbience.armAudioUnlock();
      return log('Foundry audio still locked — will retry after the first click');
    }

    const resolved = SceneAmbience.resolve();
    const wanted = SceneAmbience.wantedIds(resolved);
    log(resolved
      ? `${resolved.cue} — ${wanted.size} element(s) wanted, ${_playing.ids.size} playing`
      : `no soundscape for scene "${canvas?.scene?.name}"`);

    // Same soundscape, same layers: leave it completely alone. This is what
    // stops the bed stuttering as the party moves between two locations in
    // the same region.
    const sameCue = resolved?.cue === _playing.cue;
    if (!force && sameCue && sameIds(wanted, _playing.ids)) return;

    // Stop only what WE started and no longer want. Anything the GM launched
    // by hand is untouched -- we never call stopAll() on Syrinscape.
    for (const [id, uuid] of [..._playing.ids]) {
      if (wanted.has(id)) continue;
      await SceneAmbience._stopUuid(uuid);
      _playing.ids.delete(id);
    }

    for (const id of wanted) {
      if (_playing.ids.has(id)) continue;   // already running: don't restart
      const uuid = await SceneAmbience._playId(id, resolved.region);
      if (uuid) _playing.ids.set(id, uuid);
    }

    _playing.cue = resolved?.cue ?? null;
  },

  /** Start an element. Returns the uuid of the sound we started, or null. */
  async _playId(id, region) {
    const sound = SceneAmbience.findSound(id, region);
    if (!sound) {
      console.warn(`Darkest System | no playlist entry for Syrinscape element ${id}`);
      return null;
    }
    try {
      await sound.update({ playing: true, volume: SceneAmbience.volume() });
      return sound.uuid;
    } catch (err) {
      console.warn(`Darkest System | could not start Syrinscape element ${id}`, err);
      return null;
    }
  },

  /**
   * Stop the exact sound we started, by uuid.
   *
   * By uuid rather than by id+region: the party may have moved on since, and
   * re-resolving would find whichever copy the CURRENT region happens to
   * hold -- which can be a different document than the one actually playing.
   */
  async _stopUuid(uuid) {
    if (!uuid) return;
    try {
      const sound = fromUuidSync(uuid);
      if (!sound) return;
      // pausedTime null because Syrinscape can't resume -- stopping is a
      // stop, not a pause. Its own _preUpdate does this too; being explicit
      // means we behave the same without the module installed.
      await sound.update({ playing: false, pausedTime: null });
    } catch (err) {
      console.warn(`Darkest System | could not stop Syrinscape sound ${uuid}`, err);
    }
  },

  /** Silence everything this system started. Never touches the GM's own. */
  async stopAll() {
    for (const uuid of [..._playing.ids.values()]) {
      await SceneAmbience._stopUuid(uuid);
    }
    _playing = { cue: null, ids: new Map() };
  },

  /**
   * What's playing and why, for the travel tool's readout. Diagnoses silence
   * without opening a console.
   */
  status() {
    const resolved = SceneAmbience.resolve();
    if (!SceneAmbience.enabled()) return { text: 'Off', detail: null };
    if (!SceneAmbience.available()) return { text: 'Syrinscape not connected', detail: null };
    if (game.audio?.locked) return { text: 'Waiting for audio', detail: 'Click anywhere to start sound.' };
    if (!resolved) return { text: 'Nothing assigned here', detail: null };
    const where = resolved.own ? 'its own soundscape' : 'the region bed';
    const layers = SceneAmbience.activeLayers().join(' + ');
    return {
      text: `${_playing.ids.size} playing — ${where}`,
      detail: layers,
    };
  },

  /**
   * Wait for the browser's audio unlock, then apply.
   *
   * Foundry blocks all audio until the user has interacted with the page, so
   * on a fresh load canvasReady almost always fires while still locked. Both
   * signals are watched because either can come first, and both are `once`
   * so nothing accumulates. Idempotent -- safe to call again from onChange.
   */
  armAudioUnlock() {
    if (!game.audio?.locked || _unlockArmed) return;
    _unlockArmed = true;
    const go = () => { _unlockArmed = false; SceneAmbience.apply({ force: true }); };
    Hooks.once('globalInterfaceVolumeChanged', go);
    document.addEventListener('click', go, { once: true });
  },

  /** Test an assignment by hand: game.darkestSystem.Ambience.preview([ids]) */
  async preview(ids = []) {
    for (const id of ids) await SceneAmbience._playId(id, null);
  },
};

/**
 * Do these hold the same ids?
 *
 * `wanted` is a Set of ids; `playing` is a Map of id -> sound uuid. Only the
 * KEYS are compared, which is why iteration is over the Set and lookups go
 * through .has() -- both work the same on either type, but relying on that
 * accidentally would break the moment someone iterated the Map instead.
 */
function sameIds(wanted, playing) {
  if (wanted.size !== playing.size) return false;
  for (const id of wanted) if (!playing.has(id)) return false;
  return true;
}

export function registerSceneAmbienceSettings() {
  game.settings.register('darkest-system', SETTING_ENABLED, {
    name: 'Syrinscape scene ambience',
    hint: 'Play a layered soundscape for wherever the party is, changing as they travel and as the day turns. Needs the Syrinscape Controller module and the content module. Sounds you start yourself are never stopped by this.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      // Turning this on before the first click leaves audio locked, so arm
      // the unlock watcher as well as trying immediately.
      SceneAmbience.armAudioUnlock();
      SceneAmbience.apply({ force: true });
    },
  });

  game.settings.register('darkest-system', SETTING_VOLUME, {
    name: 'Scene ambience volume',
    hint: 'Volume for automatically played ambience, on the Environment channel.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.5,
    onChange: () => SceneAmbience.apply({ force: true }),
  });
}

export function registerSceneAmbienceHooks() {
  // A new canvas: the party moved, or the world just loaded.
  Hooks.on('canvasReady', () => SceneAmbience.apply());
  // Arriving somewhere, and time passing where they stand -- the second is
  // what swaps the day layer for the night one without anyone moving.
  Hooks.on('darkestSystem.travelArrive', () => SceneAmbience.apply());
  Hooks.on('darkestSystem.clockChanged', () => SceneAmbience.apply());

  // NOT Hooks.once('ready', ...).
  //
  // registerSceneAmbienceHooks() is itself called from inside the system's
  // Hooks.once('ready') handler, and Foundry does not replay a hook that has
  // already fired -- so a 'ready' listener registered here never ran at all.
  // That silently killed both the startup apply() AND armAudioUnlock(),
  // which is why enabling the setting mid-session left nothing waiting for
  // the browser's audio unlock.
  //
  // We are already inside ready by definition, so just do the work now.
  SceneAmbience.armAudioUnlock();
  SceneAmbience.apply();
}
