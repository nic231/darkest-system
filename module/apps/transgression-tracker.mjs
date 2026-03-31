/**
 * Transgression Tracker / House Action Tracker Application
 * GM-only window for tracking transgression levels (Darkest Woods) or
 * house action escalation (Darkest House).
 */

// Content placeholders — populated by the darkest-woods module if installed,
// or customised manually by the GM via the tracker UI.
export let HOUSE_ACTIONS = Array(10).fill('');
export let WITCHES = {};

// Allow companion modules to inject content via a hook before the tracker is used.
Hooks.once('darkestSystem.registerTransgressionContent', (data) => {
  if (data.houseActions) HOUSE_ACTIONS = data.houseActions;
  if (data.witches) WITCHES = data.witches;
});

export class TransgressionTracker extends Application {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'transgression-tracker',
      title: 'Transgression Tracker',
      template: 'systems/darkest-system/templates/apps/transgression-tracker.hbs',
      classes: ['darkest-system', 'transgression-tracker'],
      width: 660,
      height: 'auto',
      resizable: true,
      minimizable: true
    });
  }

  /**
   * Get the current game mode ('darkest-woods' or 'darkest-house')
   */
  static getGameMode() {
    try {
      return game.settings.get('darkest-system', 'gameMode') || 'darkest-woods';
    } catch {
      return 'darkest-woods';
    }
  }

  /**
   * Get house action data from world settings
   */
  static getHouseActions() {
    return game.settings.get('darkest-system', 'houseActions') || { level: 0, loops: 0 };
  }

  /**
   * Save house action data to world settings
   */
  static async setHouseActions(data) {
    await game.settings.set('darkest-system', 'houseActions', data);
  }

  /**
   * Get transgression data from world settings
   */
  static getTransgressions() {
    const defaultData = {};
    for (const regionId of Object.keys(TransgressionTracker.getAllRegions())) {
      defaultData[regionId] = { level: 0, loops: 0 };
    }
    return game.settings.get('darkest-system', 'transgressions') || defaultData;
  }

  static hasContent() {
    return Object.keys(TransgressionTracker.getAllRegions()).length > 0;
  }

  /** Returns merged injected + custom regions */
  static getAllRegions() {
    const custom = game.settings.get('darkest-system', 'customRegions') || {};
    return foundry.utils.mergeObject(foundry.utils.deepClone(WITCHES), custom);
  }

  static getCustomRegions() {
    return game.settings.get('darkest-system', 'customRegions') || {};
  }

  static async setCustomRegions(data) {
    await game.settings.set('darkest-system', 'customRegions', data);
  }

  /** Open add/edit dialog for a region */
  static async openRegionDialog(existingSlug = null) {
    const ALL = TransgressionTracker.getAllRegions();
    const existing = existingSlug ? ALL[existingSlug] : null;
    const isCustom = existingSlug ? !WITCHES[existingSlug] : true;

    const eventFields = Array.from({ length: 10 }, (_, i) => {
      const text = existing?.transgressionEvents?.[i] || '';
      return `<div class="region-event-row">
        <label>${i + 1}.</label>
        <input type="text" name="event_${i}" value="${text.replace(/"/g, '&quot;')}" placeholder="Event ${i + 1} description (optional)">
      </div>`;
    }).join('');

    const content = `<div class="darkest-dialog region-edit-dialog">
      <div class="form-group">
        <label>Region Name</label>
        <input type="text" name="regionName" value="${existing?.name || ''}" placeholder="e.g. The Dark Forest">
      </div>
      <div class="form-group">
        <label>Antagonist Name</label>
        <input type="text" name="witchName" value="${existing?.witch || ''}" placeholder="e.g. The Shadow Witch">
      </div>
      <div class="form-group">
        <label>Key Phrase</label>
        <input type="text" name="keyPhrase" value="${existing?.keyPhrase || ''}" placeholder="Optional flavour phrase">
      </div>
      <div class="form-group region-events-group">
        <label>Transgression Events <span class="form-hint">(optional — fill in from your source material)</span></label>
        ${eventFields}
      </div>
    </div>`;

    return new Promise((resolve) => {
      new Dialog({
        title: existingSlug ? 'Edit Region' : 'Add Region',
        content,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: 'Save',
            callback: async (html) => {
              const name = html.find('[name="regionName"]').val().trim();
              if (!name) { ui.notifications.warn('Region name is required.'); return; }

              const witch = html.find('[name="witchName"]').val().trim();
              const keyPhrase = html.find('[name="keyPhrase"]').val().trim();
              const events = Array.from({ length: 10 }, (_, i) =>
                html.find(`[name="event_${i}"]`).val().trim()
              ).filter(Boolean);

              const slug = existingSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              const custom = TransgressionTracker.getCustomRegions();
              custom[slug] = { name, witch, keyPhrase, transgressionEvents: events };
              await TransgressionTracker.setCustomRegions(custom);

              const tracker = Object.values(ui.windows).find(w => w instanceof TransgressionTracker);
              if (tracker) tracker.render();
              resolve(slug);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'save'
      }, { width: 480 }).render(true);
    });
  }

  /**
   * Save transgression data to world settings
   */
  static async setTransgressions(data) {
    await game.settings.set('darkest-system', 'transgressions', data);
  }

  /**
   * Get the current region based on active scene
   */
  static getCurrentRegion() {
    const ALL = TransgressionTracker.getAllRegions();
    const scene = game.scenes.active;
    if (!scene) return null;

    const regionSlug = scene.getFlag('darkest-system', 'region');
    if (regionSlug && ALL[regionSlug]) return regionSlug;

    const sceneName = scene.name.toLowerCase();
    for (const [slug, data] of Object.entries(ALL)) {
      if (sceneName.includes(data.name.toLowerCase())) return slug;
    }

    return game.settings.get('darkest-system', 'currentRegion') || null;
  }

  static async setCurrentRegion(regionSlug) {
    const ALL = TransgressionTracker.getAllRegions();
    if (ALL[regionSlug] || regionSlug === null) {
      await game.settings.set('darkest-system', 'currentRegion', regionSlug);
    }
  }

  /**
   * Increment transgression for a region (Darkest Woods) or advance the house
   * action counter (Darkest House).
   */
  static async incrementTransgression(regionSlug) {
    if (this.getGameMode() === 'darkest-house') {
      return this._incrementHouseAction();
    }

    const ALL = TransgressionTracker.getAllRegions();
    if (!regionSlug || !ALL[regionSlug]) {
      ui.notifications.warn('No valid region selected for transgression tracking');
      return null;
    }

    const transgressions = this.getTransgressions();
    if (!transgressions[regionSlug]) transgressions[regionSlug] = { level: 0, loops: 0 };
    const region = transgressions[regionSlug];
    const antagonist = ALL[regionSlug].witch || ALL[regionSlug].name;

    region.level++;
    if (region.level > 10) {
      region.level = 1;
      region.loops++;

      if (region.loops >= 3) {
        ui.notifications.error(
          `CRITICAL: ${antagonist} has completed 3 transgression cycles! ` +
          `They can now open the door to the Dark Forest!`,
          { permanent: true }
        );
      } else {
        ui.notifications.warn(
          `${antagonist} has completed a transgression cycle! Loop ${region.loops}/3`
        );
      }
    }

    await this.setTransgressions(transgressions);

    // Post the triggered event to GM chat
    const regionData = ALL[regionSlug];
    const eventIndex = region.level - 1;
    const eventText = regionData?.transgressionEvents?.[eventIndex];
    if (eventText) {
      await ChatMessage.create({
        speaker: { alias: regionData.witch || regionData.name },
        content: `<div class="house-action-chat"><strong>${regionData.name} — Transgression ${region.level}:</strong><p>${eventText}</p></div>`,
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
    }

    // Refresh tracker if open
    const tracker = Object.values(ui.windows).find(w => w instanceof TransgressionTracker);
    if (tracker) {
      tracker.render();
    }

    return region;
  }

  /**
   * Advance the house action counter and post the next action to chat (House mode).
   */
  static async _incrementHouseAction() {
    const data = this.getHouseActions();

    data.level++;
    if (data.level > 10) {
      data.level = 1;
      data.loops = (data.loops || 0) + 1;
      ui.notifications.warn(`The house has cycled through all actions — starting over (cycle ${data.loops}).`);
    }

    await this.setHouseActions(data);

    // Post the triggered action to chat (GM only)
    const actionText = HOUSE_ACTIONS[data.level - 1];
    if (actionText) {
      await ChatMessage.create({
        speaker: { alias: 'The House' },
        content: `<div class="house-action-chat"><strong>House Action ${data.level}:</strong><p>${actionText}</p></div>`,
        whisper: game.users.filter(u => u.isGM).map(u => u.id)
      });
    }

    // Refresh tracker if open
    const tracker = Object.values(ui.windows).find(w => w instanceof TransgressionTracker);
    if (tracker) tracker.render();

    return data;
  }

  /**
   * Prepare data for the template
   */
  getData() {
    const isHouseMode = TransgressionTracker.getGameMode() === 'darkest-house';

    if (isHouseMode) {
      const data = TransgressionTracker.getHouseActions();
      const level = data.level || 0;
      const loops = data.loops || 0;

      const houseActions = HOUSE_ACTIONS.map((text, i) => ({
        number: i + 1,
        text,
        triggered: i < level,
        next: i === level,
        upcoming: i > level
      }));

      return {
        isHouseMode: true,
        level,
        loops,
        houseActions,
        nextAction: level < 10 ? HOUSE_ACTIONS[level] : null,
        levelDots: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          filled: i < level
        }))
      };
    }

    // --- Darkest Woods mode ---
    if (!TransgressionTracker.hasContent()) {
      return {
        isHouseMode: false,
        isEmpty: true,
        regions: [],
        currentRegion: 'None',
        currentRegionSlug: null,
        witchOptions: []
      };
    }

    const ALL = TransgressionTracker.getAllRegions();
    const transgressions = TransgressionTracker.getTransgressions();
    const currentRegion = TransgressionTracker.getCurrentRegion();

    const regions = Object.entries(ALL).map(([slug, data]) => {
      const transgression = transgressions[slug] || { level: 0, loops: 0 };
      return {
        slug,
        name: data.name,
        witch: data.witch,
        keyPhrase: data.keyPhrase,
        level: transgression.level,
        loops: transgression.loops,
        isCurrent: slug === currentRegion,
        isWarning: transgression.loops >= 2,
        isCritical: transgression.loops >= 3,
        isCustom: !WITCHES[slug],
        levelDots: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          filled: i < transgression.level
        })),
        loopPips: Array.from({ length: 3 }, (_, i) => ({
          filled: i < transgression.loops,
          critical: transgression.loops >= 3 && i < transgression.loops
        })),
        transgressionEvents: (data.transgressionEvents || []).map((text, i) => ({
          number: i + 1,
          text,
          triggered: i < transgression.level,
          next: i === transgression.level
        }))
      };
    });

    return {
      isHouseMode: false,
      isEmpty: regions.length === 0,
      regions,
      currentRegion: currentRegion ? ALL[currentRegion]?.name : 'None',
      currentRegionSlug: currentRegion,
      witchOptions: Object.entries(ALL).map(([slug, data]) => ({
        slug,
        name: data.name,
        selected: slug === currentRegion
      }))
    };
  }

  /** Capture which panels are open before re-render wipes the DOM */
  render(force, options) {
    // Save open state before DOM is replaced
    if (this.element?.length) {
      this._openPanels = new Set();
      this.element.find('.transgression-events:not(.collapsed)').each((_, el) => {
        this._openPanels.add(el.dataset.region);
      });
    }
    return super.render(force, options);
  }

  /**
   * Activate event listeners
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Restore open panels from before the render
    if (this._openPanels?.size) {
      this._openPanels.forEach(slug => {
        const panel = html.find(`.transgression-events[data-region="${slug}"]`);
        if (panel.length) {
          panel.removeClass('collapsed');
          const btn = html.find(`.events-toggle-btn[data-region="${slug}"] i`);
          btn.removeClass('fa-list').addClass('fa-chevron-up');
        }
      });
    }

    const isHouseMode = TransgressionTracker.getGameMode() === 'darkest-house';

    // Increment buttons (work in both modes)
    html.find('.increment-btn').click(async (ev) => {
      const regionSlug = ev.currentTarget.dataset.region;
      await TransgressionTracker.incrementTransgression(regionSlug);
      this.render();
    });

    // Decrement buttons
    html.find('.decrement-btn').click(async (ev) => {
      if (isHouseMode) {
        const data = TransgressionTracker.getHouseActions();
        if (data.level > 0) {
          data.level--;
        } else if (data.loops > 0) {
          data.loops--;
          data.level = 10;
        }
        await TransgressionTracker.setHouseActions(data);
        this.render();
        return;
      }

      const regionSlug = ev.currentTarget.dataset.region;
      const transgressions = TransgressionTracker.getTransgressions();
      const region = transgressions[regionSlug];

      if (region.level > 0) {
        region.level--;
      } else if (region.loops > 0) {
        region.loops--;
        region.level = 10;
      }

      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });

    // Reset button
    html.find('.reset-btn').click(async (ev) => {
      if (isHouseMode) {
        await TransgressionTracker.setHouseActions({ level: 0, loops: 0 });
        this.render();
        return;
      }

      const regionSlug = ev.currentTarget.dataset.region;
      const transgressions = TransgressionTracker.getTransgressions();
      transgressions[regionSlug] = { level: 0, loops: 0 };
      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });

    // Click region summary to set as active (not buttons, dots, or events panel)
    html.find('.region-summary').click(async (ev) => {
      if (ev.target.closest('button') || ev.target.closest('.level-dot')) return;
      const regionSlug = ev.currentTarget.closest('.region-row').dataset.region;
      await TransgressionTracker.setCurrentRegion(regionSlug);
      this.render();
    });

    // Toggle events list
    html.find('.events-toggle-btn').click((ev) => {
      ev.stopPropagation();
      const regionSlug = ev.currentTarget.dataset.region;
      const panel = html.find(`.transgression-events[data-region="${regionSlug}"]`);
      panel.toggleClass('collapsed');
      const icon = ev.currentTarget.querySelector('i');
      icon.classList.toggle('fa-list', panel.hasClass('collapsed'));
      icon.classList.toggle('fa-chevron-up', !panel.hasClass('collapsed'));
    });

    // Click on level dots to set level directly
    html.find('.level-dot').click(async (ev) => {
      const regionSlug = ev.currentTarget.dataset.region;
      const level = parseInt(ev.currentTarget.dataset.level);
      const transgressions = TransgressionTracker.getTransgressions();
      if (!transgressions[regionSlug]) transgressions[regionSlug] = { level: 0, loops: 0 };
      transgressions[regionSlug].level = level;
      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });

    // Add region button
    html.find('.add-region-btn').click(async () => {
      await TransgressionTracker.openRegionDialog(null);
    });

    // Edit region button (custom regions only)
    html.find('.edit-region-btn').click(async (ev) => {
      ev.stopPropagation();
      const slug = ev.currentTarget.dataset.region;
      await TransgressionTracker.openRegionDialog(slug);
    });

    // Delete region button (custom regions only)
    html.find('.delete-region-btn').click(async (ev) => {
      ev.stopPropagation();
      const slug = ev.currentTarget.dataset.region;
      const ALL = TransgressionTracker.getAllRegions();
      const name = ALL[slug]?.name || slug;
      const confirmed = await Dialog.confirm({
        title: 'Delete Region',
        content: `<p>Delete <strong>${name}</strong>? This will also clear its transgression progress.</p>`
      });
      if (!confirmed) return;
      const custom = TransgressionTracker.getCustomRegions();
      delete custom[slug];
      await TransgressionTracker.setCustomRegions(custom);
      const transgressions = TransgressionTracker.getTransgressions();
      delete transgressions[slug];
      await TransgressionTracker.setTransgressions(transgressions);
      this.render();
    });
  }
}

/**
 * Register settings for transgression tracking
 */
export function registerTransgressionSettings() {
  // Transgression data storage
  game.settings.register('darkest-system', 'transgressions', {
    name: 'Transgression Data',
    hint: 'Stores transgression levels for each witch/region',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // Current region setting
  game.settings.register('darkest-system', 'currentRegion', {
    name: 'Current Region',
    hint: 'The region the party is currently in',
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  // Custom regions added by the GM
  game.settings.register('darkest-system', 'customRegions', {
    name: 'Custom Regions',
    hint: 'GM-created regions for the transgression tracker',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // House Actions data (Darkest House mode)
  game.settings.register('darkest-system', 'houseActions', {
    name: 'House Actions Data',
    hint: 'Stores the current house action level for Darkest House mode',
    scope: 'world',
    config: false,
    type: Object,
    default: { level: 0, loops: 0 }
  });
}
