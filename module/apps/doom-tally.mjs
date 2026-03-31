/**
 * Doom Tally Application
 * Shows the total doom count across all player characters
 * Visible to all players, GM can manually adjust
 */

export class DoomTally extends Application {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'doom-tally',
      title: 'Doom Tally',
      template: 'systems/darkest-system/templates/apps/doom-tally.hbs',
      classes: ['darkest-system', 'doom-tally'],
      width: 200,
      height: 'auto',
      resizable: false,
      minimizable: true,
      popOut: true
    });
  }

  /**
   * Calculate total dooms from all player characters
   */
  static calculateTotalDooms() {
    let total = 0;
    const characters = [];

    // Get all player-owned characters
    for (const actor of game.actors) {
      if (actor.type === 'character' && actor.hasPlayerOwner) {
        const dooms = actor.items.filter(i => i.type === 'doom' && !i.system.resolved);
        const doomCount = dooms.length;
        total += doomCount;
        characters.push({
          name: actor.name,
          dooms: doomCount,
          id: actor.id
        });
      }
    }

    return { total, characters };
  }

  /**
   * Get the stored manual adjustment (GM override)
   */
  static getManualAdjustment() {
    return game.settings.get('darkest-system', 'doomTallyAdjustment') || 0;
  }

  /**
   * Set the manual adjustment
   */
  static async setManualAdjustment(value) {
    await game.settings.set('darkest-system', 'doomTallyAdjustment', value);
  }

  /**
   * Get total doom count including adjustment
   */
  static getTotalWithAdjustment() {
    const { total } = DoomTally.calculateTotalDooms();
    const adjustment = DoomTally.getManualAdjustment();
    return Math.max(0, total + adjustment);
  }

  /** @override */
  async getData() {
    const { total, characters } = DoomTally.calculateTotalDooms();
    const adjustment = DoomTally.getManualAdjustment();
    const adjustedTotal = Math.max(0, total + adjustment);

    return {
      total: adjustedTotal,
      rawTotal: total,
      adjustment: adjustment,
      characters: characters,
      isGM: game.user.isGM,
      hasAdjustment: adjustment !== 0
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // GM-only controls
    if (game.user.isGM) {
      html.find('.doom-increment').click(this._onIncrement.bind(this));
      html.find('.doom-decrement').click(this._onDecrement.bind(this));
      html.find('.doom-reset').click(this._onReset.bind(this));
    }

    // Clicking a character name opens their sheet
    html.find('.character-entry').click(this._onCharacterClick.bind(this));
  }

  /**
   * Increment the manual adjustment
   */
  async _onIncrement(event) {
    event.preventDefault();
    const current = DoomTally.getManualAdjustment();
    await DoomTally.setManualAdjustment(current + 1);
    this.render();
    DoomTally.broadcastUpdate();
  }

  /**
   * Decrement the manual adjustment
   */
  async _onDecrement(event) {
    event.preventDefault();
    const current = DoomTally.getManualAdjustment();
    await DoomTally.setManualAdjustment(current - 1);
    this.render();
    DoomTally.broadcastUpdate();
  }

  /**
   * Reset the manual adjustment to 0
   */
  async _onReset(event) {
    event.preventDefault();
    await DoomTally.setManualAdjustment(0);
    this.render();
    DoomTally.broadcastUpdate();
  }

  /**
   * Open a character's sheet when clicked
   */
  _onCharacterClick(event) {
    event.preventDefault();
    const actorId = event.currentTarget.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (actor) {
      actor.sheet.render(true);
    }
  }

  /**
   * Broadcast doom tally update to all clients
   */
  static broadcastUpdate() {
    game.socket.emit('system.darkest-system', {
      type: 'doomTallyUpdate'
    });
  }

  /**
   * Refresh the doom tally display
   */
  static refresh() {
    if (game.darkestSystem?.doomTally) {
      game.darkestSystem.doomTally.render();
    }
    ui.players?.render();
  }
}

/**
 * Register doom tally settings
 */
export function registerDoomTallySettings() {
  game.settings.register('darkest-system', 'doomTallyAdjustment', {
    name: 'Doom Tally Manual Adjustment',
    hint: 'GM adjustment to the automatic doom count',
    scope: 'world',
    config: false,
    type: Number,
    default: 0
  });
}

/**
 * Register doom tally hooks
 */
export function registerDoomTallyHooks() {
  // Update doom tally when items change
  Hooks.on('createItem', (item, options, userId) => {
    if (item.type === 'doom') {
      DoomTally.refresh();
    }
  });

  Hooks.on('deleteItem', (item, options, userId) => {
    if (item.type === 'doom') {
      DoomTally.refresh();
    }
  });

  Hooks.on('updateItem', (item, changes, options, userId) => {
    if (item.type === 'doom') {
      DoomTally.refresh();
    }
  });

  // Listen for doom tally updates from other clients
  game.socket.on('system.darkest-system', (data) => {
    if (data.type === 'doomTallyUpdate') {
      DoomTally.refresh();
    }
  });
}
