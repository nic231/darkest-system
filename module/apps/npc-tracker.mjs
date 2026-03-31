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

const MAX_SLOTS = 6;
const SETTING_KEY = 'npcTracker';

export class NpcTracker extends Application {

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
      dragDrop: [{ dropSelector: '.npc-tracker' }]
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
    const data = NpcTracker.getData_();
    if (data.slots.length >= MAX_SLOTS) {
      ui.notifications.warn('NPC Tracker is full (6 slots). Remove an NPC first.');
      return;
    }
    // Prevent duplicates
    if (data.slots.find(s => s.actorId === actorId)) {
      ui.notifications.info('That NPC is already in the tracker.');
      return;
    }
    data.slots.push({ actorId, woundTotal: 0, defeated: false });
    // Auto-select if first slot
    if (data.slots.length === 1) data.activeSlot = 0;
    await NpcTracker.setData(data);
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

    return {
      slots,
      activeSlot: data.activeSlot,
      hasSlots: slots.length > 0,
      canAdd: data.slots.length < MAX_SLOTS
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Select active NPC
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
