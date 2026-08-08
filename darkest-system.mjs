/**
 * The Darkest System - A Foundry VTT Game System
 *
 * Based on "The Darkest System" rules from The Darkest Woods companion app.
 *
 * Core Mechanics:
 * - Everything has a Rating (1-10)
 * - Roll: 2d6 + Character Rating vs Target Number (7 + Task Rating)
 * - The Darkest Die: Extra d6 that triggers transgressions when highest
 * - Boons/Banes: Roll extra dice, keep highest/lowest 2
 * - Wounds give Banes
 * - Dooms are curses gained from calling upon the woods
 */

// Import modules
import { DARKEST } from './module/helpers/config.mjs';
import { DarkestActor } from './module/actor/actor.mjs';
import { DarkestActorSheet } from './module/actor/actor-sheet.mjs';
import { DarkestItem } from './module/item/item.mjs';
import { DarkestItemSheet } from './module/item/item-sheet.mjs';
import { registerDarkestRoll } from './module/dice/darkest-roll.mjs';
import { TransgressionTracker, registerTransgressionSettings } from './module/apps/transgression-tracker.mjs';
import { DoomTally, registerDoomTallySettings, registerDoomTallyHooks } from './module/apps/doom-tally.mjs';
import { NpcTracker, registerNpcTrackerSettings } from './module/apps/npc-tracker.mjs';
import { GmWhisperTool } from './module/apps/gm-whisper.mjs';
import {
  TravelClock,
  TravelTool,
  renderDial,
  registerTravelClockSettings,
  registerTravelClockHooks,
} from './module/apps/travel-clock.mjs';

/* ----------------------------------------
   Initialize System
---------------------------------------- */
Hooks.once('init', function() {
  console.log('The Darkest System | Initializing');

  // Register custom system settings on the game object
  game.darkestSystem = {
    DarkestActor,
    DarkestItem
  };

  // Add configuration to CONFIG
  CONFIG.DARKEST = DARKEST;

  // Define custom Document classes
  CONFIG.Actor.documentClass = DarkestActor;
  CONFIG.Item.documentClass = DarkestItem;

  // Register the custom roll class
  registerDarkestRoll();

  // Register sheet application classes
  Actors.unregisterSheet('core', ActorSheet);
  Actors.registerSheet('darkest-system', DarkestActorSheet, {
    makeDefault: true,
    label: 'DARKEST.SheetLabels.Actor'
  });

  Items.unregisterSheet('core', ItemSheet);
  Items.registerSheet('darkest-system', DarkestItemSheet, {
    makeDefault: true,
    label: 'DARKEST.SheetLabels.Item'
  });

  // Register Handlebars helpers
  _registerHandlebarsHelpers();

  // Register game mode and optional rule settings
  _registerGameSettings();

  // Register transgression settings
  registerTransgressionSettings();

  // Register doom tally settings
  registerDoomTallySettings();

  // Register NPC tracker settings
  registerNpcTrackerSettings();

  // Register travel clock settings
  registerTravelClockSettings();

  // Preload Handlebars templates
  return _preloadHandlebarsTemplates();
});

/* ----------------------------------------
   Game Settings
---------------------------------------- */
function _registerGameSettings() {
  game.settings.register('darkest-system', 'showDoomSkulls', {
    name: 'DARKEST.Settings.ShowDoomSkulls',
    hint: 'DARKEST.Settings.ShowDoomSkullsHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register('darkest-system', 'gameMode', {
    name: 'DARKEST.Settings.GameMode',
    hint: 'DARKEST.Settings.GameModeHint',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'darkest-woods': 'DARKEST.Settings.GameModeDarkestWoods',
      'darkest-house': 'DARKEST.Settings.GameModeDarkestHouse'
    },
    default: 'darkest-woods',
    onChange: () => {
      // Refresh any open transgression tracker when mode changes
      const tracker = Object.values(ui.windows).find(w => w.constructor.name === 'TransgressionTracker');
      if (tracker) tracker.render();
    }
  });

  game.settings.register('darkest-system', 'enableSpecialSuccess', {
    name: 'DARKEST.Settings.EnableSpecialSuccess',
    hint: 'DARKEST.Settings.EnableSpecialSuccessHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register('darkest-system', 'enablePartialSuccess', {
    name: 'DARKEST.Settings.EnablePartialSuccess',
    hint: 'DARKEST.Settings.EnablePartialSuccessHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });
}

/* ----------------------------------------
   Handlebars Helpers
---------------------------------------- */
function _registerHandlebarsHelpers() {
  // Equality check
  Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });

  // Not equal
  Handlebars.registerHelper('neq', function(a, b) {
    return a !== b;
  });

  // Greater than
  Handlebars.registerHelper('gt', function(a, b) {
    return a > b;
  });

  // Less than
  Handlebars.registerHelper('lt', function(a, b) {
    return a < b;
  });

  // Multiply
  Handlebars.registerHelper('multiply', function(a, b) {
    return a * b;
  });

  // Add
  Handlebars.registerHelper('add', function(a, b) {
    return a + b;
  });

  // Logical AND
  Handlebars.registerHelper('and', function(a, b) {
    return a && b;
  });

  // Logical OR
  Handlebars.registerHelper('or', function(a, b) {
    return a || b;
  });

  // Conditional class
  Handlebars.registerHelper('ifClass', function(condition, trueClass, falseClass) {
    return condition ? trueClass : (falseClass || '');
  });
}

/* ----------------------------------------
   Preload Handlebars Templates
---------------------------------------- */
async function _preloadHandlebarsTemplates() {
  const templatePaths = [
    // Actor sheets
    'systems/darkest-system/templates/actor/actor-character-sheet.hbs',
    'systems/darkest-system/templates/actor/actor-npc-sheet.hbs',


    // Item sheets
    'systems/darkest-system/templates/item/item-wound-sheet.hbs',
    'systems/darkest-system/templates/item/item-doom-sheet.hbs',
    'systems/darkest-system/templates/item/item-ability-sheet.hbs',
    'systems/darkest-system/templates/item/item-equipment-sheet.hbs',

    // Chat
    'systems/darkest-system/templates/chat/roll-result.hbs',

    // Apps
    'systems/darkest-system/templates/apps/transgression-tracker.hbs',
    'systems/darkest-system/templates/apps/doom-tally.hbs',
    'systems/darkest-system/templates/apps/npc-tracker.hbs',
    'systems/darkest-system/templates/apps/travel-tool.hbs',

    // Dialogs - NOT preloaded due to inline scripts
    // They are rendered dynamically via renderTemplate() instead
    'systems/darkest-system/templates/dialog/damage-dialog.hbs'
  ];

  return loadTemplates(templatePaths);
}

/* ----------------------------------------
   Ready Hook
---------------------------------------- */
Hooks.once('ready', function() {
  console.log('The Darkest System | Ready');

  // Store the transgression tracker instance
  game.darkestSystem.transgressionTracker = null;

  // Store the doom tally instance
  game.darkestSystem.doomTally = null;

  // Expose GM tools globally for macros
  game.darkestSystem.TransgressionTracker = TransgressionTracker;
  game.darkestSystem.DoomTally = DoomTally;
  game.darkestSystem.NpcTracker = NpcTracker;
  game.darkestSystem.TravelTool = TravelTool;
  game.darkestSystem.TravelClock = TravelClock;

  // Register doom tally hooks
  registerDoomTallyHooks();

  // Register travel clock hooks and draw the dial
  registerTravelClockHooks();
  renderDial();

  // Socket handler for GM actions (player-to-GM delegation)
  game.socket.on('system.darkest-system', (data) => {
    if (!data?.type) return;
    switch (data.type) {
      case 'applyWound':
        if (game.user.isGM) {
          const actor = game.actors.get(data.actorId);
          if (actor) actor.addWound(data.rating, data.woundType, data.description);
        }
        break;

      case 'applyDoom':
        if (game.user.isGM) {
          const actor = game.actors.get(data.actorId);
          if (actor) actor.addDoom(data.description, data.source);
        }
        break;

      case 'applyNpcDamage':
        if (game.user.isGM) {
          NpcTracker.applyDamage(data.woundRating);
        }
        break;

      case 'postGmWhisper':
        // A whispered ChatMessage is always visible to its own author, no
        // matter who's listed in `whisper` -- so if a PLAYER's client
        // creates a message whispered to the GM, that player still sees it
        // themselves. The message must actually be authored by a GM client
        // for the whisper to exclude the player as intended.
        if (game.user.isGM) {
          ChatMessage.create({
            content: data.content,
            whisper: game.users.filter(u => u.isGM).map(u => u.id),
            speaker: data.speaker
          });
        }
        break;

      case 'notifyDoomGained':
        // The Doom item itself was already created on the player's own
        // client (they own their actor) -- this only carries the GM-facing
        // notification, which a local-only Hooks.call could never deliver.
        if (game.user.isGM) {
          ui.notifications.info(`${data.actorName} gained a Doom from calling upon the woods!`);
        }
        break;

      case 'triggerTransgression':
        // Hooks.call() only fires locally on the client that calls it --
        // when a PLAYER rolls a transgression, darkestSystem.transgression
        // fires only on their own browser, so the GM's client never sees it
        // and incrementTransgression() never runs. Delegate to a GM client.
        if (game.user.isGM) {
          Hooks.callAll('darkestSystem.transgression');
        }
        break;

      case 'gmWhisperAlert':
        // A plain chat whisper is easy to miss in a busy log. Pop a
        // dismissible dialog on ONLY the targeted player's own client --
        // every client receives this broadcast, so check it's actually
        // addressed to this user before doing anything.
        if (data.userId === game.user.id) {
          new Dialog({
            title: 'The GM whispers to you...',
            content: `<div class="darkest-dialog darkest-gm-whisper-popup"><i class="fas fa-eye"></i><p>${data.content}</p></div>`,
            buttons: {
              ok: { icon: '<i class="fas fa-check"></i>', label: 'Understood' }
            },
            default: 'ok'
          }).render(true);
          AudioHelper.play({ src: 'sounds/lock.wav', volume: 0.8, loop: false }, false);
        }
        break;
    }
  });
});

/* ----------------------------------------
   Scene Controls — GM Tools (v13 API)
---------------------------------------- */
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const tokenTools = controls.tokens?.tools;
  if (!tokenTools) return;

  const toolCount = Object.keys(tokenTools).length;

  tokenTools.transgressionTracker = {
    name: 'transgressionTracker',
    title: 'Transgression Tracker',
    icon: 'fa-solid fa-skull',
    order: toolCount,
    button: true,
    visible: true,
    onChange: () => {
      const existing = Object.values(ui.windows).find(w => w.constructor.name === 'TransgressionTracker');
      if (existing) existing.bringToTop();
      else new TransgressionTracker().render(true);
    }
  };

  tokenTools.npcTracker = {
    name: 'npcTracker',
    title: 'NPC Damage Tracker',
    icon: 'fa-solid fa-heart-crack',
    order: toolCount + 1,
    button: true,
    visible: true,
    onChange: () => {
      const existing = Object.values(ui.windows).find(w => w.constructor.name === 'NpcTracker');
      if (existing) existing.bringToTop();
      else new NpcTracker().render(true);
    }
  };

  tokenTools.gmWhisper = {
    name: 'gmWhisper',
    title: 'Whisper to Player',
    icon: 'fa-solid fa-user-secret',
    order: toolCount + 2,
    button: true,
    visible: true,
    onChange: () => {
      const existing = Object.values(ui.windows).find(w => w.constructor.name === 'GmWhisperTool');
      if (existing) existing.bringToTop();
      else new GmWhisperTool().render(true);
    }
  };

  tokenTools.travelTool = {
    name: 'travelTool',
    title: 'Travel & Time',
    icon: 'fa-solid fa-hourglass-half',
    order: toolCount + 3,
    button: true,
    visible: true,
    onChange: () => {
      const existing = Object.values(ui.windows).find(w => w.constructor.name === 'TravelTool');
      if (existing) existing.bringToTop();
      else new TravelTool().render(true);
    }
  };
});

/* ----------------------------------------
   Scene Controls — Doom Tally (everyone)
---------------------------------------- */
// The Doom Tally is deliberately visible to players (it shows the party's
// shared, mounting Doom count -- the rules want that dread to be public and
// palpable), so it gets its own hook rather than living in the GM-only block
// above. GM-only adjustment buttons are gated inside the app's own template.
Hooks.on('getSceneControlButtons', (controls) => {
  const tokenTools = controls.tokens?.tools;
  if (!tokenTools) return;

  tokenTools.doomTally = {
    name: 'doomTally',
    title: 'Doom Tally',
    icon: 'fa-solid fa-skull-crossbones',
    order: Object.keys(tokenTools).length,
    button: true,
    visible: true,
    onChange: () => {
      const existing = Object.values(ui.windows).find(w => w.constructor.name === 'DoomTally');
      if (existing) existing.bringToTop();
      else new DoomTally().render(true);
    }
  };
});

/* ----------------------------------------
   Custom Hooks
---------------------------------------- */

// Hook for when a transgression occurs
Hooks.on('darkestSystem.transgression', async (actor, roll) => {
  // GM only - increment transgression for current region
  if (game.user.isGM) {
    const currentRegion = TransgressionTracker.getCurrentRegion();
    if (currentRegion) {
      const result = await TransgressionTracker.incrementTransgression(currentRegion);
      if (result) {
        ui.notifications.info(`Transgression tracked for ${currentRegion}. Level: ${result.level}, Loops: ${result.loops}`);
      }
    } else {
      ui.notifications.warn('Transgression occurred but no region is set! Open the Transgression Tracker to select a region.');
    }
  }
});

// Hook for when a Deal Damage roll produces a wound — auto-apply to active NPC in tracker.
// The NPC tracker's data lives in a world-scoped setting, and players usually
// can't write those directly, so this delegates to the GM's client over the
// socket -- same player-to-GM pattern as applyWound/applyDoom below. Applying
// directly here would silently do nothing on a player's own client and never
// reach the GM's tracker at all.
Hooks.on('darkestSystem.damageDealt', async (roll) => {
  if (game.user.isGM) {
    await NpcTracker.applyDamage(roll.woundRating);
  } else {
    game.socket.emit('system.darkest-system', {
      type: 'applyNpcDamage',
      woundRating: roll.woundRating,
    });
  }
});

/* ----------------------------------------
   Auto-clear unconscious/catatonic when the relevant wound type is fully
   healed. rollResistUnconscious()/rollDeathCheck() only ever set these flags
   true; nothing cleared them, so a character stayed flagged forever even
   after healing. Can't do this inside Actor#prepareDerivedData() (synchronous,
   and calling update() there causes recursive update cycles) -- an
   updateItem hook, firing after a wound is actually marked healed, is the
   correct place.
---------------------------------------- */
Hooks.on('updateItem', async (item, changes, options, userId) => {
  if (item.type !== 'wound') return;
  if (!foundry.utils.hasProperty(changes, 'system.healed')) return;

  const actor = item.parent;
  if (!actor || actor.documentName !== 'Actor') return;

  // Only one client should issue the follow-up update; the GM (if present)
  // is the natural owner, otherwise let whoever made this change do it.
  if (game.users.some(u => u.isGM && u.active) && !game.user.isGM) return;

  const hasPhysicalWound = actor.items.some(i => i.type === 'wound' && i.system.type === 'physical' && !i.system.healed);
  const hasMentalWound = actor.items.some(i => i.type === 'wound' && i.system.type === 'mental' && !i.system.healed);

  const updateData = {};
  if (actor.system.unconscious && !hasPhysicalWound) updateData['system.unconscious'] = false;
  if (actor.system.catatonic && !hasMentalWound) updateData['system.catatonic'] = false;

  if (Object.keys(updateData).length) {
    await actor.update(updateData);
  }
});

/* ----------------------------------------
   Feature B — Scene Region Auto-Detection
---------------------------------------- */
Hooks.on('canvasReady', async () => {
  if (!game.user.isGM) return;
  const scene = game.scenes.active;
  if (!scene) return;

  const ALL = TransgressionTracker.getAllRegions();
  if (!ALL || Object.keys(ALL).length === 0) return;

  // Check scene flag first, then name match
  const flagRegion = scene.getFlag('darkest-system', 'region');
  let matchedSlug = flagRegion && ALL[flagRegion] ? flagRegion : null;

  if (!matchedSlug) {
    const sceneName = scene.name.toLowerCase();
    for (const [slug, data] of Object.entries(ALL)) {
      if (data.name && sceneName.includes(data.name.toLowerCase())) {
        matchedSlug = slug;
        break;
      }
    }
  }

  if (!matchedSlug) return;

  const currentRegion = TransgressionTracker.getCurrentRegion();
  if (currentRegion === matchedSlug) return; // already set

  const regionName = ALL[matchedSlug]?.name || matchedSlug;
  new Dialog({
    title: 'Region Detected',
    content: `<p>The active scene matches region <strong>${regionName}</strong>. Update the transgression tracker?</p>`,
    buttons: {
      accept: {
        icon: '<i class="fas fa-check"></i>',
        label: 'Update',
        callback: async () => {
          await TransgressionTracker.setCurrentRegion(matchedSlug);
          const tracker = Object.values(ui.windows).find(w => w.constructor.name === 'TransgressionTracker');
          if (tracker) tracker.render();
          ui.notifications.info(`Transgression tracker set to region: ${regionName}`);
        }
      },
      dismiss: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Dismiss'
      }
    },
    default: 'accept'
  }, { width: 360 }).render(true);
});

/* ----------------------------------------
   Feature D — Player List Doom Overlay
---------------------------------------- */
Hooks.on('renderPlayerList', (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  root?.querySelectorAll('li.player').forEach(li => {
    const userId = li.dataset.userId;
    if (!userId) return;
    const user = game.users.get(userId);
    if (!user?.character) return;
    const actor = user.character;
    if (actor.type !== 'character') return;
    const doomCount = actor.items.filter(i => i.type === 'doom' && !i.system.resolved).length;
    if (doomCount <= 0) return;

    const skulls = Array.from({ length: doomCount }, () =>
      '<i class="fas fa-skull doom-pip"></i>'
    ).join('');
    const span = document.createElement('span');
    span.className = 'doom-pip-list';
    span.innerHTML = skulls;
    span.title = `${doomCount} active doom${doomCount !== 1 ? 's' : ''}`;
    li.querySelector('.player-name')?.after(span);
  });
});


/* ----------------------------------------
   Feature E — Doom Skulls on Chat Messages
---------------------------------------- */
Hooks.on('renderChatMessage', (message, html) => {
  if (!game.settings.get('darkest-system', 'showDoomSkulls')) return;

  // Find the actor who spoke
  const speaker = message.speaker;
  if (!speaker?.actor) return;
  const actor = game.actors.get(speaker.actor);
  if (!actor || actor.type !== 'character' || !actor.hasPlayerOwner) return;

  const doomCount = actor.items.filter(i => i.type === 'doom' && !i.system.resolved).length;
  if (doomCount <= 0) return;

  const skulls = Array.from({ length: doomCount }, () =>
    '<i class="fas fa-skull"></i>'
  ).join('');
  const span = document.createElement('span');
  span.className = 'chat-doom-skulls';
  span.innerHTML = skulls;
  span.title = `${doomCount} active doom${doomCount !== 1 ? 's' : ''}`;

  const root = html instanceof HTMLElement ? html : html[0];
  const senderEl = root?.querySelector('.message-sender');
  if (senderEl) senderEl.appendChild(span);
});

// Hook for when a doom is gained
Hooks.on('darkestSystem.doomGained', async (actor, roll) => {
  if (game.user.isGM) {
    ui.notifications.info(`${actor.name} gained a Doom from calling upon the woods!`);
  }

  // Automatically create a doom item on the actor
  await actor.addDoom(
    'A nameless dread settles upon you...',
    'Called Upon the Woods'
  );
});

/* ----------------------------------------
   Chat Button Handlers
---------------------------------------- */

// Handle "Resist Unconsciousness / Catatonia" button clicks in chat
$(document).on('click', '.resist-unconscious-btn', async function(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  const actorId = btn.dataset.actorId;
  const woundRating = parseInt(btn.dataset.woundRating) || 0;
  const woundType = btn.dataset.woundType || 'physical';

  const actor = game.actors.get(actorId);
  if (!actor) {
    ui.notifications.warn('Cannot find actor for this roll.');
    return;
  }

  // Only the actor's owner or GM may roll
  if (!actor.isOwner) {
    ui.notifications.warn(`Only ${actor.name}'s player can make this roll.`);
    return;
  }

  await actor.rollResistUnconscious(woundRating, woundType);
});

