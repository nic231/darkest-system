import { DARKEST } from '../helpers/config.mjs';

/**
 * Extend the basic ItemSheet for The Darkest System
 */
export class DarkestItemSheet extends ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['darkest-system', 'sheet', 'item'],
      width: 500,
      height: 400,
      tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'description' }]
    });
  }

  /** @override */
  get template() {
    return `systems/darkest-system/templates/item/item-${this.item.type}-sheet.hbs`;
  }

  /** @override */
  async getData() {
    const context = super.getData();

    // Use a safe clone of the item data
    const itemData = this.document.toObject(false);

    context.system = itemData.system;
    context.flags = itemData.flags;

    // Add config
    context.config = DARKEST;

    // Enrich HTML content
    context.enrichedDescription = await TextEditor.enrichHTML(
      context.system.description || '',
      { async: true, rollData: this.item.getRollData() }
    );

    // Add type-specific context
    if (this.item.type === 'wound') {
      context.woundTypes = DARKEST.woundTypes;
    }

    if (this.item.type === 'ability') {
      context.abilityTypes = DARKEST.abilityTypes;
    }

    if (this.item.type === 'equipment') {
      context.armorTypes = DARKEST.armorTypes;
    }

    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    if (!this.isEditable) return;

    // Use ability button
    html.find('.use-ability').click(this._onUseAbility.bind(this));
  }

  /**
   * Handle using an ability
   */
  async _onUseAbility(event) {
    event.preventDefault();
    await this.item.useAbility();
  }
}
