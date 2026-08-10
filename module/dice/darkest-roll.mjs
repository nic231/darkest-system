import { SessionLog } from '../apps/session-log.mjs';

/** The Darkest Die's distinctive purple, shared by every client. */
export const DARKEST_DIE_APPEARANCE = {
  colorset: 'custom',
  labelColor: '#ffffff',
  diceColor: '#6a2fa0',
  outlineColor: '#3a1a5c',
  edgeColor: '#8b3ad4',
  texture: 'none',
  material: 'plastic'
};

/**
 * Animate the main dice, then the Darkest Die, in that order.
 *
 * Run identically on the roller's client and (via the darkestDiceAnimation
 * socket case) on every other client, so all screens see the same two-stage
 * sequence rather than the roller seeing both and observers seeing only the
 * Darkest Die.
 *
 * `synchronize` is deliberately false: each client is already being told to
 * play this locally, so letting Dice So Nice broadcast as well would show
 * observers a duplicate set of dice.
 */
export async function playDarkestDiceSequence({ mainRoll, darkestRoll, user, speaker, whisper }) {
  if (!game.dice3d) return;

  await game.dice3d.showForRoll(mainRoll, user, false, whisper ?? null, false, null, speaker ?? null);

  if (!darkestRoll) return;
  darkestRoll.options.appearance = DARKEST_DIE_APPEARANCE;
  await game.dice3d.showForRoll(
    darkestRoll, user, false, whisper ?? null, false, null, speaker ?? null,
    { ghost: false, secret: false }
  );
}

/**
 * Custom roll class for The Darkest System
 * Handles the unique mechanics: 2d6 + Darkest Die + Rating vs Target Number
 */
export class DarkestRoll extends Roll {

  constructor(formula, data = {}, options = {}) {
    super(formula, data, options);

    // Store custom options
    this.taskRating = options.taskRating ?? 4;
    this.characterRating = options.characterRating ?? 3;
    this.boons = options.boons ?? 0;
    this.banes = options.banes ?? 0;
    this.isDamageRoll = options.isDamageRoll ?? false;
    this.callUponWoods = options.callUponWoods ?? false;
    this.defenseRating = options.defenseRating ?? 0;
    this.woundType = options.woundType ?? 'physical';
    this.targetRating = options.targetRating ?? 0;
    this.ratingAdjName = options.ratingAdjName ?? '';
    this.defenseAdjName = options.defenseAdjName ?? '';
    this.modifierName = options.modifierName ?? '';
  }

  /**
   * Create an action roll (2d6 + Darkest Die)
   */
  static createActionRoll(characterRating, taskRating, boons = 0, banes = 0, callUponWoods = false, modifierName = '') {
    // Net boons/banes cancel each other. Rules: NEVER roll more than 3 dice total.
    // Any net boon = 3d6kh2; any net bane = 3d6kl2; balanced = 2d6.
    const net = boons - banes;

    let formula;
    if (net > 0) {
      formula = '3d6kh2';
    } else if (net < 0) {
      formula = '3d6kl2';
    } else {
      formula = '2d6';
    }

    // Add character rating
    formula += ` + ${characterRating}`;

    // Add the Darkest Die (always rolled separately for tracking)
    // We'll handle this in evaluate by rolling separately

    const roll = new DarkestRoll(formula, {}, {
      taskRating,
      characterRating,
      boons,
      banes,
      callUponWoods,
      modifierName
    });

    return roll;
  }

  /**
   * Create a damage roll (1d6 + attack rating - defense rating)
   * @param {number} attackRating - Attacker's rating
   * @param {number} defenseRating - Defender's total rating (rating + armor)
   * @param {number} boons - Number of boons
   * @param {number} banes - Number of banes
   * @param {Object} extra - Extra options (woundType, targetRating)
   */
  static createDamageRoll(attackRating, defenseRating, boons = 0, banes = 0, extra = {}, names = {}) {
    // Rules: NEVER roll more than 3 dice total. Damage base is 1d6.
    // Any net boon = 2d6kh1; any net bane = 2d6kl1; balanced = 1d6.
    const net = boons - banes;

    let formula;
    if (net > 0) {
      formula = '2d6kh1';
    } else if (net < 0) {
      formula = '2d6kl1';
    } else {
      formula = '1d6';
    }

    formula += ` + ${attackRating} - ${defenseRating}`;

    return new DarkestRoll(formula, {}, {
      isDamageRoll: true,
      characterRating: attackRating,
      defenseRating,
      boons,
      banes,
      woundType: extra.woundType || 'physical',
      targetRating: extra.targetRating || 0,
      ratingAdjName: names.ratingAdjName || '',
      defenseAdjName: names.defenseAdjName || ''
    });
  }

  /**
   * Evaluate the roll and determine results
   */
  async evaluate(options = {}) {
    await super.evaluate(options);

    if (!this.isDamageRoll) {
      // Roll the Darkest Die separately
      this.darkestDieRoll = new Roll('1d6');
      await this.darkestDieRoll.evaluate();
      this.darkestDieResult = this.darkestDieRoll.total;

      // Find the highest of the KEPT dice (not discarded boon/bane dice).
      // Per rules: transgression triggers if Darkest Die is the highest of all 3 dice —
      // i.e. it must be higher than both kept dice. Discarded boon/bane dice do not count.
      const allDiceResults = this.dice[0]?.results || [];
      const keptResults = allDiceResults.filter(r => !r.discarded).map(r => r.result);
      this.highestRegularDie = keptResults.length > 0 ? Math.max(...keptResults) : 0;

      // Check for transgression (Darkest Die is highest of all 3 dice)
      this.isTransgression = this.darkestDieResult > this.highestRegularDie;

      // Calculate final total
      const targetNumber = 7 + this.taskRating;

      // If calling upon the woods, add Darkest Die to total
      if (this.callUponWoods) {
        this._total += this.darkestDieResult;
        this.isTransgression = true; // Always transgression when calling upon woods
        this.gainsDoom = true;
      }

      // Determine success/failure
      this.targetNumber = targetNumber;
      this.isSuccess = this._total >= targetNumber;

      // Check for impossible tasks
      const ratingDiff = this.taskRating - this.characterRating;
      this.isImpossible = ratingDiff >= 6;
      this.isAutoSuccess = ratingDiff <= -6;

      if (this.isImpossible && !this.callUponWoods) {
        this.isSuccess = false;
      }
      if (this.isAutoSuccess) {
        this.isSuccess = true;
      }

      // Special Success & Partial Success (Optional House Rules — toggled in system settings)
      // reuse keptResults computed above for transgression check
      const keptDice = keptResults;
      const highestKeptDie = this.highestRegularDie;

      const specialEnabled = game.settings.get('darkest-system', 'enableSpecialSuccess');
      const partialEnabled = game.settings.get('darkest-system', 'enablePartialSuccess');

      // Special Success possible when target < 6 + character rating AND the rule is enabled
      this.specialSuccessPossible = specialEnabled && (this.targetNumber < 6 + this.characterRating);

      // Special Success: succeeded AND single die + rating >= target (only if possible)
      if (this.isSuccess && this.specialSuccessPossible &&
          (highestKeptDie + this.characterRating >= this.targetNumber)) {
        this.isSpecialSuccess = true;
      } else {
        this.isSpecialSuccess = false;
      }

      // Partial Success: failed BUT rolled doubles on kept dice
      // Use Set size to detect duplicates regardless of array order
      const hasPair = keptDice.length >= 2 && new Set(keptDice).size < keptDice.length;
      if (!this.isSuccess && partialEnabled && hasPair) {
        this.isPartialSuccess = true;
      } else {
        this.isPartialSuccess = false;
      }
    } else {
      // Damage roll - calculate wound rating
      this.woundRating = Math.max(0, this._total);
      this.isWound = this.woundRating > 0;

      // Check for instant kill (wound rating 3+ higher than target's base rating)
      // Per rules: If a single wound is 3 or more higher than NPC rating, instant kill/KO
      if (this.targetRating > 0 && this.woundRating >= this.targetRating + 3) {
        this.isInstantKill = true;
      } else {
        this.isInstantKill = false;
      }
    }

    return this;
  }

  /**
   * Render the roll to chat
   */
  async toMessage(messageData = {}, options = {}) {
    // Build custom chat content
    const templateData = {
      formula: this.formula,
      total: this.total,
      isDamageRoll: this.isDamageRoll,
      characterRating: this.characterRating,
      taskRating: this.taskRating,
      targetNumber: this.targetNumber,
      isSuccess: this.isSuccess,
      isTransgression: this.isTransgression,
      darkestDieResult: this.darkestDieResult,
      callUponWoods: this.callUponWoods,
      gainsDoom: this.gainsDoom,
      isImpossible: this.isImpossible,
      isAutoSuccess: this.isAutoSuccess,
      boons: this.boons,
      banes: this.banes,
      // Special/Partial success
      isSpecialSuccess: this.isSpecialSuccess,
      isPartialSuccess: this.isPartialSuccess,
      specialSuccessPossible: this.specialSuccessPossible,
      // Damage specific
      woundRating: this.woundRating,
      isWound: this.isWound,
      defenseRating: this.defenseRating,
      woundType: this.woundType,
      targetRating: this.targetRating,
      isInstantKill: this.isInstantKill,
      ratingAdjName: this.ratingAdjName,
      defenseAdjName: this.defenseAdjName,
      modifierName: this.modifierName,
      dice: this.dice,
      darkestDieRoll: this.darkestDieRoll,
      isPlayerTakingDamage: this.isPlayerTakingDamage ?? false,
      // Game mode — affects "Woods" vs "House" labels in chat
      isHouseMode: game.settings.get('darkest-system', 'gameMode') === 'darkest-house'
    };

    const content = await renderTemplate(
      'systems/darkest-system/templates/chat/roll-result.hbs',
      templateData
    );

    messageData.content = content;
    messageData.sound = CONFIG.sounds.dice;

    // The chat message content already shows the final outcome, so it can't
    // be created until BOTH dice animations have actually finished playing
    // -- but we also want the main dice to visibly roll before the Darkest
    // Die, not alongside/after it. Dice So Nice's only automatic animation
    // trigger is the ChatMessage itself being created, which would reveal
    // the result immediately -- too early. So: suppress DsN's automatic
    // animation for this message (flags['dice-so-nice'].skip), then
    // manually animate the main roll and the Darkest Die ourselves, in
    // order, awaiting each, before creating the message at all.
    if (!this.isDamageRoll && this.darkestDieRoll && game.dice3d) {
      foundry.utils.setProperty(messageData, 'flags.dice-so-nice.skip', true);
      const whisperTargets = Array.isArray(messageData.whisper) && messageData.whisper.length
        ? messageData.whisper
        : null;

      this.darkestDieRoll.options.appearance = DARKEST_DIE_APPEARANCE;

      // showForRoll() only animates on the client that calls it. The `skip`
      // flag above then travels with the ChatMessage to EVERY client, so
      // observers' own Dice So Nice suppresses its automatic animation too
      // -- leaving them with no dice at all. (Passing `synchronize` here
      // doesn't help: it broadcasts a single roll immediately, which both
      // races the sequencing and reveals the Darkest Die alongside the main
      // dice instead of after it.)
      //
      // So mirror the sequence ourselves: tell other clients to replay the
      // same two-stage animation locally, then run it here. Same socket
      // delegation pattern as postGmWhisper/applyWound.
      game.socket.emit('system.darkest-system', {
        type: 'darkestDiceAnimation',
        mainRoll: this.toJSON(),
        darkestRoll: this.darkestDieRoll.toJSON(),
        userId: game.user.id,
        speaker: messageData.speaker ?? null,
        whisper: whisperTargets,
      });

      await playDarkestDiceSequence({
        mainRoll: this,
        darkestRoll: this.darkestDieRoll,
        user: game.user,
        speaker: messageData.speaker ?? null,
        whisper: whisperTargets,
      });
    }

    // Tactical GM-only information (NPC defeat threshold, lethal-blow
    // warning) must never be part of the SHARED message content. A
    // ChatMessage's content is static HTML rendered once by the sender's
    // client and broadcast as-is -- there is no per-viewer re-rendering, so
    // an {{#if isGM}} block inside that shared message renders using
    // whoever CREATED the message's permissions and is then shown verbatim
    // to every viewer, GM or not. The only real fix is a separate message
    // restricted with Foundry's own `whisper` field.
    //
    // A whispered ChatMessage is ALSO always visible to its own author, no
    // matter who's in the `whisper` list -- most rolls are made by players,
    // so creating the message directly on this client would let the roller
    // see their own "GM-only" whisper. Delegate to a GM client via the
    // system.darkest-system socket (postGmWhisper case, same pattern used
    // for applyWound/applyDoom/applyNpcDamage) so a GM actually authors it.
    //
    // Transgressions do NOT get a roll-level GM whisper here -- the actual
    // useful GM-only info (the witch's next scripted action) is whispered
    // by TransgressionTracker.incrementTransgression() once it knows the
    // resulting level, which this roll doesn't. See darkestSystem.transgression
    // hook below and the tiered PUBLIC message in roll-result.hbs.
    if (this.isDamageRoll && this.isWound && this.targetRating && !this.isPlayerTakingDamage) {
      const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
      if (gmIds.length) {
        const threshold = this.targetRating * 3;
        let gmContent = `<div class="darkest-roll damage-roll">
          <div class="npc-damage-info gm-only">
            <div class="npc-damage-row"><i class="fas fa-skull"></i><span>NPC defeat threshold: <strong>${threshold}</strong> total wound rating (Rating ${this.targetRating} × 3)</span></div>
            <div class="npc-damage-row wound-dealt-row"><i class="fas fa-heart-broken"></i><span>This wound: <strong>${this.woundRating}</strong> — auto-applied to active NPC in tracker</span></div>
          </div>`;
        if (this.isInstantKill) {
          gmContent += `<div class="instant-kill-warning">
            <i class="fas fa-skull-crossbones"></i> <strong>LETHAL BLOW!</strong>
            <p>Wound Rating ${this.woundRating} is 3+ higher than target Rating ${this.targetRating}.</p>
            <p>Target is instantly killed or knocked unconscious!</p>
          </div>`;
        }
        gmContent += `</div>`;

        if (game.user.isGM) {
          ChatMessage.create({ content: gmContent, whisper: gmIds, speaker: messageData.speaker });
        } else {
          game.socket.emit('system.darkest-system', {
            type: 'postGmWhisper',
            content: gmContent,
            speaker: messageData.speaker,
          });
        }
      }
    }

    // Record the roll in the GM-only session log. Players roll most of the
    // time and the log is a GM-scoped world setting they can't write, so
    // delegate to a GM client (same pattern as postGmWhisper below).
    if (!this.isDamageRoll) {
      const speaker = messageData.speaker || ChatMessage.getSpeaker();
      const entry = {
        who: speaker.alias || game.user.name,
        characterRating: this.characterRating,
        taskRating: this.taskRating,
        target: this.targetNumber,
        total: this._total,
        darkestDie: this.darkestDieResult,
        outcome: this.isSpecialSuccess ? 'Special Success'
          : this.isSuccess ? 'Success'
          : this.isPartialSuccess ? 'Partial Success'
          : 'Failure',
      };
      if (game.user.isGM) {
        SessionLog.recordRoll(entry);
      } else {
        game.socket.emit('system.darkest-system', { type: 'logRoll', entry });
      }
    }

    // Fire transgression hook if applicable (GM only processes this).
    // Hooks.call() only fires locally on the client that calls it -- most
    // rolls are made by players, so their client firing this hook would
    // never reach the GM's client at all. Delegate over the socket when
    // this isn't already a GM's own client (same pattern as
    // applyWound/applyDoom/applyNpcDamage).
    if (this.isTransgression && !this.isDamageRoll) {
      const speaker = messageData.speaker || ChatMessage.getSpeaker();
      const actor = game.actors.get(speaker.actor);
      if (game.user.isGM) {
        Hooks.callAll('darkestSystem.transgression', actor, this);
      } else {
        game.socket.emit('system.darkest-system', { type: 'triggerTransgression' });
      }
    }

    // Fire doom gained hook if applicable. Same local-only Hooks.call
    // caveat as the transgression hook above: the listener both creates
    // the Doom item AND notifies the GM. A player firing this locally
    // creates the Doom fine (they own their own actor), but the GM would
    // never see the notification, so delegate that half over the socket.
    if (this.gainsDoom) {
      const speaker = messageData.speaker || ChatMessage.getSpeaker();
      const actor = game.actors.get(speaker.actor);
      Hooks.callAll('darkestSystem.doomGained', actor, this);
      if (!game.user.isGM && actor) {
        game.socket.emit('system.darkest-system', {
          type: 'notifyDoomGained',
          actorName: actor.name,
        });
      }
    }

    return super.toMessage(messageData, options);
  }
}

/**
 * Register the custom roll class
 */
export function registerDarkestRoll() {
  CONFIG.Dice.rolls.push(DarkestRoll);
}
