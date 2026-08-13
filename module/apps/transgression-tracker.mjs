/**
 * Transgression Tracker / House Action Tracker Application
 * GM-only window for tracking transgression levels (Darkest Woods) or
 * house action escalation (Darkest House).
 */
import { TravelClock, BIRDSONGS } from './travel-clock.mjs';
import { SessionLog } from './session-log.mjs';

const SETTING_DAMPING_MODE = 'transgressionDamping';
const SETTING_DAMPING_MINUTES = 'transgressionCooldownMinutes';
const SETTING_DAMPING_ROLLS = 'transgressionCooldownRolls';
const SETTING_DAMPING_THRESHOLD = 'transgressionThreshold';
const SETTING_DAMPING_STATE = 'transgressionDampingState';
const SETTING_CONFIRM = 'transgressionConfirm';

// Content placeholders — populated by the darkest-woods module if installed,
// or customised manually by the GM via the tracker UI.
export let HOUSE_ACTIONS = Array(10).fill('');
export let WITCHES = {};

// Allow companion modules to inject content via a hook before the tracker is used.
Hooks.once('darkestSystem.registerTransgressionContent', (data) => {
  if (data.houseActions) HOUSE_ACTIONS = data.houseActions;
  if (data.witches) WITCHES = data.witches;
});

export class TransgressionTracker extends Application {

  /** Serialises damping-state writes; see _checkDamping(). */
  static _dampingQueue = Promise.resolve();
  // Separate from _dampingQueue: different setting, different critical
  // section. See _advanceLevel().
  static _levelQueue = Promise.resolve();

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'transgression-tracker',
      title: 'Transgression Tracker',
      template: 'systems/darkest-system/templates/apps/transgression-tracker.hbs',
      classes: ['darkest-system', 'transgression-tracker'],
      width: 660,
      height: 'auto',
      resizable: true,
      minimizable: true,
      // Every increment/decrement/reset/toggle click calls this.render(),
      // which otherwise resets scroll to the top -- annoying with several
      // regions expanded. Same fix as DarkestActorSheet's scrollY.
      scrollY: ['.window-content']
    });
  }

  /**
   * Get the current game mode ('darkest-woods' or 'darkest-house')
   */
  static getGameMode() {
    try {
      return game.settings.get('darkest-system', 'gameMode') || 'darkest-woods';
    } catch {
      return 'darkest-woods';
    }
  }

  /**
   * Get house action data from world settings
   */
  static getHouseActions() {
    return game.settings.get('darkest-system', 'houseActions') || { level: 0, loops: 0 };
  }

  /**
   * Save house action data to world settings
   */
  static async setHouseActions(data) {
    await game.settings.set('darkest-system', 'houseActions', data);
  }

  /**
   * Get transgression data from world settings
   */
  static getTransgressions() {
    const defaultData = {};
    for (const regionId of Object.keys(TransgressionTracker.getAllRegions())) {
      defaultData[regionId] = { level: 0, loops: 0 };
    }
    return game.settings.get('darkest-system', 'transgressions') || defaultData;
  }

  static hasContent() {
    return Object.keys(TransgressionTracker.getAllRegions()).length > 0;
  }

  /** Returns merged injected + custom regions */
  static getAllRegions() {
    const custom = game.settings.get('darkest-system', 'customRegions') || {};
    return foundry.utils.mergeObject(foundry.utils.deepClone(WITCHES), custom);
  }

  static getCustomRegions() {
    return game.settings.get('darkest-system', 'customRegions') || {};
  }

  static async setCustomRegions(data) {
    await game.settings.set('darkest-system', 'customRegions', data);
  }

  /** Open add/edit dialog for a region */
  static async openRegionDialog(existingSlug = null) {
    const ALL = TransgressionTracker.getAllRegions();
    const existing = existingSlug ? ALL[existingSlug] : null;
    const isCustom = existingSlug ? !WITCHES[existingSlug] : true;

    const eventFields = Array.from({ length: 10 }, (_, i) => {
      const text = existing?.transgressionEvents?.[i] || '';
      return `<div class="region-event-row">
        <label>${i + 1}.</label>
        <textarea name="event_${i}" rows="2" placeholder="Event ${i + 1} description (optional)">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
      </div>`;
    }).join('');

    const content = `<div class="darkest-dialog region-edit-dialog">
      <div class="form-group">
        <label>Region Name</label>
        <input type="text" name="regionName" value="${existing?.name || ''}" placeholder="e.g. The Dark Forest">
      </div>
      <div class="form-group">
        <label>Antagonist Name</label>
        <input type="text" name="witchName" value="${existing?.witch || ''}" placeholder="e.g. The Shadow Witch">
      </div>
      <div class="form-group">
        <label>Key Phrase</label>
        <input type="text" name="keyPhrase" value="${existing?.keyPhrase || ''}" placeholder="Optional flavour phrase">
      </div>
      <div class="form-group region-events-group">
        <label>Transgression Events <span class="form-hint">(optional — fill in from your source material)</span></label>
        ${eventFields}
      </div>
    </div>`;

    return new Promise((resolve) => {
      new Dialog({
        title: existingSlug ? 'Edit Region' : 'Add Region',
        content,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: 'Save',
            callback: async (html) => {
              const name = html.find('[name="regionName"]').val().trim();
              if (!name) { ui.notifications.warn('Region name is required.'); return; }

              const witch = html.find('[name="witchName"]').val().trim();
              const keyPhrase = html.find('[name="keyPhrase"]').val().trim();
              const events = Array.from({ length: 10 }, (_, i) =>
                html.find(`[name="event_${i}"]`).val().trim()
              ).filter(Boolean);

              const slug = existingSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              const custom = TransgressionTracker.getCustomRegions();
              custom[slug] = { name, witch, keyPhrase, transgressionEvents: events };
              await TransgressionTracker.setCustomRegions(custom);

              const tracker = Object.values(ui.windows).find(w => w instanceof TransgressionTracker);
              if (tracker) tracker.render();
              resolve(slug);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'save'
      }, { width: 480 }).render(true);
    });
  }

  /**
   * Save transgression data to world settings
   */
  static async setTransgressions(data) {
    await game.settings.set('darkest-system', 'transgressions', data);
  }

  /**
   * Get the current region based on active scene
   */
  static getCurrentRegion() {
    // If the GM has explicitly deactivated any region, respect that.
    const explicit = game.settings.get('darkest-system', 'currentRegion');
    if (explicit === '__none__') return null;

    const ALL = TransgressionTracker.getAllRegions();
    const scene = game.scenes.active;

    if (scene) {
      const regionSlug = scene.getFlag('darkest-system', 'region');
      if (regionSlug && ALL[regionSlug]) return regionSlug;

      const sceneName = scene.name.toLowerCase();
      for (const [slug, data] of Object.entries(ALL)) {
        if (sceneName.includes(data.name.toLowerCase())) return slug;
      }
    }

    return explicit || null;
  }

  static async setCurrentRegion(regionSlug) {
    const ALL = TransgressionTracker.getAllRegions();
    if (ALL[regionSlug]) {
      await game.settings.set('darkest-system', 'currentRegion', regionSlug);
    } else {
      // null means deactivate — store sentinel so scene auto-detection is suppressed
      await game.settings.set('darkest-system', 'currentRegion', '__none__');
    }
  }

  /**
   * Public-facing ominous message shown to everyone (including the GM),
   * tiered by the region/house's current level (1-10). Deliberately vague
   * at tiers 1-2 -- the GM-only detail (the witch's actual next scripted
   * action) is whispered separately, where the level is known. At tier 3
   * (level 10, the witch's transgression cycle about to loop), the message
   * for Woods mode surfaces the region's actual key phrase per the rules:
   * "Many of the transgression events involve a mysterious whisper... each
   * witch also has its own key phrase... [that] encodes a clue about the
   * means of escaping the Darkest Woods." House mode has no witches/key
   * phrases, so it keeps its own flat tier wording unchanged.
   */
  static _publicStirMessage(level, isHouseMode, keyPhrase) {
    if (!isHouseMode && level >= 10) {
      return keyPhrase
        ? game.i18n.format('DARKEST.Roll.WoodsStirTier3', { phrase: keyPhrase })
        : game.i18n.localize('DARKEST.Roll.WoodsStirTier3Generic');
    }
    const key = level >= 10 ? 'Tier3' : level >= 5 ? 'Tier2' : 'Tier1';
    const localizeKey = `DARKEST.Roll.${isHouseMode ? 'House' : 'Woods'}Stir${key}`;
    return game.i18n.localize(localizeKey);
  }

  /**
   * Increment transgression for a region (Darkest Woods) or advance the house
   * action counter (Darkest House).
   */
  /** Current pacing settings, tolerant of a world that predates them. */
  static dampingConfig() {
    const get = (key, fallback) => {
      try { return game.settings.get('darkest-system', key) ?? fallback; }
      catch { return fallback; }
    };
    return {
      mode: get(SETTING_DAMPING_MODE, 'off'),
      minutes: get(SETTING_DAMPING_MINUTES, 5),
      rolls: get(SETTING_DAMPING_ROLLS, 3),
      threshold: get(SETTING_DAMPING_THRESHOLD, 3),
      state: get(SETTING_DAMPING_STATE, { lastAdvanceMs: 0, rollsSinceAdvance: 999, provocation: 0 }),
    };
  }

  /**
   * Should this trigger actually move the tracker?
   *
   * Returns { advance, reason } -- when advance is false the caller still
   * posts the public stir message, so players cannot tell a damped trigger
   * from a live one. Only the GM sees why it was held.
   */
  static async _checkDamping() {
    // Serialised: this is a read-modify-write on one setting, and the whole
    // point of the feature is four players rolling at once. Overlapping
    // calls would each read the same counter, both write the same value,
    // and the cooldown would count one roll where two happened.
    TransgressionTracker._dampingQueue = TransgressionTracker._dampingQueue
      .catch(() => {})
      .then(() => TransgressionTracker._checkDampingUnsafe());
    return TransgressionTracker._dampingQueue;
  }

  static async _checkDampingUnsafe() {
    const cfg = TransgressionTracker.dampingConfig();
    if (cfg.mode === 'off') return { advance: true };

    const state = foundry.utils.deepClone(cfg.state);
    const now = Date.now();
    let advance = true;
    let reason = null;

    if (cfg.mode === 'time') {
      const elapsedMs = now - (state.lastAdvanceMs || 0);
      const waitMs = cfg.minutes * 60000;
      if (elapsedMs < waitMs) {
        advance = false;
        const left = Math.ceil((waitMs - elapsedMs) / 60000);
        reason = `held — ${left} more minute${left === 1 ? '' : 's'} of cooldown`;
      }
    } else if (cfg.mode === 'rolls') {
      // READ the counter; noteRoll() is what increments it, once per actual
      // action roll. This used to increment here instead -- which meant it
      // counted TRANSGRESSIONS, not rolls, so a "3 roll" cooldown really
      // suppressed the next three triggers (roughly a dozen rolls at the
      // usual trigger rate) and only every fourth transgression landed.
      const since = state.rollsSinceAdvance ?? 999;
      if (since < cfg.rolls) {
        advance = false;
        const left = cfg.rolls - since;
        reason = `held — ${left} more roll${left === 1 ? '' : 's'} of cooldown`;
      }
    } else if (cfg.mode === 'threshold') {
      state.provocation = (state.provocation || 0) + 1;
      if (state.provocation < cfg.threshold) {
        advance = false;
        reason = `provocation ${state.provocation}/${cfg.threshold}`;
      }
    }

    if (advance) {
      state.lastAdvanceMs = now;
      state.rollsSinceAdvance = 0;
      state.provocation = 0;
    }
    await game.settings.set('darkest-system', SETTING_DAMPING_STATE, state);
    return { advance, reason };
  }

  /**
   * An action roll happened. Feeds the 'rolls' damping mode.
   *
   * Counted here rather than inside _checkDamping, because that only runs
   * when a transgression actually triggers -- so counting there measured
   * transgressions and called them rolls. Every action roll reaches this: the
   * roller's own client if they are the GM, otherwise the GM's client via the
   * logRoll socket, so it is counted exactly once however it arrived.
   *
   * Shares _dampingQueue with the check, so a roll landing at the same moment
   * as a trigger can't lose either write.
   */
  static async noteRoll() {
    if (TransgressionTracker.dampingConfig().mode !== 'rolls') return;
    TransgressionTracker._dampingQueue = TransgressionTracker._dampingQueue
      .catch(() => {})
      .then(async () => {
        const state = foundry.utils.deepClone(TransgressionTracker.dampingConfig().state);
        state.rollsSinceAdvance = (state.rollsSinceAdvance ?? 999) + 1;
        await game.settings.set('darkest-system', SETTING_DAMPING_STATE, state);
      });
    return TransgressionTracker._dampingQueue;
  }

  /** Clear any accumulated cooldown, so the next trigger lands. */
  static async resetDamping() {
    await game.settings.set('darkest-system', SETTING_DAMPING_STATE, {
      lastAdvanceMs: 0, rollsSinceAdvance: 999, provocation: 0,
    });
    TransgressionTracker.refresh();
  }

  static refresh() {
    Object.values(ui.windows)
      .filter(w => w instanceof TransgressionTracker)
      .forEach(w => w.render(false));
  }

  /**
   * The level read-modify-write, serialised.
   *
   * Returns the region's state AFTER the advance, so the caller can tier its
   * chat messages off the new level without re-reading (a re-read could see
   * a later transgression's value and describe the wrong tier).
   */
  static async _advanceLevel(regionSlug, ALL) {
    TransgressionTracker._levelQueue = TransgressionTracker._levelQueue
      .catch(() => {})  // a failed write must not wedge the queue
      .then(() => TransgressionTracker._advanceLevelUnsafe(regionSlug, ALL));
    return TransgressionTracker._levelQueue;
  }

  static async _advanceLevelUnsafe(regionSlug, ALL) {
    const transgressions = TransgressionTracker.getTransgressions();
    if (!transgressions[regionSlug]) transgressions[regionSlug] = { level: 0, loops: 0 };
    const region = transgressions[regionSlug];
    const antagonist = ALL[regionSlug].witch || ALL[regionSlug].name;

    region.level++;
    SessionLog.recordTransgression({
      region: ALL[regionSlug].name,
      level: region.level,
      witch: ALL[regionSlug].witch,
    });
    if (region.level > 10) {
      region.level = 1;
      region.loops++;

      if (region.loops >= 3) {
        ui.notifications.error(
          `CRITICAL: ${antagonist} has completed 3 transgression cycles! ` +
          `They can now open the door to the Dark Forest!`,
          { permanent: true }
        );
      } else {
        ui.notifications.warn(
          `${antagonist} has completed a transgression cycle! Loop ${region.loops}/3`
        );
      }
    }

    await TransgressionTracker.setTransgressions(transgressions);
    // A copy: the caller only reads it, and handing back the live object
    // would let a later queued advance mutate it mid-message.
    return { level: region.level, loops: region.loops };
  }

  /** Is the GM being asked about each roll-driven transgression? */
  static confirmEnabled() {
    try {
      return game.settings.get('darkest-system', SETTING_CONFIRM) === true;
    } catch {
      return false;
    }
  }

  /**
   * Stir the woods, then ask the GM whether the track actually moves.
   *
   * The player-facing half must be INDISTINGUISHABLE from a live
   * transgression, a damped one, and one the GM lets pass. Three things
   * follow from that, and all three are load bearing:
   *
   * 1. The public message is posted HERE, before the GM decides, and is the
   *    same _publicStirMessage() a live trigger posts. Waiting for the
   *    decision would put a visible pause in front of the players that scales
   *    with how long the GM deliberated.
   * 2. It is tiered off the level this trigger WOULD reach, not the current
   *    one -- the same reasoning as the damping branch. The tiers step at 5
   *    and 10, so using the current level would post a tier-2 line where a
   *    live trigger posted tier-3, at the two most dramatic moments in the
   *    track.
   * 3. Applying later posts NO second public message. The players have had
   *    their line; a second one on Apply would mark out the applied ones.
   *
   * Damping is deliberately not consulted here. A trigger the GM lets pass
   * costs nothing -- no cooldown consumed, no provocation counted -- so the
   * next one can still land. Damping runs on Apply, inside the normal path.
   */
  static async _promptForTransgression(regionSlug, ALL) {
    const current = this.getTransgressions()[regionSlug] || { level: 0, loops: 0 };
    const wouldBe = current.level >= 10 ? 1 : current.level + 1;

    const stir = TransgressionTracker._publicStirMessage(
      wouldBe, false, ALL[regionSlug].keyPhrase
    );
    await ChatMessage.create({
      content: `<div class="transgression-message player-ominous"><i class="fas fa-tree"></i> ${stir}</div>`
    });

    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    if (!gmIds.length) return current;

    const regionData = ALL[regionSlug];
    // What applying would actually do, so the call can be made from the
    // prompt without opening the tracker to look it up.
    const eventText = regionData?.transgressionEvents?.[wouldBe - 1];
    const preview = eventText
      ? `<p class="transgression-preview"><strong>Would trigger ${wouldBe}:</strong> ${eventText}</p>`
      : '';

    await ChatMessage.create({
      whisper: gmIds,
      content: `<div class="transgression-message backtrack-prompt">
        <div class="backtrack-head"><i class="fas fa-dice-d6"></i> A Darkest Die — your call.</div>
        <p>The woods have stirred for <strong>${regionData.name}</strong>. The track
        sits at <strong>${current.level}</strong>; applying takes it to
        <strong>${wouldBe}</strong>.</p>
        ${preview}
        <p class="hint">The players have already seen the woods take notice — nothing below changes what they see.</p>
        <div class="backtrack-actions">
          <button type="button" class="transgression-apply" data-region="${regionSlug}">
            <i class="fas fa-tree"></i> Apply transgression
          </button>
          <button type="button" class="backtrack-dismiss">
            <i class="fas fa-times"></i> Let it pass
          </button>
        </div>
      </div>`,
      flags: { 'darkest-system': { transgressionPrompt: true } },
    });

    return current;
  }

  static async incrementTransgression(regionSlug, {
    bypassDamping = false, skipConfirm = false, silent = false,
  } = {}) {
    if (this.getGameMode() === 'darkest-house') {
      return this._incrementHouseAction();
    }

    const ALL = TransgressionTracker.getAllRegions();
    if (!regionSlug || !ALL[regionSlug]) {
      ui.notifications.warn('No valid region selected for transgression tracking');
      return null;
    }

    // Ask first, if the GM wants to be asked. skipConfirm is what the prompt's
    // own Apply button comes back through -- without it, pressing Apply would
    // post a second stir message and prompt again forever.
    //
    // bypassDamping implies skipConfirm: its only caller is the backtracking
    // prompt, which has ALREADY asked. Prompting again would be a second
    // dialog for one decision the GM just made.
    if (this.confirmEnabled() && !skipConfirm && !bypassDamping) {
      return TransgressionTracker._promptForTransgression(regionSlug, ALL);
    }

    // Optional pacing house rule. A damped trigger still stirs the woods --
    // the players must not be able to tell the difference -- but leaves the
    // track where it is so the GM can finish narrating the last one.
    // bypassDamping skips the check ENTIRELY rather than ignoring its
    // verdict. Damping exists to stop dice-driven transgressions stacking
    // when four players roll at once, and its 'rolls'/'threshold' modes
    // COUNT every trigger -- so merely ignoring the answer would silently
    // consume a player's provocation for something no player did.
    //
    // The backtracking prompt is the caller that needs this: it is one
    // deliberate GM button press, and being told "held" after pressing
    // Apply reads as a bug rather than as pacing.
    const damping = bypassDamping
      ? { advance: true }
      : await TransgressionTracker._checkDamping();
    if (!damping.advance) {
      const current = this.getTransgressions()[regionSlug] || { level: 0, loops: 0 };
      // Tier the message off the level this trigger WOULD have reached, not
      // the one it's held at. The tiers step at 5 and 10, so using the
      // current level would post a tier-2 message where a live trigger
      // posted tier-3 -- letting a player who tracks the wording work out
      // that damping is on, at exactly the two most dramatic moments.
      //
      // `silent` when the GM is confirming: the prompt already posted this
      // exact line before they decided. Pressing Apply and finding the woods
      // held would otherwise stir them twice for one Darkest Die.
      if (!silent) {
        const wouldBe = current.level >= 10 ? 1 : current.level + 1;
        const stir = TransgressionTracker._publicStirMessage(
          wouldBe, false, ALL[regionSlug].keyPhrase
        );
        await ChatMessage.create({
          content: `<div class="transgression-message player-ominous"><i class="fas fa-tree"></i> ${stir}</div>`
        });
      }

      const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
      if (gmIds.length) {
        await ChatMessage.create({
          content: `<div class="transgression-message transgression-damped">
            <i class="fas fa-hourglass-half"></i>
            The woods stirred, but the track stayed at <strong>${current.level}</strong>
            <span class="damped-reason">(${damping.reason})</span>
          </div>`,
          whisper: gmIds,
        });
      }
      TransgressionTracker.refresh();
      return current;
    }

    // The level advance is a read-modify-write on one setting, so it is
    // queued -- two transgressions landing together would otherwise both
    // read the same level and one increment would vanish, advancing the
    // witch's track slower than play warrants.
    //
    // ONLY this part is queued. Damping has its own _dampingQueue and has
    // already returned its decision above; wrapping the whole method would
    // put two independent queues across overlapping work for no benefit.
    // The chat messages below stay outside it -- they don't touch the
    // setting, and holding the queue open across ChatMessage.create() would
    // serialise every transgression behind a chat round-trip.
    const region = await TransgressionTracker._advanceLevel(regionSlug, ALL);

    // Public ominous message, tiered by the new level -- everyone sees this,
    // GM included; it never names the witch's actual scripted action (only
    // the tier-3 key phrase, per the rules -- see _publicStirMessage).
    //
    // Suppressed when the GM is confirming: the prompt posted this line the
    // moment the die landed, tiered off the same level this advance reached.
    // Posting again on Apply would give the players a second stir for one
    // provocation -- and only for the ones the GM chose to apply, which is
    // exactly the tell the whole feature exists to avoid.
    if (!silent) {
      const isHouseMode = this.getGameMode() === 'darkest-house';
      const stirMessage = TransgressionTracker._publicStirMessage(region.level, isHouseMode, ALL[regionSlug].keyPhrase);
      await ChatMessage.create({
        content: `<div class="transgression-message player-ominous"><i class="fas fa-tree"></i> ${stirMessage}</div>`
      });
    }

    // Post the triggered event to GM chat
    const regionData = ALL[regionSlug];
    const eventIndex = region.level - 1;
    const eventText = regionData?.transgressionEvents?.[eventIndex];
    if (eventText) {
      await ChatMessage.create({
        speaker: { alias: regionData.witch || regionData.name },
        content: `<div class="house-action-chat"><strong>${regionData.name} — Transgression ${region.level}:</strong><p>${eventText}</p></div>`,
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
    }

    // Refresh tracker if open
    const tracker = Object.values(ui.windows).find(w => w instanceof TransgressionTracker);
    if (tracker) {
      tracker.render();
    }

    return region;
  }

  /**
   * Advance the house action counter and post the next action to chat (House mode).
   */
  /** The house level read-modify-write, serialised. Returns the new state. */
  static async _advanceHouseLevel() {
    TransgressionTracker._levelQueue = TransgressionTracker._levelQueue
      .catch(() => {})  // a failed write must not wedge the queue
      .then(async () => {
        const data = TransgressionTracker.getHouseActions();
        data.level++;
        if (data.level > 10) {
          data.level = 1;
          data.loops = (data.loops || 0) + 1;
          ui.notifications.warn(`The house has cycled through all actions — starting over (cycle ${data.loops}).`);
        }
        await TransgressionTracker.setHouseActions(data);
        // A copy: the caller only reads it, and handing back the live object
        // would let a later queued advance mutate it mid-message.
        return { level: data.level, loops: data.loops };
      });
    return TransgressionTracker._levelQueue;
  }

  static async _incrementHouseAction() {
    // Queued, for the same reason the Woods track is: this is a
    // read-modify-write on one setting, and two triggers landing together
    // both read level N and both write N+1, losing an advance. Only the
    // write is inside the queue -- holding it across the chat round-trips
    // below would serialise every trigger behind a message.
    const data = await TransgressionTracker._advanceHouseLevel();

    // Public ominous message, tiered by the new level -- everyone sees this,
    // GM included; it never names the house's actual scripted action.
    await ChatMessage.create({
      content: `<div class="transgression-message player-ominous"><i class="fas fa-tree"></i> ${TransgressionTracker._publicStirMessage(data.level, true)}</div>`
    });

    // Post the triggered action to chat (GM only)
    const actionText = HOUSE_ACTIONS[data.level - 1];
    if (actionText) {
      await ChatMessage.create({
        speaker: { alias: 'The House' },
        content: `<div class="house-action-chat"><strong>House Action ${data.level}:</strong><p>${actionText}</p></div>`,
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
    }

    // Refresh tracker if open
    const tracker = Object.values(ui.windows).find(w => w instanceof TransgressionTracker);
    if (tracker) tracker.render();

    return data;
  }

  /**
   * Prepare data for the template
   */
  getData() {
    const isHouseMode = TransgressionTracker.getGameMode() === 'darkest-house';

    if (isHouseMode) {
      const data = TransgressionTracker.getHouseActions();
      const level = data.level || 0;
      const loops = data.loops || 0;

      const houseActions = HOUSE_ACTIONS.map((text, i) => ({
        number: i + 1,
        text,
        triggered: i < level,
        next: i === level,
        upcoming: i > level
      }));

      return {
        isHouseMode: true,
        level,
        loops,
        houseActions,
        nextAction: level < 10 ? HOUSE_ACTIONS[level] : null,
        levelDots: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          filled: i < level,
          event: HOUSE_ACTIONS[i] || null
        }))
      };
    }

    // --- Darkest Woods mode ---
    if (!TransgressionTracker.hasContent()) {
      return {
        isHouseMode: false,
        isEmpty: true,
        regions: [],
        currentRegion: 'None',
        currentRegionSlug: null,
        witchOptions: []
      };
    }

    const ALL = TransgressionTracker.getAllRegions();
    const transgressions = TransgressionTracker.getTransgressions();
    const currentRegion = TransgressionTracker.getCurrentRegion();

    const regions = Object.entries(ALL).map(([slug, data]) => {
      const transgression = transgressions[slug] || { level: 0, loops: 0 };
      return {
        slug,
        name: data.name,
        witch: data.witch,
        keyPhrase: data.keyPhrase,
        level: transgression.level,
        loops: transgression.loops,
        isCurrent: slug === currentRegion,
        isWarning: transgression.loops >= 2,
        isCritical: transgression.loops >= 3,
        isCustom: !WITCHES[slug],
        // Each dot carries its own level's event text, so the GM can read
        // what a level does by hovering it rather than opening the events
        // panel and counting rows.
        levelDots: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          filled: i < transgression.level,
          event: (data.transgressionEvents || [])[i] || null
        })),
        loopPips: Array.from({ length: 3 }, (_, i) => ({
          filled: i < transgression.loops,
          critical: transgression.loops >= 3 && i < transgression.loops
        })),
        transgressionEvents: (data.transgressionEvents || []).map((text, i) => ({
          number: i + 1,
          text,
          triggered: i < transgression.level,
          next: i === transgression.level
        }))
      };
    });

    // Birdsongs are campaign progress as much as a travel setting, so they
    // appear here too. Both this and the travel tool read/write the same
    // world setting, so toggling in either place updates the other.
    const knownSongs = TravelClock.getKnownBirdsongs();

    return {
      isHouseMode: false,
      isEmpty: regions.length === 0,
      regions,
      currentRegion: currentRegion ? ALL[currentRegion]?.name : 'None',
      currentRegionSlug: currentRegion,
      birdsongs: BIRDSONGS.map(b => ({ ...b, known: knownSongs.has(b.key) })),
      witchOptions: Object.entries(ALL).map(([slug, data]) => ({
        slug,
        name: data.name,
        selected: slug === currentRegion
      })),
      damping: TransgressionTracker._dampingStatus(),
      confirming: TransgressionTracker.confirmEnabled(),
    };
  }

  /** A one-line readout of the pacing rule, or null when it's off. */
  static _dampingStatus() {
    const cfg = TransgressionTracker.dampingConfig();
    if (cfg.mode === 'off') return null;

    const s = cfg.state || {};
    if (cfg.mode === 'time') {
      const leftMs = (cfg.minutes * 60000) - (Date.now() - (s.lastAdvanceMs || 0));
      const ready = leftMs <= 0;
      return {
        label: `Cooldown ${cfg.minutes}m`,
        detail: ready ? 'ready' : `${Math.ceil(leftMs / 60000)}m to go`,
        ready,
      };
    }
    if (cfg.mode === 'rolls') {
      const done = s.rollsSinceAdvance ?? 999;
      const ready = done > cfg.rolls;
      return {
        label: `Cooldown ${cfg.rolls} rolls`,
        detail: ready ? 'ready' : `${cfg.rolls - done + 1} to go`,
        ready,
      };
    }
    return {
      label: `Provocation ${cfg.threshold}`,
      detail: `${s.provocation || 0}/${cfg.threshold}`,
      ready: false,
    };
  }

  /** Capture which panels are open before re-render wipes the DOM */
  render(force, options) {
    // Save open state before DOM is replaced
    if (this.element?.length) {
      this._openPanels = new Set();
      this.element.find('.transgression-events:not(.collapsed)').each((_, el) => {
        this._openPanels.add(el.dataset.region);
      });
    }
    return super.render(force, options);
  }

  /**
   * Activate event listeners
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Restore open panels from before the render
    if (this._openPanels?.size) {
      this._openPanels.forEach(slug => {
        const panel = html.find(`.transgression-events[data-region="${slug}"]`);
        if (panel.length) {
          panel.removeClass('collapsed');
          const btn = html.find(`.events-toggle-btn[data-region="${slug}"] i`);
          btn.removeClass('fa-list').addClass('fa-chevron-up');
        }
      });
    }

    const isHouseMode = TransgressionTracker.getGameMode() === 'darkest-house';

    // Birdsong toggles -- same world setting the travel tool uses, so a
    // change here immediately opens/closes those secret trails there.
    html.find('.damping-reset').click(async (ev) => {
      ev.stopPropagation();
      await TransgressionTracker.resetDamping();
    });

    html.find('.birdsong-toggle').click(async (ev) => {
      await TravelClock.toggleBirdsong(ev.currentTarget.dataset.bird);
      TravelClock.refresh();
      this.render();
    });

    // Increment buttons (work in both modes)
    html.find('.increment-btn').click(async (ev) => {
      const regionSlug = ev.currentTarget.dataset.region;
      await TransgressionTracker.incrementTransgression(regionSlug);
      this.render();
    });

    // Decrement buttons
    html.find('.decrement-btn').click(async (ev) => {
      if (isHouseMode) {
        const data = TransgressionTracker.getHouseActions();
        if (data.level > 0) {
          data.level--;
        } else if (data.loops > 0) {
          data.loops--;
          data.level = 10;
        }
        await TransgressionTracker.setHouseActions(data);
        this.render();
        return;
      }

      const regionSlug = ev.currentTarget.dataset.region;
      const transgressions = TransgressionTracker.getTransgressions();
      const region = transgressions[regionSlug];
      if (!region) return;

      if (region.level > 0) {
        region.level--;
      } else if (region.loops > 0) {
        region.loops--;
        region.level = 10;
      }

      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });

    // Reset button
    html.find('.reset-btn').click(async (ev) => {
      if (isHouseMode) {
        await TransgressionTracker.setHouseActions({ level: 0, loops: 0 });
        this.render();
        return;
      }

      const regionSlug = ev.currentTarget.dataset.region;
      const transgressions = TransgressionTracker.getTransgressions();
      transgressions[regionSlug] = { level: 0, loops: 0 };
      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });

    // Click region summary to set as active — click again to deactivate
    html.find('.region-summary').click(async (ev) => {
      if (ev.target.closest('button') || ev.target.closest('.level-dot')) return;
      const regionSlug = ev.currentTarget.closest('.region-row').dataset.region;
      const current = TransgressionTracker.getCurrentRegion();
      await TransgressionTracker.setCurrentRegion(current === regionSlug ? null : regionSlug);
      this.render();
    });

    // Toggle events list
    html.find('.events-toggle-btn').click((ev) => {
      ev.stopPropagation();
      const regionSlug = ev.currentTarget.dataset.region;
      const panel = html.find(`.transgression-events[data-region="${regionSlug}"]`);
      panel.toggleClass('collapsed');
      const icon = ev.currentTarget.querySelector('i');
      icon.classList.toggle('fa-list', panel.hasClass('collapsed'));
      icon.classList.toggle('fa-chevron-up', !panel.hasClass('collapsed'));
    });

    // Click on level dots to set level directly
    html.find('.level-dot').click(async (ev) => {
      const regionSlug = ev.currentTarget.dataset.region;
      const level = parseInt(ev.currentTarget.dataset.level);
      const transgressions = TransgressionTracker.getTransgressions();
      if (!transgressions[regionSlug]) transgressions[regionSlug] = { level: 0, loops: 0 };
      transgressions[regionSlug].level = level;
      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });

    // Add region button
    html.find('.add-region-btn').click(async () => {
      await TransgressionTracker.openRegionDialog(null);
    });

    // Edit region button (custom regions only)
    html.find('.edit-region-btn').click(async (ev) => {
      ev.stopPropagation();
      const slug = ev.currentTarget.dataset.region;
      await TransgressionTracker.openRegionDialog(slug);
    });

    // Delete region button (custom regions only)
    html.find('.delete-region-btn').click(async (ev) => {
      ev.stopPropagation();
      const slug = ev.currentTarget.dataset.region;
      const ALL = TransgressionTracker.getAllRegions();
      const name = ALL[slug]?.name || slug;
      const confirmed = await Dialog.confirm({
        title: 'Delete Region',
        content: `<p>Delete <strong>${name}</strong>? This will also clear its transgression progress.</p>`
      });
      if (!confirmed) return;
      const custom = TransgressionTracker.getCustomRegions();
      delete custom[slug];
      await TransgressionTracker.setCustomRegions(custom);
      const transgressions = TransgressionTracker.getTransgressions();
      delete transgressions[slug];
      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });
  }
}

/**
 * Register settings for transgression tracking
 */
export function registerTransgressionSettings() {
  // Transgression data storage
  game.settings.register('darkest-system', 'transgressions', {
    name: 'Transgression Data',
    hint: 'Stores transgression levels for each witch/region',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // Current region setting
  game.settings.register('darkest-system', 'currentRegion', {
    name: 'Current Region',
    hint: 'The region the party is currently in',
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  // Custom regions added by the GM
  game.settings.register('darkest-system', 'customRegions', {
    name: 'Custom Regions',
    hint: 'GM-created regions for the transgression tracker',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // House Actions data (Darkest House mode)
  game.settings.register('darkest-system', 'houseActions', {
    name: 'House Actions Data',
    hint: 'Stores the current house action level for Darkest House mode',
    scope: 'world',
    config: false,
    type: Object,
    default: { level: 0, loops: 0 }
  });

  // --- Optional house rule: slow the transgression track down -------------
  //
  // The Darkest Die is the highest of three d6 about 25.4% of the time, so
  // with four players every round of combat produces roughly one
  // transgression. A five-round fight burns half the witch's ten-level
  // track, and the GM has no room to narrate one before the next lands.
  //
  // All three modes still post the public "the woods stir" message on every
  // trigger -- the tension is the point, and players should never be able
  // to tell a damped trigger from a live one. Only the LEVEL is held back.
  game.settings.register('darkest-system', SETTING_DAMPING_MODE, {
    name: 'Transgression pacing',
    hint: 'Optional house rule, Darkest Woods mode only. Stops the transgression track advancing several times in quick succession. The woods still stir on every trigger; only the tracker is held back.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      off: 'Off — every trigger advances the track (default rules)',
      time: 'Cooldown in minutes — ignore triggers for a while after one lands',
      rolls: 'Cooldown in rolls — ignore triggers for the next few rolls',
      threshold: 'Provocation — several triggers needed to advance one level',
    },
    default: 'off',
    onChange: () => TransgressionTracker.refresh(),
  });

  // --- Optional house rule: decide each one yourself ----------------------
  //
  // Separate from pacing above, and composable with it: pacing decides
  // whether the woods CAN advance, this decides whether they DO. A GM who
  // wants to judge every transgression in the moment ("that one was earned,
  // that one was a fluke of the dice") turns this on and leaves pacing off.
  //
  // The players' experience is byte-identical either way. That is the whole
  // point of the feature and the constraint every part of it is written
  // against -- see _promptForTransgression().
  game.settings.register('darkest-system', SETTING_CONFIRM, {
    name: 'Ask before each transgression',
    hint: 'Optional house rule, Darkest Woods mode only. A Darkest Die whispers you a prompt instead of advancing the track: apply it, or let it pass. The players see exactly what they always see either way — the woods stir on the card regardless, and nothing in chat reveals your choice. Backtracking already asks and is unaffected.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => TransgressionTracker.refresh(),
  });

  game.settings.register('darkest-system', SETTING_DAMPING_MINUTES, {
    name: 'Pacing: cooldown minutes',
    hint: 'For "Cooldown in minutes". Real time, not game time. ~5 turns a five-round fight into roughly two advances instead of five.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 1, max: 60, step: 1 },
    default: 5,
  });

  game.settings.register('darkest-system', SETTING_DAMPING_ROLLS, {
    name: 'Pacing: cooldown rolls',
    hint: 'For "Cooldown in rolls". How many action rolls must pass after the track advances before it can advance again — unaffected by how fast your table plays. ~3 turns a five-round fight into roughly three advances instead of five.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 1, max: 20, step: 1 },
    default: 3,
  });

  game.settings.register('darkest-system', SETTING_DAMPING_THRESHOLD, {
    name: 'Pacing: triggers per level',
    hint: 'For "Provocation". How many times the woods must be provoked before the track moves once. 3 turns a five-round fight into roughly one advance instead of five.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 2, max: 10, step: 1 },
    default: 3,
  });

  // Runtime state for the above: when the last advance happened, how many
  // rolls have passed since, and how much provocation has accumulated.
  game.settings.register('darkest-system', SETTING_DAMPING_STATE, {
    name: 'Transgression pacing state',
    scope: 'world',
    config: false,
    type: Object,
    default: { lastAdvanceMs: 0, rollsSinceAdvance: 999, provocation: 0 },
  });
}
