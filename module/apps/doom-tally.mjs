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
      popOut: true,
      // Every adjustment click calls this.render(), which otherwise resets
      // scroll to the top with several players listed. Same fix as
      // DarkestActorSheet's scrollY.
      scrollY: ['.window-content']
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
    // Find the open window rather than trusting a stored handle: nothing ever
    // assigned one (the scene-control button just does `new DoomTally()`), so
    // this used to be a no-op and an open tally never updated -- Dooms gained
    // or spent only appeared after closing and reopening it. Same lookup
    // NpcTracker uses.
    const tally = Object.values(ui.windows).find(w => w instanceof DoomTally);
    if (tally) tally.render(false);
    renderDoomBadge();
    ui.players?.render();
  }
}

/* ----------------------------------------
   The docked badge
---------------------------------------- */

/**
 * Sit the badge beside the travel dial.
 *
 * Both are anchored to the player list, which grows upward as people connect
 * -- a fixed offset works at an empty table and is covered at a full one, so
 * the real element gets measured. The dial does the same; this deliberately
 * repeats the measurement rather than reading the dial's own position, so the
 * badge still lands correctly when the clock is switched off and there is no
 * dial to sit next to.
 */
function positionDoomBadge(el) {
  const players = document.getElementById('players');
  if (!players) return;
  el.style.bottom = `${players.offsetHeight + 10}px`;

  // To the RIGHT of the dial when it's there, hard left when it isn't.
  const dial = document.getElementById('darkest-travel-dial');
  el.style.left = dial ? `${dial.offsetLeft + dial.offsetWidth + 8}px` : '12px';
}

/**
 * The always-visible doom badge.
 *
 * A plain DOM node docked to the UI, not an Application -- same reasoning as
 * the travel dial: it occupies no window slot and needs no opening. The full
 * window still exists for the per-character breakdown and the GM's
 * adjustment; this is the at-a-glance number.
 *
 * Everyone sees it. The doom count is public information at the table -- the
 * players' own sheets carry the Dooms it adds up.
 */
export function renderDoomBadge() {
  if (!game.ready) return;

  let el = document.getElementById('darkest-doom-badge');

  if (!game.settings.get('darkest-system', 'showDoomBadge')) {
    el?.remove();
    return;
  }

  const { total, characters } = DoomTally.calculateTotalDooms();
  const adjustment = DoomTally.getManualAdjustment();
  const shown = Math.max(0, total + adjustment);

  if (!el) {
    el = document.createElement('div');
    el.id = 'darkest-doom-badge';
    document.body.appendChild(el);
    // Opens the full tally -- the breakdown and, for a GM, the adjustment.
    // Everyone gets this: the window is not GM-only either.
    el.addEventListener('click', () => {
      const existing = Object.values(ui.windows).find(w => w instanceof DoomTally);
      if (existing) existing.bringToTop();
      else new DoomTally().render(true);
    });
  }

  // Nothing to fear yet reads differently from a mounting count.
  el.className = `darkest-doom-badge${shown > 0 ? ' has-doom' : ''}`;

  const breakdown = characters.filter(c => c.dooms > 0)
    .map(c => `${c.name}: ${c.dooms}`);
  el.title = [
    `${shown} Doom${shown === 1 ? '' : 's'}`,
    breakdown.length ? breakdown.join('\n') : 'No dooms held.',
    adjustment !== 0 ? `(includes a GM adjustment of ${adjustment > 0 ? '+' : ''}${adjustment})` : null,
    '\nClick to open the Doom Tally',
  ].filter(Boolean).join('\n');

  el.innerHTML = `
    <i class="fas fa-skull badge-icon"></i>
    <div class="badge-readout">
      <span class="badge-number">${shown}</span>
      <span class="badge-label">Doom</span>
    </div>`;

  positionDoomBadge(el);
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

  // Client-scoped, unlike most of this system's settings: where a GM wants
  // their screen furniture is not a property of the world, and a player who
  // finds a skull in the corner distracting can drop it without changing
  // anything for anyone else.
  game.settings.register('darkest-system', 'showDoomBadge', {
    name: 'Show the doom count on screen',
    hint: 'Keeps the total beside the travel clock, above the player list. Click it to open the full tally. Turning this off does not change the tally itself.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => renderDoomBadge(),
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

  // The tally counts player-OWNED characters, so it changes when an actor
  // arrives, leaves, or has its ownership edited -- not only when a Doom
  // does. Without these the badge could sit on a stale number for the rest
  // of the session, which is worse than not showing one at all.
  Hooks.on('createActor', (actor) => {
    if (actor.type === 'character') DoomTally.refresh();
  });

  Hooks.on('deleteActor', (actor) => {
    if (actor.type === 'character') DoomTally.refresh();
  });

  Hooks.on('updateActor', (actor, changes) => {
    if (actor.type === 'character' && changes.ownership) DoomTally.refresh();
  });

  // Listen for doom tally updates from other clients
  game.socket.on('system.darkest-system', (data) => {
    if (data.type === 'doomTallyUpdate') {
      DoomTally.refresh();
    }
  });

  // The player list changes height as people connect, and the badge sits on
  // top of it -- re-measure whenever it redraws.
  //
  // The badge also anchors to the RIGHT of the travel dial, which this same
  // hook repositions. Registration order decides who measures whom, and this
  // file's hooks are registered BEFORE the clock's, so on this tick the dial
  // has not moved yet. Defer to the end of the frame rather than reordering
  // the two registrations -- that ordering is not this file's to depend on,
  // and a future edit could silently flip it back.
  Hooks.on('renderPlayerList', () => requestAnimationFrame(() => renderDoomBadge()));

  // Called directly, not via Hooks.on('ready'): this runs FROM the ready
  // handler, and Foundry never replays a hook that has already fired.
  //
  // Deferred for the same reason as above -- the travel dial is created
  // later in that same handler, so measuring it now would find nothing and
  // park the badge hard left.
  requestAnimationFrame(() => renderDoomBadge());
}
