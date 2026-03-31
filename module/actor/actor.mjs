/**
 * Extend the base Actor class for The Darkest System
 */
import { DARKEST } from '../helpers/config.mjs';

export class DarkestActor extends Actor {

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  prepareBaseData() {
    // Data modifications in this step occur before processing embedded documents or derived data
  }

  /** @override */
  prepareDerivedData() {
    const actorData = this;
    const systemData = actorData.system;
    const flags = actorData.flags.darkestSystem || {};

    // Prepare data based on actor type
    this._prepareCharacterData(actorData);
    this._prepareNpcData(actorData);
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== 'character') return;

    const systemData = actorData.system;

    // Calculate total banes from wounds
    // Per rules: A wounded character has 1 Bane (banes don't stack from multiple wounds)
    const wounds = this.items.filter(i => i.type === 'wound' && !i.system.healed);
    systemData.totalWounds = wounds.length;
    systemData.banes = wounds.length > 0 ? 1 : 0; // Wounded = 1 bane total

    // Find highest wound rating and type (per-type tracking for unconscious/catatonia)
    const physicalWounds = wounds.filter(w => w.system.type === 'physical');
    const mentalWounds = wounds.filter(w => w.system.type === 'mental');

    // Note: auto-clearing unconscious/catatonic when wounds heal is handled by
    // the updateActor hook in darkest-system.mjs to avoid calling update() inside
    // prepareDerivedData (which is synchronous and causes recursive update cycles).
    systemData.highestPhysicalWound = physicalWounds.reduce((max, w) => Math.max(max, w.system.rating), 0);
    systemData.highestMentalWound = mentalWounds.reduce((max, w) => Math.max(max, w.system.rating), 0);

    const highestWound = wounds.reduce(
      (max, w) => w.system.rating > max.rating ? { rating: w.system.rating, type: w.system.type } : max,
      { rating: 0, type: 'physical' }
    );
    systemData.highestWoundRating = highestWound.rating;
    systemData.highestWoundType = highestWound.type;

    // Calculate total armor from equipment (armor only applies to physical wounds per rules)
    const equipment = this.items.filter(i => i.type === 'equipment');
    let physicalArmorBonus = systemData.armor?.physical || 0;

    equipment.forEach(item => {
      if (item.system.armorType === 'light') {
        physicalArmorBonus = Math.max(physicalArmorBonus, DARKEST.armorBonus.light);
      } else if (item.system.armorType === 'heavy') {
        physicalArmorBonus = Math.max(physicalArmorBonus, DARKEST.armorBonus.heavy);
      }
    });

    systemData.effectiveArmor = {
      physical: physicalArmorBonus
    };

    // Count dooms
    const dooms = this.items.filter(i => i.type === 'doom' && !i.system.resolved);
    systemData.totalDooms = dooms.length;

    // Calculate effective rating for different tasks
    systemData.effectiveRating = {
      base: systemData.rating,
      physical: systemData.rating + (systemData.ratingModifications?.physical || 0),
      mental: systemData.rating + (systemData.ratingModifications?.mental || 0),
      stealth: systemData.rating + (systemData.ratingModifications?.stealth || 0),
      social: systemData.rating + (systemData.ratingModifications?.social || 0),
      defense: {
        physical: systemData.rating + physicalArmorBonus
      }
    };
  }

  /**
   * Prepare NPC type specific data
   */
  _prepareNpcData(actorData) {
    if (actorData.type !== 'npc') return;

    const systemData = actorData.system;

    systemData.effectiveRating = {
      base: systemData.rating,
      defense: {
        physical: systemData.rating
      }
    };
  }

  /**
   * Make an action roll
   * @param {Object} options - Roll options
   * @returns {Promise<DarkestRoll>}
   */
  async rollAction(options = {}) {
    const systemData = this.system;

    // Get base rating and apply modifier from dialog
    let rating = systemData.rating;
    if (options.ratingModifier) {
      rating += options.ratingModifier;
    } else if (options.ratingType && systemData.effectiveRating?.[options.ratingType]) {
      rating = systemData.effectiveRating[options.ratingType];
    }

    // Calculate boons and banes
    // Note: Dialog already pre-populates banes from wounds, so use options directly
    let boons = options.boons || 0;
    let banes = options.banes || 0;

    // Check for abilities that grant boons
    const abilities = this.items.filter(i => i.type === 'ability' && i.system.grantsBoon);
    // GM decides which abilities apply

    const { DarkestRoll } = await import('../dice/darkest-roll.mjs');

    const roll = DarkestRoll.createActionRoll(
      rating,
      options.taskRating || 4,
      boons,
      banes,
      options.callUponWoods || false,
      options.modifierName || ''
    );

    await roll.evaluate();

    // Create chat message
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: options.flavor || `${this.name} makes an action roll`
    });

    // Note: darkestSystem.transgression and darkestSystem.doomGained hooks are fired
    // inside DarkestRoll.toMessage() — do not duplicate them here.

    return roll;
  }

  /**
   * Make a damage roll
   * @param {Object} options - Roll options
   * @returns {Promise<DarkestRoll>}
   */
  async rollDamage(options = {}) {
    const systemData = this.system;
    const attackRating = options.attackRating || systemData.rating;
    const defenseRating = options.defenseRating || 0;

    const { DarkestRoll } = await import('../dice/darkest-roll.mjs');

    const roll = DarkestRoll.createDamageRoll(
      attackRating,
      defenseRating,
      options.boons || 0,
      options.banes || 0,
      {
        woundType: options.woundType || 'physical',
        targetRating: options.targetRating || 0
      },
      {
        ratingAdjName: options.ratingAdjName || '',
        defenseAdjName: options.defenseAdjName || ''
      }
    );

    await roll.evaluate();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: options.flavor || `${this.name} deals damage`
    });

    // Fire hook so GM-side NPC tracker can apply damage to active NPC
    if (roll.isWound) {
      Hooks.call('darkestSystem.damageDealt', roll);
    }

    return roll;
  }

  /**
   * Roll to take damage (defender rolling) and auto-apply wound
   * @param {Object} options - Roll options
   * @returns {Promise<DarkestRoll>}
   */
  async rollTakeDamage(options = {}) {
    const systemData = this.system;
    const enemyAttack = options.enemyAttack || 3;
    const ownDefense = options.ownDefense || systemData.rating;
    const woundType = options.woundType || 'physical';

    const { DarkestRoll } = await import('../dice/darkest-roll.mjs');

    const roll = DarkestRoll.createDamageRoll(
      enemyAttack,
      ownDefense,
      options.boons || 0,
      options.banes || 0,
      {
        woundType: woundType,
        targetRating: ownDefense
      },
      {
        defenseAdjName: options.defenseAdjName || ''
      }
    );

    await roll.evaluate();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: options.flavor || `${this.name} takes ${woundType} damage`
    });

    // Auto-apply wound if damage was dealt
    const woundRating = roll.woundRating || 0;
    if (woundRating > 0) {
      const wound = await this.addWound(woundRating, woundType, `Damage taken in combat`);

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `<div class="darkest-wound-applied"><i class="fas fa-heart-broken"></i> <strong>${this.name}</strong> receives a <strong>${woundType}</strong> wound of Rating <strong>${woundRating}</strong>!</div>`
      });
    }

    return roll;
  }

  /**
   * Post a chat prompt for resisting unconsciousness after taking a wound.
   * Per rules: Only triggers when character already had wounds of the same type.
   * Mental wounds → catatonia check; physical → unconscious check.
   * @param {number} woundRating - The rating of the new wound
   * @param {string} woundType - 'physical' or 'mental'
   * @param {number} preExistingSameType - Count of same-type wounds BEFORE this new one
   */
  async checkUnconscious(woundRating, woundType = 'physical', preExistingSameType = 0) {
    // Only prompt if character already had wounds of this type
    if (preExistingSameType <= 0) return;

    const systemData = this.system;
    const isMental = woundType === 'mental';
    const checkLabel = isMental ? 'Catatonia' : 'Unconsciousness';

    // Highest wound of same type (now includes the new one after prepareDerivedData ran)
    const sameTypeWounds = this.items.filter(
      i => i.type === 'wound' && !i.system.healed && i.system.type === woundType
    );
    const highestSameType = sameTypeWounds.reduce((max, w) => Math.max(max, w.system.rating), 0);
    const targetNumber = 7 + highestSameType;
    const characterRating = systemData.rating || 3;
    const woundBanes = systemData.banes || 0;

    const baneNote = woundBanes > 0
      ? `<div class="prompt-bane-note"><i class="fas fa-lock"></i> You have a Bane from wounds (already pre-applied)</div>`
      : '';

    // Dice need = targetNumber - characterRating (what the 2d6 must show)
    const diceNeeded = targetNumber - characterRating;

    const content = `<div class="darkest-unconscious-prompt">
      <div class="prompt-header"><i class="fas fa-dizzy"></i> <strong>${this.name}</strong> took a ${woundType} wound and must resist ${checkLabel.toLowerCase()}!</div>
      <div class="prompt-details">
        <div class="prompt-row"><span class="prompt-label">Target number:</span><span class="prompt-value">7 + ${highestSameType} = <strong>${targetNumber}</strong></span></div>
        <div class="prompt-row"><span class="prompt-label">Your Rating reduces it:</span><span class="prompt-value">${targetNumber} − ${characterRating} = <strong>${diceNeeded}</strong></span></div>
        <div class="prompt-row highlight"><span class="prompt-label">Need on the dice:</span><span class="prompt-value">${diceNeeded} or higher (2d6${woundBanes > 0 ? ' with Bane' : ''})</span></div>
        ${baneNote}
      </div>
      <button class="resist-unconscious-btn" data-actor-id="${this.id}" data-wound-rating="${highestSameType}" data-wound-type="${woundType}"><i class="fas fa-fist-raised"></i> Resist ${checkLabel}</button>
    </div>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: content
    });
  }

  /**
   * Show dialog then roll to resist unconsciousness or catatonia.
   * Can be called from chat button or character sheet button.
   * @param {number} woundRating - The wound rating to roll against (highest of type)
   * @param {string} woundType - 'physical' or 'mental'
   */
  async rollResistUnconscious(woundRating, woundType = 'physical') {
    const systemData = this.system;
    const isMental = woundType === 'mental';
    const checkLabel = isMental ? 'Resist Catatonia' : 'Resist Unconsciousness';

    // If no rating provided, use highest wound of that type
    if (!woundRating || woundRating <= 0) {
      const sameTypeWounds = this.items.filter(
        i => i.type === 'wound' && !i.system.healed && i.system.type === woundType
      );
      woundRating = sameTypeWounds.reduce((max, w) => Math.max(max, w.system.rating), 0);
    }

    if (woundRating <= 0) {
      ui.notifications.warn(`${this.name} has no ${woundType} wounds — no check needed.`);
      return false;
    }

    const characterRating = systemData.rating || 3;
    const woundBanes = systemData.banes || 0;
    const diceNeeded = (7 + woundRating) - characterRating;

    const rawMods = systemData.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: characterRating + (mod.value || 0)
    }));

    const equipment = this.items.filter(i => i.type === 'equipment');

    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/check-dialog.hbs',
      { checkLabel, woundRating, characterRating, woundBanes, diceNeeded, ratingModifiers, equipment }
    );

    return new Promise((resolve) => {
      new Dialog({
        title: checkLabel,
        content: dialogContent,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice"></i>',
            label: 'Roll',
            callback: async (html) => {
              const boons = parseInt(html.find('[name="boons"]').val()) || 0;
              const banes = parseInt(html.find('[name="banes"]').val()) || 0;
              const modifierSelect = html.find('[name="ratingModifier"]');
              const ratingModifier = parseInt(modifierSelect.find('option:selected').data('modifier')) || 0;
              const effectiveRating = characterRating + ratingModifier;

              const { DarkestRoll } = await import('../dice/darkest-roll.mjs');
              const roll = DarkestRoll.createActionRoll(effectiveRating, woundRating, boons, banes, false);
              await roll.evaluate();

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor: this }),
                flavor: `${this.name} resists ${isMental ? 'catatonia' : 'unconsciousness'} (vs ${woundType} Wound Rating ${woundRating})`
              });

              if (!roll.isSuccess) {
                const statusFlag = isMental ? 'system.catatonic' : 'system.unconscious';
                await this.update({ [statusFlag]: true });
                const icon = isMental ? 'fa-brain' : 'fa-dizzy';
                const statusText = isMental ? 'falls catatonic' : 'falls unconscious';
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: this }),
                  content: `<div class="darkest-unconscious"><i class="fas ${icon}"></i> <strong>${this.name}</strong> ${statusText}!</div>`
                });
              }
              resolve(!roll.isSuccess);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false)
          }
        },
        default: 'roll',
        render: (html) => {
          // Reuse counter button + descriptor logic inline (no sheet reference here)
          html.find('.counter-btn').on('click', (event) => {
            event.preventDefault();
            const btn = event.currentTarget;
            const field = btn.dataset.field;
            const input = html.find(`[name="${field}"]`);
            const min = field === 'banes' ? (parseInt(input.data('wound-banes')) || 0) : 0;
            let value = parseInt(input.val()) || 0;
            if (btn.classList.contains('increment')) value = Math.min(value + 1, 5);
            else if (btn.classList.contains('decrement')) value = Math.max(value - 1, min);
            input.val(value).trigger('change');
          });

          // Live target number update
          const modifierSelect = html.find('[name="ratingModifier"]');
          const boonsInput = html.find('[name="boons"]');
          const banesInput = html.find('[name="banes"]');
          const targetNeed = html.find('.target-need');
          const effectiveRatingDisplay = html.find('.effective-rating-display');

          const updateDisplay = () => {
            const ratingMod = parseInt(modifierSelect.find('option:selected').data('modifier')) || 0;
            const effectiveRating = characterRating + ratingMod;
            const need = (7 + woundRating) - effectiveRating;
            effectiveRatingDisplay.text(effectiveRating);
            targetNeed.text(need);
          };

          modifierSelect.on('change', updateDisplay);
          boonsInput.on('change', updateDisplay);
          banesInput.on('change', updateDisplay);
          updateDisplay();

          html.find('.dialog-equip-header').on('click', () => {
            html.find('.dialog-equip-header').toggleClass('collapsed');
            html.find('.dialog-equip-list').toggleClass('collapsed');
          });
        }
      }, { width: 380, height: 'auto' }).render(true);
    });
  }

  /**
   * Show dialog then make a death/catatonia check.
   * Per rules: Roll against highest wound rating MINUS total dooms.
   * Mental wounds → catatonia check; physical → death check.
   * Success = survive and lose 1 doom. Failure = death or catatonia.
   * @returns {Promise<boolean>} - True if character survives
   */
  async rollDeathCheck() {
    const systemData = this.system;
    const highestWound = systemData.highestWoundRating || 0;
    const highestWoundType = systemData.highestWoundType || 'physical';
    const isMental = highestWoundType === 'mental';
    const checkLabel = isMental ? 'Catatonia Check' : 'Death Check';
    const totalDooms = systemData.totalDooms || 0;
    const characterRating = systemData.rating || 3;
    const woundBanes = systemData.banes || 0;

    if (highestWound <= 0) {
      ui.notifications.info(`${this.name} has no wounds - no check needed.`);
      return true;
    }

    // Dooms subtract from effective rating (making the check harder), not from difficulty
    const effectiveRatingWithDooms = Math.max(1, characterRating - totalDooms);
    const diceNeeded = (7 + highestWound) - effectiveRatingWithDooms;

    const rawMods = systemData.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: characterRating + (mod.value || 0)
    }));

    const equipment = this.items.filter(i => i.type === 'equipment');

    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/check-dialog.hbs',
      { checkLabel, woundRating: highestWound, characterRating: effectiveRatingWithDooms, woundBanes, diceNeeded, ratingModifiers, equipment }
    );

    return new Promise((resolve) => {
      new Dialog({
        title: checkLabel,
        content: dialogContent,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice"></i>',
            label: 'Roll',
            callback: async (html) => {
              const boons = parseInt(html.find('[name="boons"]').val()) || 0;
              const banes = parseInt(html.find('[name="banes"]').val()) || 0;
              const modifierSelect = html.find('[name="ratingModifier"]');
              const ratingModifier = parseInt(modifierSelect.find('option:selected').data('modifier')) || 0;
              const finalRating = Math.max(1, effectiveRatingWithDooms + ratingModifier);
              const { DarkestRoll } = await import('../dice/darkest-roll.mjs');
              const roll = DarkestRoll.createActionRoll(finalRating, highestWound, boons, banes, false);
              await roll.evaluate();

              const checkIcon = isMental ? 'fa-brain' : 'fa-heartbeat';
              const targetNumber = 7 + highestWound;
              const doomLine = totalDooms > 0
                ? `<div class="breakdown-row"><span class="label">Dooms:</span><span class="value">−${totalDooms} (reduces your effective rating)</span></div>
                   <div class="breakdown-row calculation"><span class="label">Effective Rating:</span><span class="value">${characterRating} − ${totalDooms} = <strong>${effectiveRatingWithDooms}</strong></span></div>`
                : '';
              const skillLine = ratingModifier !== 0
                ? `<div class="breakdown-row"><span class="label">Skill Modifier:</span><span class="value">${ratingModifier >= 0 ? '+' : ''}${ratingModifier}</span></div>
                   <div class="breakdown-row calculation"><span class="label">Final Rating:</span><span class="value"><strong>${finalRating}</strong></span></div>`
                : '';
              const flavorText = `<div class="death-check-breakdown">
                <h3><i class="fas ${checkIcon}"></i> ${checkLabel.toUpperCase()} for ${this.name}</h3>
                <div class="breakdown-section">
                  <div class="breakdown-row"><span class="label">Highest Wound Rating:</span><span class="value">${highestWound}</span></div>
                  <div class="breakdown-row"><span class="label">Target Number:</span><span class="value">7 + ${highestWound} = <strong>${targetNumber}</strong></span></div>
                </div>
                <div class="breakdown-section">
                  <div class="breakdown-row"><span class="label">Character Rating:</span><span class="value">${characterRating}</span></div>
                  ${doomLine}${skillLine}
                  <div class="breakdown-row"><span class="label">Roll:</span><span class="value">2d6 + Rating ${finalRating} vs Target ${targetNumber}</span></div>
                </div>
              </div>`;

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor: this }),
                flavor: flavorText
              });

              if (roll.isSuccess) {
                const dooms = this.items.filter(i => i.type === 'doom' && !i.system.resolved);
                let doomLine = '';
                if (dooms.length > 0) {
                  await dooms[0].update({ 'system.resolved': true });
                  const remainingDooms = dooms.length - 1;
                  doomLine = `<p class="doom-fade">One Doom fades away (${dooms.length} → ${remainingDooms} remaining)</p>`;
                }
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: this }),
                  content: `<div class="death-check-outcome success"><div class="outcome-icon"><i class="fas fa-check-circle"></i></div><div class="outcome-text"><strong>SUCCESS</strong> — ${this.name} survives!${doomLine}</div></div>`
                });
                resolve(true);
              } else {
                const failureText = isMental ? `${this.name} falls completely catatonic...` : `${this.name} bleeds out...`;
                const failureLabel = isMental ? 'The character is catatonic.' : 'The character has died.';
                const failureIcon = isMental ? 'fa-brain' : 'fa-skull-crossbones';
                ChatMessage.create({
                  speaker: ChatMessage.getSpeaker({ actor: this }),
                  content: `<div class="death-check-outcome failure"><div class="outcome-icon"><i class="fas ${failureIcon}"></i></div><div class="outcome-text"><strong>FAILURE</strong> — ${failureText}<p class="death-message">${failureLabel}</p></div></div>`
                });
                if (isMental) {
                  await this.update({ 'system.catatonic': true });
                } else {
                  await this.update({ 'system.dead': true });
                }
                resolve(false);
              }
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(true)
          }
        },
        default: 'roll',
        render: (html) => {
          html.find('.counter-btn').on('click', (event) => {
            event.preventDefault();
            const btn = event.currentTarget;
            const field = btn.dataset.field;
            const input = html.find(`[name="${field}"]`);
            const min = field === 'banes' ? (parseInt(input.data('wound-banes')) || 0) : 0;
            let value = parseInt(input.val()) || 0;
            if (btn.classList.contains('increment')) value = Math.min(value + 1, 5);
            else if (btn.classList.contains('decrement')) value = Math.max(value - 1, min);
            input.val(value).trigger('change');
          });

          const modifierSelect = html.find('[name="ratingModifier"]');
          const targetNeed = html.find('.target-need');
          const effectiveRatingDisplay = html.find('.effective-rating-display');

          const updateDisplay = () => {
            const ratingMod = parseInt(modifierSelect.find('option:selected').data('modifier')) || 0;
            const effective = characterRating + ratingMod;
            const need = (7 + effectiveDifficulty) - effective;
            effectiveRatingDisplay.text(effective);
            targetNeed.text(need);
          };

          modifierSelect.on('change', updateDisplay);
          updateDisplay();

          html.find('.dialog-equip-header').on('click', () => {
            html.find('.dialog-equip-header').toggleClass('collapsed');
            html.find('.dialog-equip-list').toggleClass('collapsed');
          });
        }
      }, { width: 380, height: 'auto' }).render(true);
    });
  }

  /**
   * Spend a doom - gives GM permission to do something terrible
   * Per rules: Player can spend 1 Doom to lower their total,
   * but gives GM permission to inflict something bad.
   */
  async spendDoom() {
    const dooms = this.items.filter(i => i.type === 'doom' && !i.system.resolved);

    if (dooms.length === 0) {
      ui.notifications.warn(`${this.name} has no Dooms to spend!`);
      return false;
    }

    // Mark the oldest doom as spent
    const spentDoom = dooms[0];
    await spentDoom.update({ 'system.resolved': true });

    // Create a message visible to everyone, with GM whisper for the "permission" part
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="darkest-doom-spent"><i class="fas fa-skull"></i> <strong>${this.name} spends a Doom!</strong><p class="doom-consequence">The character's doom count decreases, but something terrible will happen...</p></div>`
    });

    // Whisper to GM about what they can do
    ChatMessage.create({
      content: `<div class="darkest-doom-spent-gm"><i class="fas fa-skull"></i> <strong>${this.name} has spent a Doom!</strong>
        <p>You may now inflict something terrible upon them:</p>
        <ul>
          <li>A horrific vision (inflict a mental wound)</li>
          <li>Attack by a ghost or inhabitant of the woods</li>
          <li>Vital equipment breaks at the worst moment</li>
          <li>Beneficial magic ends early or malfunctions</li>
          <li>Or anything significant and bad for the character</li>
        </ul>
        <p><em>You don't need to use this immediately - you may accumulate spent Dooms.</em></p>
      </div>`,
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });

    ui.notifications.info(`${this.name} has spent a Doom. Await the GM's terrible response...`);
    return true;
  }

  /**
   * Add a wound to the character
   * @param {number} rating - Wound rating
   * @param {string} type - 'physical' or 'mental'
   * @param {string} description - Optional description
   */
  async addWound(rating, type = 'physical', description = '') {
    if (rating <= 0) return null;

    // Count pre-existing wounds of SAME TYPE before creating new one
    // (createEmbeddedDocuments triggers prepareDerivedData, so we must count now)
    const preExistingSameType = this.items.filter(
      i => i.type === 'wound' && !i.system.healed && i.system.type === type
    ).length;

    const woundData = {
      name: `${type === 'mental' ? 'Mental' : 'Physical'} Wound (${rating})`,
      type: 'wound',
      system: {
        rating: rating,
        type: type,
        description: description,
        healed: false
      }
    };

    const [wound] = await this.createEmbeddedDocuments('Item', [woundData]);

    // Check for unconsciousness/catatonia — only if already had wounds of same type
    await this.checkUnconscious(rating, type, preExistingSameType);

    return wound;
  }

  /**
   * Add a doom to the character
   * @param {string} description - Doom description
   * @param {string} source - Source of the doom
   */
  async addDoom(description = 'A nameless dread', source = 'The Woods') {
    const doomData = {
      name: `Doom: ${description.substring(0, 30)}...`,
      type: 'doom',
      system: {
        description: description,
        effect: '',
        source: source,
        resolved: false
      }
    };

    const [doom] = await this.createEmbeddedDocuments('Item', [doomData]);
    return doom;
  }

  /**
   * Roll to rest and recover from wounds.
   * Rolls 2d6 + Rating vs 7 + each wound's Rating.
   * Success: wound marked healed. Failure: wound locked for 24 hours.
   */
  async rollRest() {
    const characterRating = this.system.rating || 3;
    const woundBanes = this.system.banes || 0;

    const activeWounds = this.items.filter(i => i.type === 'wound' && !i.system.healed);
    if (activeWounds.length === 0) {
      ui.notifications.info(`${this.name} has no active wounds to recover from.`);
      return;
    }

    // Locked wounds are those where restFailedAt is set (cleared by player/GM when ready)
    const recoverableWounds = activeWounds.filter(w => !w.system.restFailedAt);
    const lockedWounds = activeWounds.filter(w => w.system.restFailedAt);

    if (recoverableWounds.length === 0) {
      ui.notifications.warn(`${this.name} cannot rest — all wounds are locked. Unlock them when enough time has passed.`);
      return;
    }

    const lockedNote = lockedWounds.length
      ? `<p class="locked-wounds-note"><i class="fas fa-lock"></i> ${lockedWounds.length} wound(s) locked — unlock when the GM allows.</p>`
      : '';

    const physicalWounds = recoverableWounds.filter(w => w.system.type === 'physical');
    const mentalWounds = recoverableWounds.filter(w => w.system.type === 'mental');

    const buildWoundList = (wounds) => wounds.map(w =>
      `<li class="rest-wound-entry">
        <span class="rating-badge ${w.system.type}">${w.system.rating}</span>
        <span class="rest-wound-name">${w.name}</span>
        <span class="rest-wound-target">target ${7 + w.system.rating}</span>
      </li>`
    ).join('');

    const buildBoonBane = (prefix, baseBanes) => `
      <div class="form-group boon-bane-group">
        <label>Boons</label>
        <div class="counter-controls">
          <button type="button" class="counter-btn decrement" data-field="${prefix}-boons"><i class="fas fa-minus"></i></button>
          <input type="number" name="${prefix}-boons" value="0" min="0" max="5" readonly />
          <button type="button" class="counter-btn increment" data-field="${prefix}-boons"><i class="fas fa-plus"></i></button>
        </div>
      </div>
      <div class="form-group boon-bane-group">
        <label>Banes</label>
        <div class="counter-controls">
          <button type="button" class="counter-btn decrement" data-field="${prefix}-banes"><i class="fas fa-minus"></i></button>
          <input type="number" name="${prefix}-banes" value="${baseBanes}" min="${baseBanes}" max="10" readonly />
          <button type="button" class="counter-btn increment" data-field="${prefix}-banes"><i class="fas fa-plus"></i></button>
        </div>
        ${baseBanes ? `<small class="hint locked-banes"><i class="fas fa-lock"></i> ${baseBanes} from wounds (cannot reduce)</small>` : ''}
      </div>`;

    const physicalSection = physicalWounds.length ? `
      <div class="rest-type-section">
        <h4 class="rest-type-header physical"><i class="fas fa-fist-raised"></i> Physical Wounds</h4>
        <ul class="rest-wound-list">${buildWoundList(physicalWounds)}</ul>
        ${buildBoonBane('physical', woundBanes)}
      </div>` : '';

    const mentalSection = mentalWounds.length ? `
      <div class="rest-type-section">
        <h4 class="rest-type-header mental"><i class="fas fa-brain"></i> Mental Wounds</h4>
        <ul class="rest-wound-list">${buildWoundList(mentalWounds)}</ul>
        ${buildBoonBane('mental', woundBanes)}
      </div>` : '';

    const dialogContent = `
      <form class="darkest-dialog rest-dialog">
        <div class="rest-summary">
          <span>Rating <strong>${characterRating}</strong></span>
          <span class="rest-sep">·</span>
          <span><strong>${recoverableWounds.length}</strong> wound(s) to roll for</span>
        </div>
        ${lockedNote}
        ${physicalSection}
        ${mentalSection}
      </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: `${this.name} — Rest`,
        content: dialogContent,
        buttons: {
          roll: {
            icon: '<i class="fas fa-campfire"></i>',
            label: 'Rest',
            callback: async (html) => {
              const physBoons = parseInt(html.find('[name="physical-boons"]').val()) || 0;
              const physBanes = parseInt(html.find('[name="physical-banes"]').val()) || 0;
              const mentBoons = parseInt(html.find('[name="mental-boons"]').val()) || 0;
              const mentBanes = parseInt(html.find('[name="mental-banes"]').val()) || 0;

              const { DarkestRoll } = await import('../dice/darkest-roll.mjs');
              const results = [];

              for (const wound of recoverableWounds) {
                const boons = wound.system.type === 'mental' ? mentBoons : physBoons;
                const banes = wound.system.type === 'mental' ? mentBanes : physBanes;
                const roll = DarkestRoll.createActionRoll(characterRating, wound.system.rating, boons, banes, false);
                await roll.evaluate();

                const success = roll.isSuccess || roll.isAutoSuccess;
                const woundLabel = `${wound.name} (Rating ${wound.system.rating})`;

                if (success) {
                  await wound.update({ 'system.healed': true, 'system.restFailedAt': null });
                } else {
                  await wound.update({ 'system.restFailedAt': true });
                }

                // Build dice HTML for this wound's roll
                const diceResults = roll.dice[0]?.results || [];
                const keptDice = diceResults.filter(r => !r.discarded);
                const discardedDice = diceResults.filter(r => r.discarded);
                const diceHtml = diceResults.map(r =>
                  `<span class="die d6 damage-die${r.discarded ? ' discarded' : ''}">${r.result}</span>`
                ).join('');

                results.push({ success, label: woundLabel, total: roll.total, target: roll.targetNumber, diceHtml, rating: characterRating, keptDice, discardedDice });
              }

              const allSuccess = results.every(r => r.success);
              const anySuccess = results.some(r => r.success);
              const outcomeClass = allSuccess ? 'success' : anySuccess ? 'partial-success' : 'failure';
              const outcomeLabel = allSuccess ? 'Full recovery!' : anySuccess ? 'Partial recovery' : 'No recovery';
              const outcomeIcon = allSuccess ? 'fa-heart' : anySuccess ? 'fa-adjust' : 'fa-heart-broken';

              const woundSections = results.map(r => {
                // Build per-column cells: each kept die gets its own labelled cell
                const dieCells = r.keptDice.map(d =>
                  `<div class="rest-roll-cell">
                    <span class="rest-roll-cell-label">d6</span>
                    <span class="die d6 damage-die">${d.result}</span>
                  </div>`
                ).join('');
                const discardedCells = r.discardedDice.map(d =>
                  `<div class="rest-roll-cell discarded-cell">
                    <span class="rest-roll-cell-label">d6</span>
                    <span class="die d6 damage-die discarded">${d.result}</span>
                  </div>`
                ).join('');
                return `
                <div class="rest-wound-result ${r.success ? 'rest-success' : 'rest-failure'}">
                  <div class="rest-wound-label">
                    <i class="fas ${r.success ? 'fa-heart' : 'fa-heart-broken'}"></i>
                    <strong>${r.label}</strong>
                    <span class="rest-wound-outcome">${r.success ? 'Recovered' : 'Failed'}</span>
                  </div>
                  <div class="rest-roll-row">
                    ${discardedCells}
                    ${dieCells}
                    <span class="dice-op">+</span>
                    <div class="rest-roll-cell">
                      <span class="rest-roll-cell-label">Rating</span>
                      <span class="rating-component attack">${r.rating}</span>
                    </div>
                    <span class="dice-op">=</span>
                    <div class="rest-roll-cell">
                      <span class="rest-roll-cell-label">Total</span>
                      <span class="dice-total">${r.total}</span>
                    </div>
                    <span class="dice-op" style="font-size:11px;opacity:0.6">vs</span>
                    <div class="rest-roll-cell">
                      <span class="rest-roll-cell-label">Target</span>
                      <span class="rest-target-number">${r.target}</span>
                    </div>
                  </div>
                  ${r.success ? '' : '<div class="rest-locked-note"><i class="fas fa-lock"></i> Locked — unlock when GM allows</div>'}
                </div>`;
              }).join('');

              const content = `
                <div class="darkest-roll action-roll ${outcomeClass}">
                  <div class="roll-header">
                    <h3 class="roll-title"><i class="fas fa-campfire"></i> ${this.name} — Rest</h3>
                  </div>
                  <div class="roll-result">
                    <div class="outcome ${outcomeClass}">
                      <i class="fas ${outcomeIcon}"></i> ${outcomeLabel}
                    </div>
                  </div>
                  <div class="rest-wound-results">${woundSections}</div>
                </div>`;

              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this }),
                content
              });

              resolve(true);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false)
          }
        },
        default: 'roll',
        render: (html) => {
          html.find('.counter-btn').on('click', (event) => {
            event.preventDefault();
            const btn = event.currentTarget;
            const field = btn.dataset.field;
            const input = html.find(`[name="${field}"]`);
            const min = parseInt(input.attr('min')) || 0;
            let value = parseInt(input.val()) || 0;
            if (btn.classList.contains('increment')) value = Math.min(value + 1, 10);
            else if (btn.classList.contains('decrement')) value = Math.max(value - 1, min);
            input.val(value);
          });
        }
      }).render(true);
    });
  }
}
