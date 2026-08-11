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
      tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'main' }],
      // Any update() call (use-pips, rating dots, item edits, etc.) triggers a
      // full re-render, and Foundry doesn't preserve scroll position unless
      // told to -- without this, every click on a long Main-tab page jumps
      // back to the top.
      scrollY: ['.sheet-body']
    });
  }

  /** @override */
  get template() {
    return `systems/darkest-system/templates/actor/actor-${this.actor.type}-sheet.hbs`;
  }

  /**
   * Roll dialogs (Action Roll, Deal Damage, Take Damage, etc.) are plain
   * `new Dialog()` calls -- nothing stops the same button, or a different
   * roll button, from piling up multiple copies on screen. `ui.windows` is
   * keyed by an internal auto-incrementing `appId`, NOT by the `id` option
   * passed to the constructor, so matching on `options.id` there never
   * actually finds the previous dialog. Track each dialog category's
   * instance directly on the sheet instead, and close it (awaiting the
   * close animation) before opening a new one -- the pattern Foundry core
   * itself uses for cached single-instance apps like Actor#sheet.
   */
  async _closeTrackedDialog(key) {
    const existing = this[key];
    if (existing?.rendered) {
      await existing.close();
    }
    this[key] = null;
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
    const [
      enrichedBiography,
      enrichedNotes,
      enrichedDescription,
      enrichedTactics,
      enrichedAbilities,
      enrichedAbilityDescriptions
    ] = await Promise.all([
      TextEditor.enrichHTML(context.system.biography || '', opts),
      TextEditor.enrichHTML(context.system.notes || '', opts),
      TextEditor.enrichHTML(context.system.description || '', opts),
      TextEditor.enrichHTML(context.system.tactics || '', opts),
      TextEditor.enrichHTML(context.system.abilities || '', opts),
      Promise.all((context.abilities || []).map(a => TextEditor.enrichHTML(a.system.description || '', opts)))
    ]);

    context.enrichedBiography = enrichedBiography;
    context.enrichedNotes = enrichedNotes;
    context.enrichedDescription = enrichedDescription;
    context.enrichedTactics = enrichedTactics;
    context.enrichedAbilities = enrichedAbilities;

    // Attach each ability's enriched description onto the ability itself so
    // the Main-tab compact summary can show rendered HTML, not raw markup.
    (context.abilities || []).forEach((a, i) => {
      a.enrichedDescription = enrichedAbilityDescriptions[i];
    });

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

    // Death/catatonia check only required when unconscious/catatonic AND the
    // highest wound's Rating exceeds the character's own Rating (per the rules
    // text: "a wound rated higher than the character must... roll against the
    // wound with the highest Rating").
    const isUnconscious = context.system.unconscious || context.system.catatonic || false;
    context.canDeathCheck = isUnconscious && context.highestWoundRating > (context.system.rating || 3);

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

    // Build a clickable pip track for limited-use abilities, same visual
    // language as the Rating dots. Unlimited abilities (usesPerDay === 0)
    // get no pips -- there's nothing to track.
    for (const a of abilities) {
      if (a.system.usesPerDay > 0) {
        const remaining = a.system.usesRemaining ?? a.system.usesPerDay;
        a.usePips = [];
        for (let i = 1; i <= a.system.usesPerDay; i++) {
          a.usePips.push({ value: i, filled: i <= remaining });
        }
      }
    }

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
    html.find('.effect-add-btn').click(this._onAddEffect.bind(this));
    html.find('.effect-delete-btn').click(async (ev) => {
      const id = ev.currentTarget.dataset.itemId;
      if (id) await this.actor.deleteEmbeddedDocuments('Item', [id]);
    });

    html.find('.rating-dot').click(this._onRatingClick.bind(this));

    // Ability use-pip click handler (Main-tab summary and Abilities tab both)
    html.find('.ability-use-pip').click(this._onAbilityUseClick.bind(this));

    // Click the Unconscious/Catatonic banner to clear it manually (e.g. the
    // character wakes on their own, gets magical aid, or the GM just calls
    // it -- healing the relevant wound type also clears this automatically).
    html.find('.clear-status').click(async (ev) => {
      const status = ev.currentTarget.dataset.status;
      if (status === 'unconscious' || status === 'catatonic') {
        await this.actor.update({ [`system.${status}`]: false });
      }
    });

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

    // Modified Ratings badges: open the Action Roll dialog with that skill
    // pre-selected. No shift-click quick-roll here (unlike the main Action
    // Roll button) -- a badge click always means "roll with this skill."
    html.find('.roll-with-modifier').click((ev) => {
      ev.preventDefault();
      const modifierName = ev.currentTarget.dataset.modifierName || null;
      this._showActionRollDialog(modifierName);
    });

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

    // Tab-link shortcuts (compact summaries → jump to edit tab)
    html.find('.tab-link').click((event) => {
      event.preventDefault();
      event.stopPropagation();
      const tab = event.currentTarget.dataset.tab;
      if (tab) this._tabs[0].activate(tab);
    });

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
   * Handle clicking a use-pip on an ability to set its uses remaining.
   * Clicking the pip that's already the current remaining value clears it
   * to zero, same toggle-off convenience as clicking a filled Rating dot
   * a second time would be expected to do.
   */
  async _onAbilityUseClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    const itemId = element.closest('[data-item-id]')?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const clickedValue = parseInt(element.dataset.value);
    const current = item.system.usesRemaining ?? item.system.usesPerDay;
    const newValue = clickedValue === current ? clickedValue - 1 : clickedValue;

    await item.update({ 'system.usesRemaining': Math.max(0, newValue) });
  }

  /**
   * Handle action roll button
   */
  async _onActionRoll(event) {
    event.preventDefault();

    // Shift-click: quick roll at difficulty 4 with no manually-added modifiers.
    // Wound Banes are NOT a manual modifier -- being wounded always costs a
    // Bane per the rules, and the full dialog pre-populates it from
    // system.banes. The quick roll has to apply it too, or shift-clicking
    // silently rolls a clean 2d6 for a wounded character.
    if (event.shiftKey) {
      return this.actor.rollAction({
        taskRating: 4,
        boons: 0,
        banes: this.actor.system.banes || 0,
        callUponWoods: false,
        ratingModifier: 0,
        modifierName: null
      });
    }

    // The plain Action Roll button always starts at Base Rating -- no memory
    // of the last-used skill. (Modified Ratings badges have their own click
    // handler that pre-selects a specific skill instead; see .roll-with-modifier.)
    return this._showActionRollDialog(null);
  }

  /**
   * Add a timed boon or bane.
   *
   * The three durations map to how the book actually phrases them: "a Boon
   * on the next two rolls", "a Bane for a day", and open-ended ones like
   * "until the character cleans all the oil off".
   */
  async _onAddEffect(event) {
    event.preventDefault();

    const content = `<div class="darkest-dialog effect-dialog">
      <div class="form-group">
        <label>What is it?</label>
        <input type="text" name="effectName" placeholder="e.g. Blessing of the Lookin' Pool" />
      </div>
      <div class="form-group">
        <label>Helping or hindering?</label>
        <select name="effectKind">
          <option value="boon">Boon — makes tasks easier</option>
          <option value="bane">Bane — makes tasks harder</option>
        </select>
      </div>
      <div class="form-group">
        <label>How long?</label>
        <select name="effectDuration">
          <option value="rolls">For the next few rolls</option>
          <option value="until-time">For a set time</option>
          <option value="until-removed" selected>Until something changes it</option>
        </select>
      </div>
      <div class="form-group effect-rolls-field" style="display:none">
        <label>How many rolls?</label>
        <input type="number" name="effectRolls" value="2" min="1" max="20" />
      </div>
      <div class="form-group effect-hours-field" style="display:none">
        <label>How many hours?</label>
        <input type="number" name="effectHours" value="24" min="1" max="240" />
        <small class="hint">Measured on the travel clock, so it clears itself as time passes.</small>
      </div>
    </div>`;

    new Dialog({
      title: 'Add a Boon or Bane',
      content,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: 'Add',
          callback: async (html) => {
            const name = html.find('[name="effectName"]').val()?.trim();
            const kind = html.find('[name="effectKind"]').val();
            const duration = html.find('[name="effectDuration"]').val();
            if (!name) {
              ui.notifications.warn('Give it a name so you know what it is later.');
              return;
            }

            const system = { kind, duration, source: '' };
            if (duration === 'rolls') {
              system.rollsRemaining = Math.max(1, parseInt(html.find('[name="effectRolls"]').val()) || 1);
            } else if (duration === 'until-time') {
              const hours = Math.max(1, parseInt(html.find('[name="effectHours"]').val()) || 24);
              const clock = (() => {
                try { return game.settings.get('darkest-system', 'travelClock'); }
                catch { return null; }
              })();
              if (!clock) {
                ui.notifications.warn('No travel clock available — adding it as open-ended instead.');
                system.duration = 'until-removed';
              } else {
                const total = clock.minutes + hours * 60;
                system.expiresDay = clock.day + Math.floor(total / 1440);
                system.expiresMinutes = total % 1440;
              }
            }

            await this.actor.createEmbeddedDocuments('Item', [{
              name, type: 'effect', system,
            }]);
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' }
      },
      default: 'add',
      render: (html) => {
        // Only show the field the chosen duration actually needs.
        const sync = () => {
          const d = html.find('[name="effectDuration"]').val();
          html.find('.effect-rolls-field').toggle(d === 'rolls');
          html.find('.effect-hours-field').toggle(d === 'until-time');
        };
        html.find('[name="effectDuration"]').on('change', sync);
        sync();
        html.find('[name="effectName"]').focus();
      }
    }, { width: 420 }).render(true);
  }

  /**
   * Show the Action Roll dialog, optionally pre-selecting a named skill/talent
   * (from a Modified Ratings badge) instead of defaulting to Base Rating.
   */
  async _showActionRollDialog(preselectModifierName = null) {
    const characterRating = this.actor.system.rating || 3;
    const woundBanes = this.actor.system.banes || 0;
    // Timed boons/banes pre-fill the counters the same way the wound bane
    // does, and are listed by name so the GM can see WHY the numbers are
    // what they are -- and still override them before rolling.
    const effectBoons = this.actor.system.effectBoons || 0;
    const effectBanes = this.actor.system.effectBanes || 0;
    const activeEffects = this.actor.system.activeEffects || [];

    // Prepare rating modifiers with effective values
    const rawMods = this.actor.system.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: characterRating + (mod.value || 0)
    }));

    const equipment = this.actor.items.filter(i => i.type === 'equipment');

    // Show dialog to configure the roll
    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/roll-dialog.hbs',
      {
        taskDifficulty: Object.values(DARKEST.taskDifficulty),
        defaultTaskRating: 4,
        defaultTargetNeed: Math.max(2, 7 + 4 - characterRating),
        boons: effectBoons,
        banes: woundBanes + effectBanes,
        woundBanes: woundBanes + effectBanes,
        activeEffects,
        hasActiveEffects: activeEffects.length > 0,
        characterRating: characterRating,
        ratingModifiers: ratingModifiers,
        equipment: equipment,
        lastModifierName: preselectModifierName || '',
        isHouseMode: game.settings.get('darkest-system', 'gameMode') === 'darkest-house'
      }
    );

    await this._closeTrackedDialog('_actionRollDialog');
    this._actionRollDialog = new Dialog({
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

        // Pre-select the requested modifier (from a badge click), if any
        if (preselectModifierName) {
          html.find('[name="ratingModifier"] option').filter(function() {
            return $(this).val() === preselectModifierName;
          }).prop('selected', true);
        }

        const taskSelect = html.find('[name="taskRating"]');
        const modifierSelect = html.find('[name="ratingModifier"]');
        const boonsInput = html.find('[name="boons"]');
        const banesInput = html.find('[name="banes"]');
        const callUponWoodsInput = html.find('[name="callUponWoods"]');
        const isHouseMode = game.settings.get('darkest-system', 'gameMode') === 'darkest-house';
        const callUponLabel = isHouseMode ? 'Call Upon the House' : 'Call Upon the Woods';
        const taskRatingDisplay = html.find('.task-rating-display');
        const effectiveRatingDisplay = html.find('.effective-rating-display');
        const targetNeedDisplay = html.find('.target-need');
        const indicator = html.find('.special-success-indicator');
        const indicatorText = indicator.find('.indicator-text');
        const descriptor = html.find('.boon-bane-descriptor');
        const descriptorText = html.find('.boon-bane-text');
        const autoResultEl = html.find('.auto-result-indicator');
        const autoResultText = autoResultEl.find('.auto-result-text');
        const autoResultIcon = autoResultEl.find('.auto-result-icon');
        const rollBtn = html.closest('.dialog-buttons').find('button[data-button="roll"]');

        const updateDisplay = () => {
          const taskRating = parseInt(taskSelect.val()) || 4;
          const boons = parseInt(boonsInput.val()) || 0;
          const banes = parseInt(banesInput.val()) || 0;
          const netBoon = boons - banes;
          const callUponWoods = callUponWoodsInput.is(':checked');

          const selectedOption = modifierSelect.find('option:selected');
          const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
          const effectiveRating = characterRating + ratingModifier;

          const targetNumber = 7 + taskRating;
          const ratingDiff = taskRating - effectiveRating;
          const diceNeeded = targetNumber - effectiveRating;

          taskRatingDisplay.text(taskRating);
          effectiveRatingDisplay
            .text(effectiveRating)
            .removeClass('boon bane neutral')
            .addClass(netBoon > 0 ? 'boon' : netBoon < 0 ? 'bane' : 'neutral');
          targetNeedDisplay.text(Math.max(2, diceNeeded));

          // Auto-success / auto-fail detection
          // Calling Upon the Woods adds the Darkest Die (1-6) to the roll, which can
          // overcome an otherwise impossible task — so suppress the impossible warning.
          const isAutoSuccess = ratingDiff <= -6;
          const isImpossible = ratingDiff >= 6 && !callUponWoods;

          if (isAutoSuccess) {
            autoResultEl.show().removeClass('auto-fail').addClass('auto-success');
            autoResultIcon.attr('class', 'fas fa-check-circle auto-result-icon');
            autoResultText.text('Automatic success — no roll needed (task Rating is 6+ lower than yours).');
            rollBtn.prop('disabled', false);
            indicator.hide();
          } else if (isImpossible) {
            autoResultEl.show().removeClass('auto-success').addClass('auto-fail');
            autoResultIcon.attr('class', 'fas fa-times-circle auto-result-icon');
            autoResultText.text(`Impossible — automatic failure (task Rating is 6+ higher than yours). Check "${callUponLabel}" to attempt anyway.`);
            rollBtn.prop('disabled', true);
            indicator.hide();
          } else {
            autoResultEl.hide();
            rollBtn.prop('disabled', false);

            // Special Success indicator
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
          }

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
        };

        taskSelect.on('change', updateDisplay);
        modifierSelect.on('change', updateDisplay);
        boonsInput.on('change', updateDisplay);
        banesInput.on('change', updateDisplay);
        callUponWoodsInput.on('change', updateDisplay);
        updateDisplay();

        html.find('.dialog-equip-header').on('click', () => {
          html.find('.dialog-equip-header').toggleClass('collapsed');
          html.find('.dialog-equip-list').toggleClass('collapsed');
        });
      },
      close: () => { this._actionRollDialog = null; }
    }, { width: 400, height: 'auto' });
    this._actionRollDialog.render(true);
  }

  /**
   * Handle "Deal Damage" roll button (attacker rolling)
   */
  async _onDealDamageRoll(event) {
    event.preventDefault();

    const characterRating = this.actor.system.rating || 3;
    const woundBanes = this.actor.system.banes || 0;
    // Timed boons/banes apply here too. The rules say plainly that "Damage
    // CAN have Boon/Bane" and that a wounded character ALWAYS has a Bane,
    // with no exemption for damage rolls -- so a boon lasting "the rest of
    // the day" helps the swing as much as it helps the action.
    const effectBoons = this.actor.system.effectBoons || 0;
    const effectBanes = this.actor.system.effectBanes || 0;
    const activeEffects = this.actor.system.activeEffects || [];

    const rawMods = this.actor.system.customModifications;
    const modsArray = Array.isArray(rawMods) ? rawMods : Object.values(rawMods || {});
    const ratingModifiers = modsArray.map(mod => ({
      name: mod.name || '',
      value: mod.value || 0,
      effectiveValue: characterRating + (mod.value || 0)
    }));

    const equipment = this.actor.items.filter(i => i.type === 'equipment');
    const lastWeaponId = this.actor.getFlag('darkest-system', 'lastDamageWeaponId') || null;
    // Any non-zero modifier makes this a weapon worth listing -- a cursed
    // or unwieldy item at -1 has to be selectable too, not filtered out.
    const damageEquipment = equipment
      .filter(i => (i.system.damageRatingBonus || 0) !== 0)
      .map(i => ({ id: i.id, name: i.name, system: i.system, selected: i.id === lastWeaponId }));
    const otherEquipment = equipment.filter(i => !(i.system.damageRatingBonus || 0));

    const dialogContent = await renderTemplate(
      'systems/darkest-system/templates/dialog/deal-damage-dialog.hbs',
      {
        characterRating: characterRating,
        ratingModifiers: ratingModifiers,
        taskDifficulty: Object.values(DARKEST.taskDifficulty),
        boons: effectBoons,
        banes: woundBanes + effectBanes,
        woundBanes: woundBanes + effectBanes,
        activeEffects,
        hasActiveEffects: activeEffects.length > 0,
        damageEquipment: damageEquipment,
        otherEquipment: otherEquipment
      }
    );

    await this._closeTrackedDialog('_dealDamageDialog');
    this._dealDamageDialog = new Dialog({
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

            const checkedWeapon = html.find('[name="damageEquip"]:checked').first();
            const weaponBonus = checkedWeapon.length ? (parseInt(checkedWeapon.val()) || 0) : 0;
            const weaponName = checkedWeapon.length ? checkedWeapon.data('name') : null;
            const weaponId = checkedWeapon.length ? checkedWeapon.data('item-id') : null;

            // Remember the chosen weapon so it's pre-selected next time this
            // dialog opens. Cleared (unset) if no weapon is checked this time.
            await this.actor.setFlag('darkest-system', 'lastDamageWeaponId', weaponId || null);

            const effectiveAttackRating = characterRating + ratingModifier + ratingAdj + weaponBonus;

            const flavorParts = [];
            if (modifierName) flavorParts.push(modifierName);
            if (ratingAdj !== 0) flavorParts.push(`situational (${ratingAdj > 0 ? '+' : ''}${ratingAdj})`);
            if (weaponName) flavorParts.push(weaponName);
            const flavor = flavorParts.length
              ? `${this.actor.name} deals damage (${flavorParts.join('; ')})`
              : `${this.actor.name} deals damage`;

            await this.actor.rollDamage({
              // A target's Rating IS its defence -- NPCs have no armour
              // field, and the rules put armour on the DEFENDER's own roll
              // ("when defending: damage die + foe's attack - own defense").
              // So the same number serves as defence and as the instant-kill
              // threshold here.
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

        const weaponCheckboxes = html.find('[name="damageEquip"]');

        const updateAttackRating = () => {
          const selectedOption = modifierSelect.find('option:selected');
          const ratingModifier = parseInt(selectedOption.data('modifier')) || 0;
          const ratingAdj = parseInt(html.find('[name="ratingAdj"]').val()) || 0;
          const checkedWeapon = weaponCheckboxes.filter(':checked').first();
          const weaponBonus = checkedWeapon.length ? (parseInt(checkedWeapon.val()) || 0) : 0;
          const base = characterRating + ratingModifier;
          attackRatingDisplay.text(base);
          const effective = base + ratingAdj + weaponBonus;
          effectiveAttackDisplay.text(effective);
          effectiveAttackDisplay.toggleClass('adj-positive', (ratingAdj + weaponBonus) > 0).toggleClass('adj-negative', (ratingAdj + weaponBonus) < 0);
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

        // Weapon bonus is a single choice per attack, not stackable -- checking
        // one clears any other, same as a radio group but keeping the existing
        // checkbox markup/styling.
        weaponCheckboxes.on('change', (ev) => {
          if (ev.currentTarget.checked) {
            weaponCheckboxes.not(ev.currentTarget).prop('checked', false);
          }
          updateAttackRating();
        });

        updateAttackRating();

        html.find('.dialog-equip-header').on('click', () => {
          html.find('.dialog-equip-header').toggleClass('collapsed');
          html.find('.dialog-equip-list').toggleClass('collapsed');
        });
      },
      close: () => { this._dealDamageDialog = null; }
    }, { width: 400, height: 'auto' });
    this._dealDamageDialog.render(true);
  }

  /**
   * Handle "Take Damage" roll button (defender rolling, auto-applies wound)
   */
  async _onTakeDamageRoll(event) {
    event.preventDefault();

    const ownRating = this.actor.system.rating || 3;
    // effectiveArmor, NOT the raw armor field: prepareData() folds equipment
    // armour (light +1 / heavy +2) into it, and reading the raw value meant a
    // character in heavy armour with no manually-entered number defended at
    // their base rating -- inflating every wound they took by up to 2.
    const physicalArmor = this.actor.system.effectiveArmor?.physical
      ?? this.actor.system.armor?.physical ?? 0;
    const woundBanes = this.actor.system.banes || 0;
    // Same reasoning as the deal-damage roll: a lasting bane hinders
    // soaking a blow just as much as it hinders throwing one.
    const effectBoons = this.actor.system.effectBoons || 0;
    const effectBanes = this.actor.system.effectBanes || 0;
    const activeEffects = this.actor.system.activeEffects || [];

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
        boons: effectBoons,
        banes: woundBanes + effectBanes,
        woundBanes: woundBanes + effectBanes,
        activeEffects,
        hasActiveEffects: activeEffects.length > 0,
        characterRating: ownRating,
        ratingModifiers: ratingModifiers,
        equipment: equipment
      }
    );

    await this._closeTrackedDialog('_takeDamageDialog');
    this._takeDamageDialog = new Dialog({
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
      },
      close: () => { this._takeDamageDialog = null; }
    }, { width: 400, height: 'auto' });
    this._takeDamageDialog.render(true);
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

    await this._closeTrackedDialog('_newWoundDialog');
    return new Promise((resolve) => {
      this._newWoundDialog = new Dialog({
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
        default: 'create',
        close: () => { this._newWoundDialog = null; }
      });
      this._newWoundDialog.render(true);
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
      // Both counters honour a locked floor from the template. Boons need one
      // too, not just banes: a timed boon and a timed bane are the same kind
      // of thing, and letting the boon be decremented away while the bane
      // stayed locked meant the UI treated one as advisory and the other as
      // mandatory -- and a misclick on the boon could not be undone without
      // over-inflating it past what the effects actually granted.
      const lockedMin = field === 'banes'
        ? parseInt(input.data('wound-banes'))
        : parseInt(input.data('effect-boons'));
      const min = !isNaN(lockedMin)
        ? lockedMin
        : (field === 'banes' ? (woundBanes || 0) : (isNaN(inputMin) ? 0 : inputMin));
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

    await this._closeTrackedDialog('_healWoundDialog');
    this._healWoundDialog = new Dialog({
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
          this._healWoundDialog?.close();
        });
      },
      close: () => { this._healWoundDialog = null; }
    }, { width: 360 });
    this._healWoundDialog.render(true);
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

    // Only a type with MORE THAN ONE wound qualifies -- the check fires when
    // an already-wounded character takes another of the same kind, which is
    // the same condition that enables this button.
    //
    // Picking the globally highest wound was wrong: a character with two
    // mental wounds and one big physical wound enabled the button (on the
    // mental count) and then rolled a PHYSICAL check against a type that
    // had only one wound and shouldn't have been checked at all.
    const wounds = this.actor.items.filter(i => i.type === 'wound' && !i.system.healed);
    const byType = { physical: [], mental: [] };
    for (const w of wounds) {
      (byType[w.system.type] ?? byType.physical).push(w.system.rating || 0);
    }

    const eligible = ['physical', 'mental'].filter(t => byType[t].length > 1);
    if (!eligible.length) {
      ui.notifications.warn('No wound type has more than one wound -- no check needed.');
      return;
    }

    // More than one type can qualify; take the worse of them, which is the
    // one that actually threatens the character.
    const worst = eligible.reduce((a, b) =>
      Math.max(...byType[b]) > Math.max(...byType[a]) ? b : a);

    await this.actor.rollResistUnconscious(Math.max(...byType[worst]), worst);
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
