/**
 * NPC Combat Tracker
 * GM-only window for tracking cumulative damage against NPCs.
 *
 * Rules: NPC defeated when total wound ratings = 3 × NPC Rating.
 * Instant kill: single wound ≥ NPC Rating + 3.
 *
 * Damage auto-applies to the active (selected) slot whenever a Deal Damage
 * roll produces a wound (via the darkestSystem.damageDealt hook).
 */

// Raised from 6 when quick-create gained a count field: a pack of three
// wolves plus a witch and a couple of strays used to overflow immediately.
const MAX_SLOTS = 12;
const SETTING_KEY = 'npcTracker';

// Scratch NPCs made by the quick-create button live here, flagged so they
// can be cleared in bulk without touching anything the GM built by hand.
const QUICK_FOLDER = 'Quick NPCs';
const QUICK_FLAG = 'quickNpc';

export class NpcTracker extends Application {

  /**
   * Serialises damage writes.
   *
   * applyDamage() is a read-modify-write on a world setting, and
   * game.settings.get() hands back a freshly deserialised object every call
   * -- so two hits landing inside the same write window both read the same
   * starting total and the second silently discards the first. Rare at a
   * real table (it needs two damage rolls within ~10ms) but it loses a
   * player's hit outright when it happens, and the NPC survives longer than
   * it should.
   *
   * Queuing here also fixes a smaller thing: two concurrent hits could both
   * see !slot.defeated and post the "defeated!" message twice.
   *
   * Same shape as SessionLog._writeQueue -- the .catch() first is load
   * bearing, so one failed write can't wedge the queue for the session.
   */
  static _writeQueue = Promise.resolve();

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'npc-tracker',
      title: 'NPC Combat Tracker',
      template: 'systems/darkest-system/templates/apps/npc-tracker.hbs',
      classes: ['darkest-system', 'npc-tracker'],
      width: 420,
      height: 'auto',
      resizable: true,
      minimizable: true,
      dragDrop: [{ dropSelector: '.npc-tracker' }],
      // Every damage +/-, reset, select, or remove click calls this.render(),
      // which otherwise resets scroll to the top. Same fix as
      // DarkestActorSheet's scrollY.
      scrollY: ['.window-content']
    });
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  static getData_() {
    const defaults = { slots: [], activeSlot: null };
    try {
      return game.settings.get('darkest-system', SETTING_KEY) || defaults;
    } catch (e) {
      return defaults;
    }
  }

  static async setData(data) {
    await game.settings.set('darkest-system', SETTING_KEY, data);
  }

  // ── Static operations ─────────────────────────────────────────────────────

  static async addNpc(actorId) {
    return NpcTracker.addNpcs([actorId]);
  }

  /**
   * Add several at once in a single write.
   *
   * getData_()/setData() is a read-modify-write on one setting, so adding a
   * pack one call at a time would either need careful awaiting or lose
   * slots. Batching sidesteps it entirely.
   */
  static async addNpcs(actorIds) {
    const data = NpcTracker.getData_();
    const room = MAX_SLOTS - data.slots.length;
    if (room <= 0) {
      ui.notifications.warn(`NPC Tracker is full (${MAX_SLOTS} slots). Remove an NPC first.`);
      return;
    }
    // Duplicates are allowed on purpose. Three wolves are three separate
    // creatures with their own wound totals, and blocking the second one
    // made a pack impossible to track at all. Quick-create numbers them
    // ("Wolf 1", "Wolf 2") so the slots stay tellable apart; dragging the
    // same actor in twice is the GM's call.
    for (const actorId of actorIds.slice(0, room)) {
      data.slots.push({ actorId, woundTotal: 0, defeated: false });
    }
    // Auto-select the first one added, if nothing was selected before.
    if (data.activeSlot === null && data.slots.length) data.activeSlot = 0;
    await NpcTracker.setData(data);
    NpcTracker._refresh();
  }

  /**
   * Make N throwaway creatures of a given Rating and track them.
   *
   * Rating is the only number that matters for a creature in this system --
   * it sets the defeat threshold (Rating x 3), the instant-kill line
   * (Rating + 3), and the target number to hit it. So "a creature of level
   * 4" is genuinely just a name and a 4, and everything else follows.
   *
   * These are real Actors rather than bare slot data, because the tracker
   * resolves slots through game.actors and because a real Actor can be
   * targeted, dropped on the canvas, and opened. They're foldered and
   * flagged so they can be swept up afterwards.
   */
  static async quickCreate({ name, rating, count = 1 }) {
    const clean = (name || '').trim() || 'Creature';
    // Blank/absent falls back to the default; anything typed is clamped.
    // Not `Number(x) || default` -- a typed 0 is falsy and would silently
    // become a Rating 3 creature instead of clamping to 1. And not
    // Number.isFinite alone -- Number('') and Number(null) are both 0, so an
    // empty box would clamp to 1 rather than take the default.
    const num = (v, dflt) => {
      if (v === null || v === undefined || String(v).trim() === '') return dflt;
      const n = Number(v);
      return Number.isFinite(n) ? n : dflt;
    };
    const r = Math.max(1, Math.min(10, Math.round(num(rating, 3))));
    const n = Math.max(1, Math.min(MAX_SLOTS, Math.round(num(count, 1))));

    const data = NpcTracker.getData_();
    const room = MAX_SLOTS - data.slots.length;
    if (room <= 0) {
      ui.notifications.warn(`NPC Tracker is full (${MAX_SLOTS} slots). Remove something first.`);
      return;
    }
    const making = Math.min(n, room);
    if (making < n) {
      ui.notifications.warn(`Only room for ${making} more -- creating ${making} of ${n}.`);
    }

    let folder = game.folders.find(f => f.type === 'Actor' && f.name === QUICK_FOLDER);
    if (!folder) {
      folder = await Folder.create({ name: QUICK_FOLDER, type: 'Actor', color: '#6a3a3a' });
    }

    // Numbered only when there's more than one, so a lone creature stays
    // "Wolf" rather than the faintly silly "Wolf 1".
    const payloads = Array.from({ length: making }, (_, i) => ({
      name: making > 1 ? `${clean} ${i + 1}` : clean,
      type: 'npc',
      folder: folder.id,
      system: { rating: r },
      flags: { 'darkest-system': { [QUICK_FLAG]: true } },
    }));

    const actors = await Actor.createDocuments(payloads);
    await NpcTracker.addNpcs(actors.map(a => a.id));

    ui.notifications.info(
      `Added ${making} x ${clean} (Rating ${r}, defeated at ${r * 3} wound rating).`
    );
  }

  /**
   * Delete quick-created actors that are no longer in the tracker.
   *
   * Only ones this tool made (flagged) and only ones not currently tracked,
   * so clearing mid-fight can't delete something still on screen.
   */
  static async clearSpentQuickNpcs() {
    const tracked = new Set(NpcTracker.getData_().slots.map(s => s.actorId));
    const spent = game.actors.filter(a =>
      a.getFlag('darkest-system', QUICK_FLAG) && !tracked.has(a.id)
    );
    if (!spent.length) {
      ui.notifications.info('No spent quick NPCs to clear.');
      return;
    }
    await Actor.deleteDocuments(spent.map(a => a.id));
    ui.notifications.info(`Deleted ${spent.length} quick NPC${spent.length === 1 ? '' : 's'}.`);
    NpcTracker._refresh();
  }

  static async removeNpc(index) {
    const data = NpcTracker.getData_();
    data.slots.splice(index, 1);
    // Fix active slot index
    if (data.activeSlot !== null) {
      if (data.slots.length === 0) {
        data.activeSlot = null;
      } else if (data.activeSlot >= data.slots.length) {
        data.activeSlot = data.slots.length - 1;
      }
    }
    await NpcTracker.setData(data);
    NpcTracker._refresh();
  }

  static async setActive(index) {
    const data = NpcTracker.getData_();
    data.activeSlot = index;
    await NpcTracker.setData(data);
    NpcTracker._refresh();
  }

  static async resetNpc(index) {
    const data = NpcTracker.getData_();
    if (data.slots[index]) {
      data.slots[index].woundTotal = 0;
      data.slots[index].defeated = false;
      data.slots[index].lethalBlow = false;
    }
    await NpcTracker.setData(data);
    NpcTracker._refresh();
  }

  static async adjustDamage(index, delta) {
    const data = NpcTracker.getData_();
    const slot = data.slots[index];
    if (!slot) return;
    slot.woundTotal = Math.max(0, slot.woundTotal + delta);

    const actor = game.actors.get(slot.actorId);
    if (actor) {
      const threshold = (actor.system.rating || 3) * 3;
      // Only auto-set defeated when threshold is newly crossed — never auto-clear it.
      // The Reset button is the only way to un-defeat an NPC.
      if (slot.woundTotal >= threshold && !slot.defeated) {
        slot.defeated = true;
        NpcTracker._notifyDefeated(actor.name, slot.woundTotal, threshold);
      }
    }

    await NpcTracker.setData(data);
    NpcTracker._refresh();
  }

  /**
   * Called automatically from the darkestSystem.damageDealt hook.
   * Applies woundRating to the active NPC slot.
   */
  static async applyDamage(woundRating) {
    NpcTracker._writeQueue = NpcTracker._writeQueue
      .catch(() => {})  // one failed write must not wedge the queue
      .then(() => NpcTracker._applyDamageUnsafe(woundRating));
    return NpcTracker._writeQueue;
  }

  /** The actual read-modify-write. Only ever called through the queue. */
  static async _applyDamageUnsafe(woundRating) {
    const data = NpcTracker.getData_();
    if (data.activeSlot === null || data.activeSlot === undefined) return;
    const slot = data.slots[data.activeSlot];
    if (!slot) return;

    slot.woundTotal = (slot.woundTotal || 0) + woundRating;

    const actor = game.actors.get(slot.actorId);
    if (actor) {
      const rating = actor.system.rating || 3;
      const threshold = rating * 3;

      // Lethal blow: single wound rating >= NPC rating + 3
      if (woundRating >= rating + 3) {
        slot.lethalBlow = true;
        NpcTracker._notifyLethal(actor.name, woundRating, rating);
      }

      if (slot.woundTotal >= threshold && !slot.defeated) {
        slot.defeated = true;
        NpcTracker._notifyDefeated(actor.name, slot.woundTotal, threshold);
      }
    }

    await NpcTracker.setData(data);
    NpcTracker._refresh();
  }

  static _notifyDefeated(name, total, threshold) {
    ui.notifications.warn(
      `${name} has been defeated! Total wound rating ${total} has reached the threshold of ${threshold}.`,
      { permanent: false }
    );
  }

  static _notifyLethal(name, woundRating, npcRating) {
    ui.notifications.error(
      `LETHAL BLOW! ${name} received a wound of ${woundRating} — exceeds Rating ${npcRating} + 3. Instant kill/KO at GM discretion.`,
      { permanent: false }
    );
  }

  static _refresh() {
    const tracker = Object.values(ui.windows).find(w => w instanceof NpcTracker);
    if (tracker) tracker.render();
  }

  // ── Application ───────────────────────────────────────────────────────────

  getData() {
    const data = NpcTracker.getData_();

    const slots = data.slots.map((slot, index) => {
      const actor = game.actors.get(slot.actorId);
      if (!actor) return null;
      const rating = actor.system.rating || 3;
      const threshold = rating * 3;
      const pct = Math.min(100, Math.round((slot.woundTotal / threshold) * 100));
      const barClass = pct >= 100 ? 'critical' : pct >= 75 ? 'warning' : '';
      return {
        index,
        actorId: slot.actorId,
        name: actor.name,
        rating,
        threshold,
        woundTotal: slot.woundTotal,
        pct,
        barClass,
        isActive: index === data.activeSlot,
        defeated: slot.defeated === true,
        lethalBlow: slot.lethalBlow === true
      };
    }).filter(Boolean);

    const tracked = new Set(data.slots.map(s => s.actorId));
    const spentQuick = game.actors.filter(a =>
      a.getFlag('darkest-system', QUICK_FLAG) && !tracked.has(a.id)
    ).length;

    return {
      slots,
      activeSlot: data.activeSlot,
      hasSlots: slots.length > 0,
      canAdd: data.slots.length < MAX_SLOTS,
      maxSlots: MAX_SLOTS,
      spentQuick
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Select active NPC
    // Quick-create. Show what the numbers mean before committing, since
    // "Rating 4" on its own doesn't tell you much at a glance.
    const updatePreview = () => {
      const rawR = parseInt(html.find('[name="quickRating"]').val(), 10);
      const rawN = parseInt(html.find('[name="quickCount"]').val(), 10);
      const r = Math.max(1, Math.min(10, Number.isFinite(rawR) ? rawR : 3));
      const n = Math.max(1, Number.isFinite(rawN) ? rawN : 1);
      html.find('.quick-create-preview').text(
        `${n > 1 ? `${n} creatures, each ` : ''}defeated at ${r * 3} total wound rating · `
        + `a single wound of ${r + 3}+ kills outright · rolls against them target ${7 + r}`
      );
    };
    html.find('[name="quickRating"], [name="quickCount"]').on('input change', updatePreview);
    updatePreview();

    const submitQuick = async () => {
      await NpcTracker.quickCreate({
        name: html.find('[name="quickName"]').val(),
        rating: html.find('[name="quickRating"]').val(),
        count: html.find('[name="quickCount"]').val(),
      });
    };
    html.find('.quick-create-btn').click(submitQuick);
    // Enter in the name box is the fast path mid-combat.
    html.find('[name="quickName"]').on('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); submitQuick(); }
    });

    html.find('.quick-clear-btn').click(async () => {
      await NpcTracker.clearSpentQuickNpcs();
    });

    html.find('.slot-select-btn').click(async (ev) => {
      const index = parseInt(ev.currentTarget.dataset.index);
      await NpcTracker.setActive(index);
    });

    // Remove NPC from slot
    html.find('.slot-remove-btn').click(async (ev) => {
      const index = parseInt(ev.currentTarget.dataset.index);
      await NpcTracker.removeNpc(index);
    });

    // Reset wound total
    html.find('.slot-reset-btn').click(async (ev) => {
      const index = parseInt(ev.currentTarget.dataset.index);
      await NpcTracker.resetNpc(index);
    });

    // Manual +1 / -1 damage
    html.find('.slot-dmg-plus').click(async (ev) => {
      const index = parseInt(ev.currentTarget.dataset.index);
      await NpcTracker.adjustDamage(index, 1);
    });

    html.find('.slot-dmg-minus').click(async (ev) => {
      const index = parseInt(ev.currentTarget.dataset.index);
      await NpcTracker.adjustDamage(index, -1);
    });
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  _canDragDrop(selector) {
    return game.user.isGM;
  }

  async _onDrop(event) {
    let data;
    try {
      data = TextEditor.getDragEventData(event);
    } catch (e) {
      return;
    }
    if (data.type !== 'Actor') return;

    let actor;
    try {
      actor = await fromUuid(data.uuid);
    } catch (e) {
      // Fallback for older drag data format
    }
    if (!actor && data.id) {
      actor = game.actors.get(data.id);
    }

    if (!actor) {
      ui.notifications.warn('Could not find actor from drop data.');
      return;
    }
    if (actor.type === 'character') {
      ui.notifications.warn('Only NPCs can be added to the NPC Tracker.');
      return;
    }

    // The tracker only ever looks up NPCs via game.actors.get() (the World
    // collection), so a compendium-only actor dropped directly from a pack
    // tab must be imported into the World first -- otherwise it saves into
    // the tracker's slot data with an id nothing can resolve, and getData()
    // silently drops the slot from the rendered list every time.
    if (!game.actors.has(actor.id)) {
      const [imported] = await Actor.createDocuments([actor.toObject()]);
      actor = imported;
    }

    await NpcTracker.addNpc(actor.id);
  }
}

/**
 * Register world setting for NPC tracker data
 */
export function registerNpcTrackerSettings() {
  game.settings.register('darkest-system', SETTING_KEY, {
    name: 'NPC Tracker Data',
    hint: 'Stores NPC combat tracking data',
    scope: 'world',
    config: false,
    type: Object,
    default: { slots: [], activeSlot: null }
  });
}
