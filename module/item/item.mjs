/**
 * Extend the basic Item for The Darkest System
 */
export class DarkestItem extends Item {

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  prepareDerivedData() {
    const itemData = this;
    const systemData = itemData.system;

    // Prepare data based on item type
    if (itemData.type === 'wound') this._prepareWoundData(systemData);
    if (itemData.type === 'doom') this._prepareDoomData(systemData);
    if (itemData.type === 'ability') this._prepareAbilityData(systemData);
    if (itemData.type === 'equipment') this._prepareEquipmentData(systemData);
  }

  /**
   * Prepare Wound specific data
   */
  _prepareWoundData(systemData) {
    // Ensure rating is within bounds
    systemData.rating = Math.max(1, Math.min(10, systemData.rating || 1));
  }

  /**
   * Prepare Doom specific data
   */
  _prepareDoomData(systemData) {
    // Nothing special needed yet
  }

  /**
   * Prepare Ability specific data
   */
  _prepareAbilityData(systemData) {
    // Ensure uses remaining doesn't exceed uses per day
    if (systemData.usesPerDay > 0) {
      systemData.usesRemaining = Math.min(
        systemData.usesRemaining ?? systemData.usesPerDay,
        systemData.usesPerDay
      );
    }
  }

  /**
   * Prepare Equipment specific data
   */
  _prepareEquipmentData(systemData) {
    // Nothing special needed yet
  }

  /**
   * Get the roll data for this item
   */
  getRollData() {
    const rollData = { ...this.system };

    // If there's an owning actor, add their roll data
    if (this.actor) {
      rollData.actor = this.actor.getRollData();
    }

    return rollData;
  }

  /**
   * Use an ability (decrement uses if applicable)
   */
  async useAbility() {
    if (this.type !== 'ability') return;

    const systemData = this.system;

    if (systemData.usesPerDay > 0) {
      if (systemData.usesRemaining <= 0) {
        ui.notifications.warn(`${this.name} has no uses remaining!`);
        return false;
      }

      await this.update({ 'system.usesRemaining': systemData.usesRemaining - 1 });
    }

    // Send to chat
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="darkest-ability-use">
          <h3><i class="fas fa-magic"></i> ${this.name}</h3>
          <p>${systemData.description || ''}</p>
          ${systemData.grantsBoon ? '<p><i class="fas fa-plus-circle"></i> Grants a Boon</p>' : ''}
        </div>`
    });

    return true;
  }

  /**
   * Refresh ability uses (for daily reset)
   */
  async refreshUses() {
    if (this.type !== 'ability') return;

    if (this.system.usesPerDay > 0) {
      await this.update({ 'system.usesRemaining': this.system.usesPerDay });
    }
  }
}
