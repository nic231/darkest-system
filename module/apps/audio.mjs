/**
 * Audio for The Darkest Woods.
 *
 * Two things play through here: birdsong recordings the party listens to,
 * and the ambient bed under a travel transition. Both are optional -- the
 * system works in silence if no files are supplied.
 *
 * Sounds come from the content module, discovered by playlist flag, and
 * play on the ENVIRONMENT channel so they sit under Foundry's own ambient
 * volume slider rather than the interface channel dice clicks use. Missing
 * audio is silence, never an error.
 *
 * ---
 *
 * On Syrinscape, for whoever picks this up next:
 *
 * A passthrough was written here and removed. It probed
 * `game.syrinscape.playElement`, which belongs to **SyrinControl** -- a
 * different module from the **Syrinscape Controller** actually in use, so it
 * could never have fired. The real API, from that module's source and its own
 * macro generator, is:
 *
 *     globalThis.syrinscapeControl.utils.playMood(id)     // 'm:' prefix, loops
 *     globalThis.syrinscapeControl.utils.playElement(id)  // 'e:' prefix, one-shot
 *     ...stopMood(id) / .stopElement(id) / .stopAll()
 *
 * Probe the **global**, not `game.modules.get('syrinscape-control')?.active`:
 * the module can be active before its global exists, the same race
 * region-weather.js documents for FXMaster. Pass ids through with their
 * prefix intact -- the module strips `m:`/`e:` itself, and coercing with
 * Number() destroys them.
 *
 * It is shelved rather than finished because remote players only hear
 * Syrinscape audio if the GM has a **SuperSyrin** subscription (players
 * themselves need just a free account and one invite link). Without that tier
 * it plays on the GM's machine alone, so local files remain the only route
 * that reaches the table.
 */

const SETTING_AMBIENCE_VOLUME = 'ambienceVolume';
const SETTING_BIRDSONG_VOLUME = 'birdsongVolume';

/**
 * Play a sound on the environment channel.
 *
 * `AudioHelper.play`'s static form takes `channel` (a CONST.AUDIO_CHANNELS
 * string) -- NOT `context`, which on the instance method is a real
 * AudioContext object. Getting those confused silently drops the sound onto
 * the interface channel.
 *
 * Namespaced `foundry.audio.AudioHelper` is preferred; the bare global is
 * deprecated in v13+ but kept as a fallback for older cores.
 *
 * RETURNS A PROMISE, despite the core docblock claiming `{Sound|void}`.
 * `AudioHelper.play` is static and not itself async, but its last statement
 * is `return game.audio.play(...)` -- the INSTANCE method, which is async.
 * So anything that wants to fade or stop this sound later has to resolve it
 * first; calling .fade() on the return value directly silently does nothing.
 *
 * @returns {Promise<Sound>|null} The pending sound, or null if it can't play.
 */
function playLocal(src, volume, { loop = false } = {}) {
  if (!src || volume <= 0) return null;
  const Helper = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
  if (!Helper?.play) return null;
  try {
    // socketOptions false: callers fan out over our own socket, so letting
    // Foundry broadcast as well would double every sound.
    return Helper.play({ src, volume, loop, autoplay: true, channel: 'environment' }, false);
  } catch (err) {
    console.warn('Darkest System | audio playback failed', src, err);
    return null;
  }
}

function volume(key, fallback) {
  try {
    const v = game.settings.get('darkest-system', key);
    return typeof v === 'number' ? v : fallback;
  } catch {
    return fallback;
  }
}

export const DarkestAudio = {

  /**
   * Find a sound file the content module supplied.
   *
   * Playlists are flagged by the build script with a contentType and a key
   * ('birdsong' + bird, or 'travel-ambience' + region/mode). Looking them up
   * by flag rather than by path keeps every filename in the module where it
   * belongs -- the system never hard-codes content.
   */
  findSound(contentType, key) {
    const playlist = game.playlists?.find(p => {
      const f = p.getFlag('darkest-woods', 'audio');
      return f?.contentType === contentType;
    });
    if (!playlist) return null;
    const sound = playlist.sounds?.find(s => s.getFlag?.('darkest-woods', 'key') === key)
      ?? playlist.sounds?.find(s => s.name?.toLowerCase().includes(String(key).toLowerCase()));
    return sound?.path ?? null;
  },

  /** Is there anything to play for this bird? Drives the play button. */
  hasBirdsong(birdKey) {
    return !!DarkestAudio.findSound('birdsong', birdKey);
  },

  /**
   * A birdsong, played for everyone. Returns true if anything played.
   *
   * The `!!` is deliberate here, unlike in playTravelAmbience: a birdsong is
   * fire-and-forget, so the caller only needs to know a file was found. It
   * coerces a Promise, so it means "playback started", not "playback
   * succeeded" -- fine for a one-shot nobody needs to stop.
   */
  playBirdsong(birdKey) {
    const src = DarkestAudio.findSound('birdsong', birdKey);
    if (!src) return false;
    return !!playLocal(src, volume(SETTING_BIRDSONG_VOLUME, 0.7));
  },

  /**
   * The ambient bed under a travel transition.
   *
   * Resolution cascades the same way the arrival text does: the most
   * specific thing that exists wins, and missing files are silence rather
   * than an error. Mode beats region because poling a pirogue through the
   * Dismal sounds nothing like walking it.
   *
   * Returns the pending Sound (a PROMISE -- see playLocal) so the caller can
   * fade it out on arrival. This used to return a bare boolean, which made
   * the fade-out in showTransitionVeil() dead code and left the bed playing
   * over the destination scene until the file ran out.
   *
   * `loop` is for the hold-for-roleplay mode: that pause is open-ended, so a
   * one-shot bed would run out mid-conversation.
   */
  playTravelAmbience({ region, mode, loop = false } = {}) {
    // Cue keys are hyphenated to match the filename convention exactly --
    // travel-the-dismal-boat.ogg yields the key "the-dismal-boat", so the
    // most specific cue must be built the same way rather than with a
    // separator the build script never produces.
    const cues = [];
    if (mode && region) cues.push(`${region}-${mode}`);
    if (mode) cues.push(mode);
    if (region) cues.push(region);
    cues.push('default');

    for (const cue of cues) {
      const src = DarkestAudio.findSound('travel-ambience', cue);
      if (src) return playLocal(src, volume(SETTING_AMBIENCE_VOLUME, 0.5), { loop });
    }
    return null;
  },
};

export function registerAudioSettings() {
  game.settings.register('darkest-system', SETTING_AMBIENCE_VOLUME, {
    name: 'Travel ambience volume',
    hint: 'Volume of the ambient sound under a travel transition, on the Environment channel. 0 disables it.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.5,
  });

  game.settings.register('darkest-system', SETTING_BIRDSONG_VOLUME, {
    name: 'Birdsong volume',
    hint: 'Volume of birdsong recordings played from the travel tool, on the Environment channel. 0 disables them.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.7,
  });

}
