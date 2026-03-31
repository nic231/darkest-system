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
      // Per rules: transgression triggers if Darkest Die is higher than either of the
      // two dice you actually USE — discarded dice do not count.
      const allDiceResults = this.dice[0]?.results || [];
      const keptResults = allDiceResults.filter(r => !r.discarded).map(r => r.result);
      this.highestRegularDie = keptResults.length > 0 ? Math.max(...keptResults) : 0;

      // Check for transgression (Darkest Die is highest among kept dice)
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
      // GM flag for conditional display
      isGM: game.user.isGM,
      isPlayerTakingDamage: this.isPlayerTakingDamage ?? false
    };

    const content = await renderTemplate(
      'systems/darkest-system/templates/chat/roll-result.hbs',
      templateData
    );

    messageData.content = content;
    messageData.sound = CONFIG.sounds.dice;

    // Fire transgression hook if applicable (GM only processes this)
    if (this.isTransgression && !this.isDamageRoll) {
      // Get the actor from the speaker if available
      const speaker = messageData.speaker || ChatMessage.getSpeaker();
      const actor = game.actors.get(speaker.actor);
      Hooks.call('darkestSystem.transgression', actor, this);
    }

    // Fire doom gained hook if applicable
    if (this.gainsDoom) {
      const speaker = messageData.speaker || ChatMessage.getSpeaker();
      const actor = game.actors.get(speaker.actor);
      Hooks.call('darkestSystem.doomGained', actor, this);
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
