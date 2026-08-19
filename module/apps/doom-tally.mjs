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
 *
 * The badge is a panel rather than a pill, and taller than the dial, so the
 * two are aligned along their BOTTOM edge -- sharing a `bottom` is what makes
 * them read as one row of furniture. It also means the badge grows upward as
 * characters are added, away from the player list, instead of down into it.
 */
function positionDoomBadge(el) {
  const players = document.getElementById('players');
  if (!players) return;

  // To the RIGHT of the dial -- and of the PLAYER LIST, which is the wider of
  // the two and the one that actually gets covered.
  //
  // This used to clear the dial alone. The dial is a narrow pill (~112px) but
  // the player list is nearly twice that (~210px), so a badge placed just
  // past the dial landed squarely on top of the list once the roster filled
  // out. Clearing whichever is wider fixes it for any roster and any player
  // name length, since the list grows sideways with the longest name.
  const dial = document.getElementById('darkest-travel-dial');
  const clearOf = (node) => node ? node.offsetLeft + node.offsetWidth : 0;
  el.style.left = `${Math.max(clearOf(dial), clearOf(players), 4) + 8}px`;

  // Sit on the same baseline as the dial, so the two read as one row of
  // furniture. It no longer needs to clear the player list VERTICALLY -- it
  // now clears it sideways -- so anchoring to the list's height would only
  // push it needlessly up the screen.
  const bottom = dial
    ? Math.max(0, window.innerHeight - (dial.offsetTop + dial.offsetHeight))
    : 12;
  el.style.bottom = `${bottom}px`;

  // The badge still grows UPWARD as characters are added -- the total block
  // plus one row each -- and it sits at z-index 70, above Foundry's own UI,
  // so nothing pushes it aside if it gets tall. Cap the roster list to the
  // space actually available; the skull and the total stay whole, and the
  // list scrolls inside the cap, so nothing is hidden permanently.
  const available = window.innerHeight - bottom - 60;   // 60: leave the top clear
  const list = el.querySelector('.badge-list');
  if (list) {
    // Measure the chrome (skull, total, padding) with the cap LIFTED, then
    // apply the new one. Reading offsetHeight while a previous max-height is
    // still in force measures the clamped list, so `chrome` would come out
    // too large and the badge would shrink a little further on every
    // reposition -- a full roster would ratchet down to nothing over a
    // session's worth of players connecting and disconnecting.
    list.style.maxHeight = 'none';
    const chrome = el.offsetHeight - list.offsetHeight;
    list.style.maxHeight = `${Math.max(0, available - chrome)}px`;
  }
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

  el.title = [
    adjustment !== 0
      ? `Includes a GM adjustment of ${adjustment > 0 ? '+' : ''}${adjustment}.`
      : null,
    'Click to open the Doom Tally',
  ].filter(Boolean).join('\n');

  // The window's own total panel and per-character list, at badge size. The
  // names are the point: "3 Doom" says the table is in trouble, and the list
  // says who is carrying it -- which is the question actually asked next.
  //
  // Escaped: actor names are user input, and this is innerHTML. Guarded the
  // way the rest of the system guards it -- this runs on every render, and a
  // missing helper must not take the badge out.
  const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');
  const rows = characters.map(c => `
      <div class="badge-row ${c.dooms ? 'has-dooms' : 'no-dooms'}">
        <span class="badge-row-name">${esc(c.name)}</span>
        <span class="badge-row-count">${c.dooms}</span>
      </div>`).join('');

  el.innerHTML = `
    <div class="badge-total">
      <i class="fas fa-skull badge-icon"></i>
      <div class="badge-count">
        <span class="badge-number">${shown}</span>
        <span class="badge-label">Doom</span>
      </div>
    </div>
    ${rows ? `<div class="badge-list">${rows}</div>` : ''}`;

  positionDoomBadge(el);

  // The wood folk and birdsong badges stack on top of this one and measure
  // its position, so they have to re-measure whenever it moves or changes
  // height (a character gaining a Doom adds a row). Dynamic import keeps the
  // dependency one-way: doom-tally knows nothing about them at load.
  import('./party-tokens.mjs')
    .then(m => m.renderPartyBadges?.())
    .catch(() => {});   // never let the stack above take the badge out
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

  // The height cap is computed from window.innerHeight, so it goes stale on a
  // resize or a jump to fullscreen -- the badge would keep the cap for the
  // old window and either waste space or overlap the chat panel again.
  // Debounced: a drag-resize fires this continuously.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderDoomBadge(), 150);
  });

  // Called directly, not via Hooks.on('ready'): this runs FROM the ready
  // handler, and Foundry never replays a hook that has already fired.
  //
  // Deferred for the same reason as above -- the travel dial is created
  // later in that same handler, so measuring it now would find nothing and
  // park the badge hard left.
  requestAnimationFrame(() => renderDoomBadge());
}
