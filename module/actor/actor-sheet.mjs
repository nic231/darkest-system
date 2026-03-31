import { DARKEST } from '../helpers/config.mjs';

/**
 * Extend the basic ActorSheet for The Darkest System
 */
export class DarkestActorSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['darkest-system', 'sheet', 'actor'],
      width: 560,
      height: 680,
      resizable: true,
      tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'main' }]
    });
  }

  /** @override */
  get template() {
    return `systems/darkest-system/templates/actor/actor-${this.actor.type}-sheet.hbs`;
  }

  /** @override */
  async getData() {
    const context = await super.getData();

    // Use a safe clone of the actor data for further operations
    const actorData = this.document.toObject(false);

    // Add the actor's data to context for easier access
    context.system = actorData.system;
    context.flags = actorData.flags;

    // Add config data
    context.config = DARKEST;

    // Prepare character data
    if (actorData.type === 'character') {
      this._prepareCharacterData(context);
    } else if (actorData.type === 'npc') {
      this._prepareNpcData(context);
    }

    // Prepare items
    this._prepareItems(context);

    // Add roll data for formulas
    context.rollData = this.actor.getRollData();

    context.isGM = game.user.isGM;

    // Enrich HTML content in parallel
    const opts = { async: true, rollData: context.rollData };
    [
      context.enrichedBiography,
      context.enrichedNotes,
      context.enrichedDescription,
      context.enrichedTactics,
      context.enrichedAbilities
    ] = await Promise.all([
      TextEditor.enrichHTML(context.system.biography || '', opts),
      TextEditor.enrichHTML(context.system.notes || '', opts),
      TextEditor.enrichHTML(context.system.description || '', opts),
      TextEditor.enrichHTML(context.system.tactics || '', opts),
      TextEditor.enrichHTML(context.system.abilities || '', opts)
    ]);

    return context;
  }

  /**
   * Organize character-specific data
   */
  _prepareCharacterData(context) {
    // Build rating display array (1-10 scale)
    context.ratingDots = [];
    const rating = context.system.rating || 3;
    for (let i = 1; i <= 10; i++) {
      context.ratingDots.push({
        value: i,
        filled: i <= rating,
        class: i <= rating ? 'filled' : 'empty'
      });
    }

    // Calculate effective ratings
    context.effectiveRatings = this.actor.system.effectiveRating || {};

    // Total banes from wounds
    context.totalBanes = this.actor.system.banes || 0;
    context.highestWoundRating = this.actor.system.highestWoundRating || 0;

    // Per-type wound counts (for Resist button visibility)
    const wounds = this.actor.items.filter(i => i.type === 'wound' && !i.system.healed);
    context.totalPhysicalWounds = wounds.filter(w => w.system.type === 'physical').length;
    context.totalMentalWounds = wounds.filter(w => w.system.type === 'mental').length;
    context.canResistUnconscious = context.totalPhysicalWounds > 1 || context.totalMentalWounds > 1;

    // Death/catatonia check only relevant when unconscious/catatonic and has wounds
    const isUnconscious = context.system.unconscious || context.system.catatonic || false;
    context.canDeathCheck = isUnconscious && context.highestWoundRating > 0;
    context.deathCheckUrgent = isUnconscious && context.highestWoundRating > (context.system.rating || 3);

    // Effective armor
    context.effectiveArmor = this.actor.system.effectiveArmor || { physical: 0, mental: 0 };

    // Prepare custom modifications with effective values
    const baseRating = context.system.rating || 3;
    const rawMods = context.system.customModifications;
    // Ensure customModifications is an array (Foundry may store as object on older data)
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    context.customModifications = modsArray.map((mod, index) => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: baseRating + (mod.value || 0)
    }));
  }

  /**
   * Organize NPC-specific data
   */
  _prepareNpcData(context) {
    context.ratingDots = [];
    const rating = context.system.rating || 3;
    for (let i = 1; i <= 10; i++) {
      context.ratingDots.push({
        value: i,
        filled: i <= rating,
        class: i <= rating ? 'filled' : 'empty'
      });
    }
    // Expose region as a top-level variable to avoid flag namespace hyphen issues in templates
    context.region = context.flags?.['darkest-woods']?.region || '';
  }

  /**
   * Organize and classify items into categories
   */
  _prepareItems(context) {
    // Initialize containers
    const wounds = [];
    const dooms = [];
    const abilities = [];
    const equipment = [];

    // Iterate through items and assign to containers
    for (let i of this.actor.items) {
      i.img = i.img || Item.DEFAULT_ICON;

      if (i.type === 'wound') {
        wounds.push(i);
      } else if (i.type === 'doom') {
        dooms.push(i);
      } else if (i.type === 'ability') {
        abilities.push(i);
      } else if (i.type === 'equipment') {
        equipment.push(i);
      }
    }

    // Sort wounds by rating (highest first)
    wounds.sort((a, b) => (b.system.rating || 0) - (a.system.rating || 0));

    // Assign to context
    context.wounds = wounds;
    context.dooms = dooms;
    context.abilities = abilities;
    context.equipment = equipment;

    // Mark wounds as rest-locked (failed rest roll, waiting for GM to unlock)
    for (const w of wounds) {
      w.restLocked = !!w.system.restFailedAt;
    }

    // Count active (unhealed) wounds
    context.activeWounds = wounds.filter(w => !w.system.healed);
    context.healedWounds = wounds.filter(w => w.system.healed);

    // Count unresolved dooms
    context.unresolvedDooms = dooms.filter(d => !d.system.resolved);
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Rating dots click handler
    html.find('.rating-dot').click(this._onRatingClick.bind(this));

    // Full-size image popup — click the portrait directly
    html.find('.profile-img.clickable').click(() => {
      const src = this.actor.img;
      if (!src || src === 'icons/svg/mystery-man.svg') return;
      new ImagePopout(src, { title: this.actor.name, shareable: true }).render(true);
    });

    // Edit button triggers Foundry's native file picker via the hidden data-edit img
    html.find('.profile-img-edit').click(() => {
      html.find('.profile-img-edit-target').trigger('click');
    });

    // Roll buttons
    html.find('.roll-action').click(this._onActionRoll.bind(this));
    html.find('.roll-deal-damage').click(this._onDealDamageRoll.bind(this));
    html.find('.roll-take-damage').click(this._onTakeDamageRoll.bind(this));

    // Item controls
    html.find('.item-create').click(this._onItemCreate.bind(this));
    html.find('.item-edit').click(this._onItemEdit.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));

    // Wound healing toggle
    html.find('.wound-heal').click(this._onWoundHeal.bind(this));

    // Doom resolve toggle
    html.find('.doom-resolve').click(this._onDoomResolve.bind(this));

    // Doom spend button
    html.find('.doom-spend').click(this._onDoomSpend.bind(this));

    // Resist unconsciousness/catatonia button
    html.find('.resist-unconscious').click(this._onResistUnconscious.bind(this));

    // Death check button
    html.find('.death-check').click(this._onDeathCheck.bind(this));

    // Heal wound button (choose lowest, highest, or specific)
    html.find('.heal-wound-btn').click(this._onHealWound.bind(this));

    // Rest to recover from wounds
    html.find('.rest-wounds').click(this._onRestWounds.bind(this));

    // GM: unlock a rest-locked wound
    html.find('.wound-unlock').click(this._onWoundUnlock.bind(this));

    // Custom rating modifications
    html.find('.add-modification').click(this._onAddModification.bind(this));
    html.find('.remove-modification').click(this._onRemoveModification.bind(this));

    // Collapsible sections
    html.find('.collapsible-header').click(this._onToggleCollapse.bind(this));

    // Drag events for items
    if (this.actor.isOwner) {
      let handler = ev => super._onDragStart(ev);
      html.find('.item-list .item').each((i, li) => {
        if (li.classList.contains('item-header')) return;
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
      });
    }
  }

  /**
   * Handle clicking rating dots to set rating
   */
  async _onRatingClick(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const value = parseInt(element.dataset.value);
    const field = element.dataset.field || 'system.rating';

    await this.actor.update({ [field]: value });
  }

  /**
   * Handle action roll button
   */
  async _onActionRoll(event) {
    event.preventDefault();

    const characterRating = this.actor.system.rating || 3;
    const woundBanes = this.actor.system.banes || 0;

    // Prepare rating modifiers with effective values
    const rawMods = this.actor.system.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: characterRating + (mod.value || 0)
    }));

    const equipment = this.actor.items.filter(i => i.type === 'equipment');

    // Recall last used skill modifier
    const lastMod = (await game.user.getFlag('darkest-system', 'lastActionModifier')) || {};

    // Show dialog to configure the roll
    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/roll-dialog.hbs',
      {
        taskDifficulty: Object.values(DARKEST.taskDifficulty),
        defaultTaskRating: 4,
        defaultTargetNeed: Math.max(2, 7 + 4 - characterRating),
        banes: woundBanes,
        woundBanes: woundBanes,
        characterRating: characterRating,
        ratingModifiers: ratingModifiers,
        equipment: equipment,
        lastModifierName: lastMod.name || '',
        isHouseMode: game.settings.get('darkest-system', 'gameMode') === 'darkest-house'
      }
    );

    new Dialog({
      title: game.i18n.localize('DARKEST.Dialog.RollTitle'),
      content: dialogContent,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice"></i>',
          label: game.i18n.localize('DARKEST.Dialog.Roll'),
          callback: async (html) => {
            const taskRating = parseInt(html.find('[name="taskRating"]').val()) || 4;
            const boons = parseInt(html.find('[name="boons"]').val()) || 0;
            const banes = parseInt(html.find('[name="banes"]').val()) || 0;
            const callUponWoods = html.find('[name="callUponWoods"]').is(':checked');

            // Get selected rating modifier
            const modifierSelect = html.find('[name="ratingModifier"]');
            const selectedOption = modifierSelect.find('option:selected');
            const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
            const modifierName = modifierSelect.val() || null;

            // Remember last used modifier for next time
            await game.user.setFlag('darkest-system', 'lastActionModifier', { name: modifierName || '' });

            await this.actor.rollAction({
              taskRating,
              boons,
              banes,
              callUponWoods,
              ratingModifier,
              modifierName,
              flavor: modifierName
                ? `${this.actor.name} makes an action roll (${modifierName})`
                : `${this.actor.name} makes an action roll`
            });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('DARKEST.Dialog.Cancel')
        }
      },
      default: 'roll',
      render: (html) => {
        this._setupCounterButtons(html, woundBanes);

        // Restore last used modifier selection
        if (lastMod.name) {
          html.find('[name="ratingModifier"] option').filter(function() {
            return $(this).val() === lastMod.name;
          }).prop('selected', true);
        }

        const taskSelect = html.find('[name="taskRating"]');
        const modifierSelect = html.find('[name="ratingModifier"]');
        const boonsInput = html.find('[name="boons"]');
        const banesInput = html.find('[name="banes"]');
        const taskRatingDisplay = html.find('.task-rating-display');
        const effectiveRatingDisplay = html.find('.effective-rating-display');
        const targetNeedDisplay = html.find('.target-need');
        const indicator = html.find('.special-success-indicator');
        const indicatorText = indicator.find('.indicator-text');
        const descriptor = html.find('.boon-bane-descriptor');
        const descriptorText = html.find('.boon-bane-text');

        const updateDisplay = () => {
          const taskRating = parseInt(taskSelect.val()) || 4;
          const boons = parseInt(boonsInput.val()) || 0;
          const banes = parseInt(banesInput.val()) || 0;
          const netBoon = boons - banes;

          const selectedOption = modifierSelect.find('option:selected');
          const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
          const effectiveRating = characterRating + ratingModifier;

          const targetNumber = 7 + taskRating;
          const diceNeeded = targetNumber - effectiveRating;

          taskRatingDisplay.text(taskRating);
          effectiveRatingDisplay
            .text(effectiveRating)
            .removeClass('boon bane neutral')
            .addClass(netBoon > 0 ? 'boon' : netBoon < 0 ? 'bane' : 'neutral');
          targetNeedDisplay.text(Math.max(2, diceNeeded));

          // Action roll: any net boon/bane = 3d6, keep best/worst 2. Stacking has no effect.
          if (netBoon > 0) {
            descriptor.show();
            descriptorText.removeClass('bane-text').addClass('boon-text')
              .text(`Boon: roll 3d6, keep the best 2 — fortune favours you.`);
          } else if (netBoon < 0) {
            descriptor.show();
            descriptorText.removeClass('boon-text').addClass('bane-text')
              .text(`Bane: roll 3d6, keep the worst 2 — the odds are against you.`);
          } else {
            descriptor.hide();
          }

          const specialEnabled = game.settings.get('darkest-system', 'enableSpecialSuccess');
          if (!specialEnabled) {
            indicator.hide();
          } else {
            const isPossible = targetNumber < 6 + effectiveRating;
            indicator.show();
            if (isPossible) {
              indicator.addClass('possible').removeClass('not-possible');
              indicatorText.text('Special Success possible!');
            } else {
              indicator.removeClass('possible').addClass('not-possible');
              indicatorText.text('Special Success NOT possible');
            }
          }
        };

        taskSelect.on('change', updateDisplay);
        modifierSelect.on('change', updateDisplay);
        boonsInput.on('change', updateDisplay);
        banesInput.on('change', updateDisplay);
        updateDisplay();

        html.find('.dialog-equip-header').on('click', () => {
          html.find('.dialog-equip-header').toggleClass('collapsed');
          html.find('.dialog-equip-list').toggleClass('collapsed');
        });
      }
    }, { width: 400, height: 'auto' }).render(true);
  }

  /**
   * Handle "Deal Damage" roll button (attacker rolling)
   */
  async _onDealDamageRoll(event) {
    event.preventDefault();

    const characterRating = this.actor.system.rating || 3;
    const woundBanes = this.actor.system.banes || 0;

    const rawMods = this.actor.system.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: characterRating + (mod.value || 0)
    }));

    const equipment = this.actor.items.filter(i => i.type === 'equipment');
    const damageEquipment = equipment.filter(i => (i.system.damageRatingBonus || 0) > 0);
    const otherEquipment = equipment.filter(i => !(i.system.damageRatingBonus || 0));

    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/deal-damage-dialog.hbs',
      {
        characterRating: characterRating,
        ratingModifiers: ratingModifiers,
        taskDifficulty: Object.values(DARKEST.taskDifficulty),
        banes: woundBanes,
        woundBanes: woundBanes,
        damageEquipment: damageEquipment,
        otherEquipment: otherEquipment
      }
    );

    new Dialog({
      title: game.i18n.localize('DARKEST.Roll.DealDamage'),
      content: dialogContent,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice"></i>',
          label: game.i18n.localize('DARKEST.Dialog.Roll'),
          callback: async (html) => {
            const targetRating = parseInt(html.find('[name="targetRating"]').val()) || 0;
            const boons = parseInt(html.find('[name="boons"]').val()) || 0;
            const banes = parseInt(html.find('[name="banes"]').val()) || 0;
            const ratingAdj = parseInt(html.find('[name="ratingAdj"]').val()) || 0;

            const modifierSelect = html.find('[name="ratingModifier"]');
            const selectedOption = modifierSelect.find('option:selected');
            const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
            const modifierName = modifierSelect.val() || null;

            const effectiveAttackRating = characterRating + ratingModifier + ratingAdj;

            const flavorParts = [];
            if (modifierName) flavorParts.push(modifierName);
            if (ratingAdj !== 0) flavorParts.push(`situational (${ratingAdj > 0 ? '+' : ''}${ratingAdj})`);
            const flavor = flavorParts.length
              ? `${this.actor.name} deals damage (${flavorParts.join('; ')})`
              : `${this.actor.name} deals damage`;

            await this.actor.rollDamage({
              defenseRating: targetRating,
              targetRating,
              boons,
              banes,
              attackRating: effectiveAttackRating,
              ratingAdjName: ratingAdj !== 0 ? `situational (${ratingAdj > 0 ? '+' : ''}${ratingAdj})` : '',
              flavor
            });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('DARKEST.Dialog.Cancel')
        }
      },
      default: 'roll',
      render: (html) => {
        this._setupCounterButtons(html, woundBanes);
        this._setupBoonBaneDescriptor(html, true);

        const modifierSelect = html.find('[name="ratingModifier"]');
        const attackRatingDisplay = html.find('.attack-rating-display');
        const effectiveAttackDisplay = html.find('.effective-attack-display');
        const skillModDisplay = html.find('.skill-mod-display');
        const skillModValue = html.find('.skill-mod-value');

        const updateAttackRating = () => {
          const selectedOption = modifierSelect.find('option:selected');
          const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
          const ratingAdj = parseInt(html.find('[name="ratingAdj"]').val()) || 0;
          const base = characterRating + ratingModifier;
          attackRatingDisplay.text(base);
          const effective = base + ratingAdj;
          effectiveAttackDisplay.text(effective);
          effectiveAttackDisplay.toggleClass('adj-positive', ratingAdj > 0).toggleClass('adj-negative', ratingAdj < 0);
          if (ratingModifier !== 0) {
            skillModValue.text((ratingModifier > 0 ? '+' : '') + ratingModifier);
            skillModValue.css('color', ratingModifier > 0 ? 'var(--darkest-success, #4caf50)' : 'var(--darkest-danger, #e57373)');
            skillModDisplay.show();
          } else {
            skillModDisplay.hide();
          }
        };

        modifierSelect.on('change', updateAttackRating);
        html.find('[name="ratingAdj"]').on('change', updateAttackRating);
        updateAttackRating();

        html.find('.dialog-equip-header').on('click', () => {
          html.find('.dialog-equip-header').toggleClass('collapsed');
          html.find('.dialog-equip-list').toggleClass('collapsed');
        });
      }
    }, { width: 400, height: 'auto' }).render(true);
  }

  /**
   * Handle "Take Damage" roll button (defender rolling, auto-applies wound)
   */
  async _onTakeDamageRoll(event) {
    event.preventDefault();

    const ownRating = this.actor.system.rating || 3;
    const physicalArmor = this.actor.system.armor?.physical || 0;
    const woundBanes = this.actor.system.banes || 0;

    const rawMods = this.actor.system.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: ownRating + (mod.value || 0)
    }));

    const equipment = this.actor.items.filter(i => i.type === 'equipment');

    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/take-damage-dialog.hbs',
      {
        ownRating: ownRating,
        physicalArmor: physicalArmor,
        physicalDefense: ownRating + physicalArmor,
        taskDifficulty: Object.values(DARKEST.taskDifficulty),
        banes: woundBanes,
        woundBanes: woundBanes,
        characterRating: ownRating,
        ratingModifiers: ratingModifiers,
        equipment: equipment
      }
    );

    new Dialog({
      title: game.i18n.localize('DARKEST.Roll.TakeDamage'),
      content: dialogContent,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice"></i>',
          label: game.i18n.localize('DARKEST.Dialog.Roll'),
          callback: async (html) => {
            const enemyAttack = parseInt(html.find('[name="enemyAttack"]').val()) || 0;
            const woundType = html.find('[name="woundType"]').val() || 'physical';
            const boons = parseInt(html.find('[name="boons"]').val()) || 0;
            const banes = parseInt(html.find('[name="banes"]').val()) || 0;
            const defenseAdj = parseInt(html.find('[name="defenseAdj"]').val()) || 0;

            const modifierSelect = html.find('[name="ratingModifier"]');
            const selectedOption = modifierSelect.find('option:selected');
            const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
            const modifierName = modifierSelect.val() || null;

            // Armor only applies to physical wounds; mental wounds use base rating only
            const armor = woundType === 'physical' ? physicalArmor : 0;
            const ownDefense = ownRating + armor + ratingModifier + defenseAdj;

            const flavorParts = [];
            if (modifierName) flavorParts.push(modifierName);
            if (defenseAdj !== 0) flavorParts.push(`situational (${defenseAdj > 0 ? '+' : ''}${defenseAdj})`);
            const flavor = flavorParts.length
              ? `${this.actor.name} takes ${woundType} damage (${flavorParts.join('; ')})`
              : `${this.actor.name} takes ${woundType} damage`;

            await this.actor.rollTakeDamage({
              enemyAttack,
              ownDefense,
              woundType,
              boons,
              banes,
              defenseAdjName: defenseAdj !== 0 ? `situational (${defenseAdj > 0 ? '+' : ''}${defenseAdj})` : '',
              flavor
            });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('DARKEST.Dialog.Cancel')
        }
      },
      default: 'roll',
      render: (html) => {
        this._setupCounterButtons(html, woundBanes);
        this._setupBoonBaneDescriptor(html, true);

        const woundTypeSelect = html.find('[name="woundType"]');
        const modifierSelect = html.find('[name="ratingModifier"]');
        const defenseTotal = html.find('.defense-total');
        const effectiveDefenseDisplay = html.find('.effective-defense-display');
        const armorValue = html.find('.armor-value');
        const skillModDisplay = html.find('.skill-mod-display'); // selects both the + op and the cell
        const skillModValue = html.find('.skill-mod-value');

        const updateDefense = () => {
          const woundType = woundTypeSelect.val();
          // Armor only applies to physical wounds
          const armor = woundType === 'physical' ? physicalArmor : 0;
          const selectedOption = modifierSelect.find('option:selected');
          const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
          const defenseAdj = parseInt(html.find('[name="defenseAdj"]').val()) || 0;
          const base = ownRating + armor + ratingModifier;
          defenseTotal.text(base);
          const effective = base + defenseAdj;
          effectiveDefenseDisplay.text(effective);
          effectiveDefenseDisplay.toggleClass('adj-positive', defenseAdj > 0).toggleClass('adj-negative', defenseAdj < 0);
          armorValue.text(armor);
          // Show/hide skill modifier in breakdown
          if (ratingModifier !== 0) {
            skillModValue.text((ratingModifier > 0 ? '+' : '') + ratingModifier);
            skillModValue.css('color', ratingModifier > 0 ? 'var(--darkest-success, #4caf50)' : 'var(--darkest-danger, #e57373)');
            skillModDisplay.show();
          } else {
            skillModDisplay.hide();
          }
        };

        woundTypeSelect.on('change', updateDefense);
        modifierSelect.on('change', updateDefense);
        html.find('[name="defenseAdj"]').on('change', updateDefense);
        updateDefense();

        html.find('.dialog-equip-header').on('click', () => {
          html.find('.dialog-equip-header').toggleClass('collapsed');
          html.find('.dialog-equip-list').toggleClass('collapsed');
        });
      }
    }, { width: 400, height: 'auto' }).render(true);
  }

  /**
   * Handle creating a new item
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const type = element.dataset.type;

    if (type === 'wound') {
      return this._onCreateWound();
    }

    const itemData = {
      name: game.i18n.localize(`DARKEST.${type.charAt(0).toUpperCase() + type.slice(1)}.New`),
      type: type,
      system: {}
    };

    if (type === 'doom') {
      itemData.system.resolved = false;
    }

    return await Item.create(itemData, { parent: this.actor });
  }

  /**
   * Show a dialog to configure a new wound before creating it
   */
  async _onCreateWound() {
    const ratingOptions = [1,2,3,4,5,6,7,8,9,10].map(n =>
      `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}</option>`
    ).join('');

    const content = `
      <form class="darkest-dialog">
        <div class="form-group">
          <label>Description</label>
          <input type="text" name="name" value="New Wound" placeholder="e.g. Gash across the arm" style="width:100%" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select name="type">
            <option value="physical">Physical</option>
            <option value="mental">Mental</option>
          </select>
        </div>
        <div class="form-group">
          <label>Rating</label>
          <select name="rating">${ratingOptions}</select>
        </div>
      </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: 'New Wound',
        content,
        buttons: {
          create: {
            icon: '<i class="fas fa-heart-broken"></i>',
            label: 'Add Wound',
            callback: async (html) => {
              const name = html.find('[name="name"]').val().trim() || 'New Wound';
              const woundType = html.find('[name="type"]').val();
              const rating = parseInt(html.find('[name="rating"]').val()) || 1;
              await Item.create({
                name,
                type: 'wound',
                system: { rating, type: woundType, healed: false }
              }, { parent: this.actor });
              resolve(true);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false)
          }
        },
        default: 'create'
      }).render(true);
    });
  }

  /**
   * Handle editing an item
   */
  _onItemEdit(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('.item');
    const item = this.actor.items.get(li.dataset.itemId);
    if (!item) return;
    item.sheet.render(true);
  }

  /**
   * Handle deleting an item
   */
  async _onItemDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('.item');
    const item = this.actor.items.get(li.dataset.itemId);

    const confirmed = await Dialog.confirm({
      title: `Delete ${item.name}?`,
      content: `<p>Are you sure you want to delete ${item.name}?</p>`
    });

    if (confirmed) {
      await item.delete();
    }
  }

  /**
   * Toggle wound healed status
   */
  async _onWoundHeal(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('.item');
    const item = this.actor.items.get(li.dataset.itemId);

    await item.update({ 'system.healed': !item.system.healed });
  }

  /**
   * Toggle doom resolved status
   */
  async _onDoomResolve(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('.item');
    const item = this.actor.items.get(li.dataset.itemId);

    await item.update({ 'system.resolved': !item.system.resolved });
  }

  /**
   * Toggle collapsible section
   */
  _onToggleCollapse(event) {
    // Don't collapse if a button inside the header was clicked
    if (event.target.closest('button')) return;
    event.preventDefault();
    const header = event.currentTarget;
    const content = header.nextElementSibling;

    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
  }

  /**
   * Set up +/- counter buttons for dialog forms
   * @param {jQuery} html - The dialog HTML
   * @param {number} woundBanes - Minimum banes from wounds (cannot be reduced below this)
   */
  _setupCounterButtons(html, woundBanes = 0) {
    html.find('.counter-btn').on('click', (event) => {
      event.preventDefault();
      const btn = event.currentTarget;
      const field = btn.dataset.field;
      const input = html.find(`[name="${field}"]`);
      const maxAttr = parseInt(btn.dataset.max);
      const max = !isNaN(maxAttr) ? maxAttr : (parseInt(input.attr('max')) || 5);
      const inputMin = parseInt(input.attr('min'));
      const min = field === 'banes'
        ? (parseInt(input.data('wound-banes')) || woundBanes || 0)
        : (isNaN(inputMin) ? 0 : inputMin);
      let value = parseInt(input.val()) || 0;

      if (btn.classList.contains('increment')) {
        value = Math.min(value + 1, max);
      } else if (btn.classList.contains('decrement')) {
        value = Math.max(value - 1, min);
      }

      input.val(value).trigger('change');
    });
  }

  /**
   * Wire boon/bane descriptor to update live in a dialog
   */
  _setupBoonBaneDescriptor(html, isDamageRoll = false) {
    const boonsInput = html.find('[name="boons"]');
    const banesInput = html.find('[name="banes"]');
    const descriptor = html.find('.boon-bane-descriptor');
    const descriptorText = html.find('.boon-bane-text');
    // Damage rolls keep 1 die (kh1); action rolls keep 2.
    const keepCount = isDamageRoll ? 1 : 2;

    // Rules: max 3 dice total (action) or 2 dice (damage). Net boons/banes don't stack further.
    const totalDice = keepCount + 1; // 3 for action (keep 2), 2 for damage (keep 1)

    const update = () => {
      const boons = parseInt(boonsInput.val()) || 0;
      const banes = parseInt(banesInput.val()) || 0;
      const net = boons - banes;
      if (net > 0) {
        descriptor.show();
        descriptorText.removeClass('bane-text').addClass('boon-text')
          .text(`Boon: roll ${totalDice}d6, keep the best ${keepCount} — fortune favours you.`);
      } else if (net < 0) {
        descriptor.show();
        descriptorText.removeClass('boon-text').addClass('bane-text')
          .text(`Bane: roll ${totalDice}d6, keep the worst ${keepCount} — the odds are against you.`);
      } else {
        descriptor.hide();
      }
    };

    boonsInput.on('change', update);
    banesInput.on('change', update);
    update();
  }

  /**
   * Handle spending a doom
   */
  async _onDoomSpend(event) {
    event.preventDefault();
    await this.actor.spendDoom();
  }

  /**
   * Handle healing a wound — opens a dialog to choose lowest, highest, or a specific wound
   */
  async _onHealWound(event) {
    event.preventDefault();

    const activeWounds = this.actor.items.filter(i => i.type === 'wound' && !i.system.healed);

    if (activeWounds.length === 0) {
      ui.notifications.info('No active wounds to heal.');
      return;
    }

    const sorted = [...activeWounds].sort((a, b) => a.system.rating - b.system.rating);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];

    const woundRows = sorted.map(w =>
      `<button type="button" class="heal-opt" data-id="${w.id}">
        <span class="heal-opt-rating">Rating ${w.system.rating}</span>
        <span class="heal-opt-name">${w.name}</span>
        <span class="heal-opt-type">${w.system.type}</span>
      </button>`
    ).join('');

    const single = sorted.length === 1;

    const content = `<div class="darkest-dialog heal-choice-dialog">
      <div class="heal-options">
        ${single ? woundRows : `
        <button type="button" class="heal-opt heal-opt-preset" data-id="${lowest.id}">
          <i class="fas fa-arrow-down"></i>
          <span>Heal Lowest</span>
          <span class="heal-opt-preview">Rating ${lowest.system.rating} — ${lowest.name}</span>
        </button>
        <button type="button" class="heal-opt heal-opt-preset" data-id="${highest.id}">
          <i class="fas fa-arrow-up"></i>
          <span>Heal Highest</span>
          <span class="heal-opt-preview">Rating ${highest.system.rating} — ${highest.name}</span>
        </button>
        <hr class="heal-divider"><p class="heal-choose-label">Choose a specific wound:</p>${woundRows}`}
      </div>
    </div>`;

    const actor = this.actor;

    new Dialog({
      title: 'Heal Wound',
      content,
      buttons: {},
      render: (html) => {
        html.find('.heal-opt').click(async (ev) => {
          const id = ev.currentTarget.dataset.id;
          const wound = actor.items.get(id);
          if (!wound) return;
          await wound.delete();
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="darkest-roll action-roll success">
              <div class="roll-header">
                <h3 class="roll-title"><i class="fas fa-medkit"></i> Wound Healed</h3>
              </div>
              <div class="roll-details">
                <div class="roll-formula">
                  <span class="label">Wound:</span>
                  <span class="value">${wound.name}</span>
                  <span class="separator">·</span>
                  <span class="label">Rating:</span>
                  <span class="value">${wound.system.rating}</span>
                  <span class="separator">·</span>
                  <span class="label">Type:</span>
                  <span class="value">${wound.system.type}</span>
                </div>
              </div>
              <div class="roll-result">
                <div class="outcome success"><i class="fas fa-heart"></i> Wound removed!</div>
              </div>
            </div>`
          });
          // Close dialog after selection
          Object.values(ui.windows).find(w => w._element?.[0]?.querySelector('.heal-choice-dialog'))?.close();
        });
      }
    }, { width: 360 }).render(true);
  }

  /**
   * GM: unlock a rest-locked wound so it can be recovered immediately
   */
  async _onWoundUnlock(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('[data-item-id]');
    const itemId = li?.dataset.itemId;
    const wound = this.actor.items.get(itemId);
    if (!wound) return;
    await wound.update({ 'system.restFailedAt': null });
  }

  /**
   * Handle rest to recover from wounds
   */
  async _onRestWounds(event) {
    event.preventDefault();
    await this.actor.rollRest();
  }

  /**
   * Handle resist unconsciousness/catatonia roll from sheet button
   */
  async _onResistUnconscious(event) {
    event.preventDefault();
    // Use highest wound type to determine check type
    const highestWoundType = this.actor.system.highestWoundType || 'physical';
    const highestWoundRating = highestWoundType === 'mental'
      ? this.actor.system.highestMentalWound || 0
      : this.actor.system.highestPhysicalWound || 0;
    await this.actor.rollResistUnconscious(highestWoundRating, highestWoundType);
  }

  /**
   * Handle death check roll
   */
  async _onDeathCheck(event) {
    event.preventDefault();
    await this.actor.rollDeathCheck();
  }

  /**
   * Handle adding a new custom modification
   */
  async _onAddModification(event) {
    event.preventDefault();

    // Foundry may store arrays as objects — always convert to array
    const raw = this.actor.system.customModifications || {};
    const customMods = Array.isArray(raw) ? raw : Object.values(raw);
    const newMod = { name: 'New Skill/Talent', value: 0 };

    await this.actor.update({
      'system.customModifications': [...customMods, newMod]
    });
  }

  /**
   * Handle removing a custom modification
   */
  async _onRemoveModification(event) {
    event.preventDefault();
    const index = parseInt(event.currentTarget.dataset.index);
    const raw = this.actor.system.customModifications || {};
    const customMods = Array.isArray(raw) ? [...raw] : [...Object.values(raw)];

    if (index >= 0 && index < customMods.length) {
      customMods.splice(index, 1);
      await this.actor.update({
        'system.customModifications': customMods
      });
    }
  }
}
