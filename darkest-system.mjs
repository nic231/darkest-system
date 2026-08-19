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
import { registerDarkestRoll, playDarkestDiceSequence } from './module/dice/darkest-roll.mjs';
import { TransgressionTracker, registerTransgressionSettings } from './module/apps/transgression-tracker.mjs';
import { DoomTally, registerDoomTallySettings, registerDoomTallyHooks } from './module/apps/doom-tally.mjs';
import { PartyTokens, registerPartyTokenSettings, registerPartyTokenHooks } from './module/apps/party-tokens.mjs';
import { NpcTracker, registerNpcTrackerSettings } from './module/apps/npc-tracker.mjs';
import { GmWhisperTool } from './module/apps/gm-whisper.mjs';
import {
  TravelClock,
  TravelTool,
  renderDial,
  registerTravelClockSettings,
  registerTravelClockHooks,
  showTransitionVeil,
  setTravelBed,
} from './module/apps/travel-clock.mjs';
import { SessionLog, registerSessionLog } from './module/apps/session-log.mjs';
import { DarkestAudio, registerAudioSettings } from './module/apps/audio.mjs';
import { isPrimaryGM } from './module/helpers/gm.mjs';
import {
  SceneDarkness,
  registerSceneDarknessSettings,
  registerSceneDarknessHooks,
} from './module/apps/scene-darkness.mjs';
import { TravelHistory, registerTravelHistorySettings } from './module/apps/travel-history.mjs';
import { TravelGroups, registerTravelGroupSettings } from './module/apps/travel-groups.mjs';
import { RouteMap, RouteMapApp, registerRouteMapSettings } from './module/apps/route-map.mjs';
import { CreditsApp } from './module/apps/credits.mjs';
import {
  SceneAmbience,
  registerSceneAmbienceSettings,
  registerSceneAmbienceHooks,
} from './module/apps/scene-ambience.mjs';
import {
  TransgressionFx,
  registerTransgressionFxSettings,
} from './module/apps/transgression-fx.mjs';

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

  registerPartyTokenSettings();

  // Register NPC tracker settings
  registerNpcTrackerSettings();

  registerSessionLog();

  registerAudioSettings();

  registerSceneDarknessSettings();

  registerSceneAmbienceSettings();

  registerTransgressionFxSettings();

  registerTravelHistorySettings();

  registerTravelGroupSettings();

  registerRouteMapSettings();

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
    'systems/darkest-system/templates/item/item-effect-sheet.hbs',

    // Chat
    'systems/darkest-system/templates/chat/roll-result.hbs',

    // Apps
    'systems/darkest-system/templates/apps/transgression-tracker.hbs',
    'systems/darkest-system/templates/apps/doom-tally.hbs',
    'systems/darkest-system/templates/apps/npc-tracker.hbs',
    'systems/darkest-system/templates/apps/travel-tool.hbs',
    'systems/darkest-system/templates/apps/session-log.hbs',
    'systems/darkest-system/templates/apps/route-map.hbs',
    'systems/darkest-system/templates/apps/credits.hbs',

    // Dialogs are deliberately NOT listed here. They carry inline scripts and
    // are rendered on demand via renderTemplate() instead.
  ];

  return loadTemplates(templatePaths);
}

/* ----------------------------------------
   Ready Hook
---------------------------------------- */
Hooks.once('ready', function() {
  console.log('The Darkest System | Ready');

  // NB: there are deliberately no stored window instances here. Two used to
  // sit at this spot (transgressionTracker, doomTally), both only ever
  // assigned null -- so DoomTally.refresh() silently did nothing. Windows are
  // found through ui.windows when they need re-rendering.

  // Expose GM tools globally for macros
  game.darkestSystem.TransgressionTracker = TransgressionTracker;
  game.darkestSystem.DoomTally = DoomTally;
  // Exposed so the counts can be set from a macro as well as the badges:
  //   game.darkestSystem.PartyTokens.setWoodfolk(3)
  //   game.darkestSystem.PartyTokens.toggleBirdsong('grackle', true)
  game.darkestSystem.PartyTokens = PartyTokens;
  game.darkestSystem.NpcTracker = NpcTracker;
  game.darkestSystem.SessionLog = SessionLog;
  // Exposed so a GM can audition the escalation without provoking the woods:
  //   game.darkestSystem.TransgressionFx.play('the-lost', 10)
  game.darkestSystem.TransgressionFx = TransgressionFx;
  game.darkestSystem.TravelTool = TravelTool;
  game.darkestSystem.TravelClock = TravelClock;
  // Ambience.preview([ids]) auditions an assignment from a macro before
  // committing it to the markdown.
  game.darkestSystem.Ambience = SceneAmbience;
  game.darkestSystem.TravelGroups = TravelGroups;
  game.darkestSystem.RouteMap = RouteMap;
  game.darkestSystem.RouteMapApp = RouteMapApp;
  // game.darkestSystem.CreditsApp -- open with:
  //   new game.darkestSystem.CreditsApp().render(true)
  game.darkestSystem.CreditsApp = CreditsApp;

  // Register doom tally hooks
  registerDoomTallyHooks();

  // The wood folk / birdsong stack sits on top of the doom badge and measures
  // it, so it is registered AFTER -- its deferred first render then finds a
  // badge that has already been positioned.
  registerPartyTokenHooks();

  // Register travel clock hooks and draw the dial
  registerTravelClockHooks();
  registerSceneDarknessHooks();
  registerSceneAmbienceHooks();

  // Sweep expired boons/banes when time passes. Effects are filtered out of
  // the totals the moment they lapse, so this is only tidying the sheet --
  // but a stale row the GM has to mentally ignore defeats the point.
  Hooks.on('darkestSystem.clockChanged', async () => {
    if (!isPrimaryGM()) return;
    for (const actor of game.actors.filter(a => a.type === 'character')) {
      if (actor.items.some(i => i.type === 'effect')) await actor.sweepExpiredEffects();
    }
  });
  renderDial();

  // Socket handler for GM actions (player-to-GM delegation).
  //
  // Delegated actions must run on exactly ONE client. Gating on
  // `game.user.isGM` is not enough -- with a GM and an assistant GM both
  // connected, that is true on both, so a single player's roll would
  // advance the transgression track twice, post two stir messages, and
  // double-count in the session log. Elect the lowest-id active GM instead;
  // every client computes the same answer from the same user list.
  game.socket.on('system.darkest-system', (data) => {
    if (!data?.type) return;
    switch (data.type) {
      // There were 'applyWound' and 'applyDoom' cases here. Nothing ever
      // emitted them: wounds and dooms are applied from chat-card buttons,
      // which only a GM sees, so the player-to-GM hop they existed for never
      // happens. They are gone rather than kept "just in case" -- a socket
      // case with no emitter is an invitation to send an unvalidated message
      // that writes to any actor.
      case 'applyNpcDamage':
        if (isPrimaryGM()) {
          NpcTracker.applyDamage(data.woundRating);
        }
        break;

      case 'darkestDiceAnimation': {
        // The roller suppressed Dice So Nice's automatic animation (so the
        // main dice land before the Darkest Die rather than alongside it).
        // That `skip` flag rides along with the ChatMessage to every client,
        // so observers get no dice unless we replay the sequence for them.
        if (data.userId === game.user.id) break;  // roller already played it

        // A whispered roll must only animate for its intended recipients.
        if (Array.isArray(data.whisper) && data.whisper.length
            && !data.whisper.includes(game.user.id) && !game.user.isGM) break;

        const mainRoll = Roll.fromData(data.mainRoll);
        const darkestRoll = data.darkestRoll ? Roll.fromData(data.darkestRoll) : null;
        playDarkestDiceSequence({
          mainRoll,
          darkestRoll,
          user: game.users.get(data.userId) ?? game.user,
          speaker: data.speaker,
          whisper: data.whisper,
        });
        break;
      }

      case 'travelTransition':
        // Fade every client's screen for a travel transition. Players see a
        // hard canvas swap when scene.activate() reaches them; this covers it.
        // The audio payload starts the ambience bed on each client locally,
        // so it begins in step with the fade rather than only for the GM.
        // opts carries the fade duration, which scales with journey length --
        // without it every client would fall back to the stylesheet default
        // and drift out of step with the GM.
        showTransitionVeil(data.phase, data.audio ?? null, data.opts ?? {});
        break;

      case 'routeReplay':
        // Every client animates the SAME plan from a shared start time, so
        // they stay in step without a frame ever crossing the wire -- the
        // pattern travelTransition already uses.
        RouteMapApp.playShared({
          plan: data.plan,
          mapSlug: data.mapSlug,
          startedAt: data.startedAt,
        });
        break;

      case 'travelBed':
        // The looping bed on its own, for a hold with transitions switched
        // off. null stops it.
        setTravelBed(data.audio ?? null);
        break;

      case 'travelHoldChanged':
        // A journey paused for roleplay, or released. Re-render any open
        // travel tool so its banner matches, on every GM's client.
        TravelClock.refresh();
        break;

      case 'playBirdsong':
        // Diegetic -- the party is listening to the recording, so it plays
        // for everyone rather than just whoever pressed the button.
        DarkestAudio.playBirdsong(data.bird);
        break;

      case 'logRoll':
        // Players can't write the GM-scoped session log, so their rolls
        // arrive here for a GM client to record. The damping cooldown counts
        // rolls, and this is where a player's roll becomes visible to the
        // single client that owns that counter.
        if (isPrimaryGM()) {
          SessionLog.recordRoll(data.entry);
          TransgressionTracker.noteRoll();
        }
        break;

      case 'postGmWhisper':
        // A whispered ChatMessage is always visible to its own author, no
        // matter who's listed in `whisper` -- so if a PLAYER's client
        // creates a message whispered to the GM, that player still sees it
        // themselves. The message must actually be authored by a GM client
        // for the whisper to exclude the player as intended.
        // One GM authors it, or two GMs produce two identical whispers.
        if (isPrimaryGM()) {
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
        // Exactly one GM, or the track advances once per connected GM --
        // two stir messages and two levels from a single player's roll.
        if (isPrimaryGM()) {
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
          // Through DarkestAudio for the guarded AudioHelper lookup: the bare
          // global this used to call was removed in v14, so every whisper
          // threw on the player's client and no sound played.
          DarkestAudio.playAlert();
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

  tokenTools.sessionLog = {
    name: 'sessionLog',
    title: 'Session Log',
    icon: 'fa-solid fa-scroll',
    order: toolCount + 4,
    button: true,
    visible: true,
    onChange: () => {
      const existing = Object.values(ui.windows).find(w => w.constructor.name === 'SessionLog');
      if (existing) existing.bringToTop();
      else new SessionLog().render(true);
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
      // No toast when the GM is being asked: the whispered prompt IS the
      // notification, and "Transgression tracked. Level: 3" would be a lie
      // told over the top of a question that hasn't been answered yet. (It
      // was already misleading for a damped trigger, which returns the level
      // it was held at -- so the toast now only speaks when the track moved.)
      const asking = TransgressionTracker.confirmEnabled();
      const before = TransgressionTracker.getTransgressions()[currentRegion]?.level ?? 0;
      const result = await TransgressionTracker.incrementTransgression(currentRegion);
      if (result && !asking && result.level !== before) {
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
// socket -- the same player-to-GM pattern the roll code uses. Applying
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

  // Exactly one client issues the follow-up update.
  //
  // The GM is the natural owner when one is connected -- the PRIMARY GM
  // specifically, or a GM plus an assistant would both write. With no GM at
  // all it falls to whoever actually made the change: the old check let
  // EVERY connected player through in that case, and the ones who don't own
  // the actor hit permission errors on every heal.
  const gmOnline = game.users.some(u => u.isGM && u.active);
  if (gmOnline ? !isPrimaryGM() : userId !== game.user.id) return;

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
   Travel hold — strip the GM's buttons for players
---------------------------------------- */
// The Arrive / Turn back buttons are the GM's call alone. The handlers below
// check isGM anyway, but a player shouldn't be looking at a button that does
// nothing when they press it.
Hooks.on('renderChatMessage', (message, html) => {
  if (game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  root?.querySelector('.travel-hold-actions')?.remove();
});

/* ----------------------------------------
   Chat Button Handlers
---------------------------------------- */

// Finish or call off a journey paused for roleplay. Both re-read the hold
// from world settings, so a button on a stale card from an earlier journey
// simply reports that nobody is on the road.
//
// Not gated on isPrimaryGM: an assistant GM should be able to press Arrive.
// Two GMs pressing it at the same instant would double-fade, which is a race
// not worth more machinery than the null check inside.
// Backtracking: apply the transgression, or let it pass. The players have
// already seen the woods take notice either way -- these only decide whether
// the track advances, so "let it pass" simply retires the prompt.
$(document).on('click', '.backtrack-apply', async function(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const btn = event.currentTarget;
  const region = btn.dataset.region || TransgressionTracker.getCurrentRegion();
  if (!region) {
    ui.notifications.warn('No region set — open the Transgression Tracker and pick one.');
    return;
  }
  // bypassDamping: this is one deliberate press, not a flurry of dice.
  await TransgressionTracker.incrementTransgression(region, { bypassDamping: true });
  $(btn).closest('.backtrack-actions').html('<em class="backtrack-done">Transgression applied.</em>');
});

// The roll-driven confirm prompt ("Ask before each transgression"). Distinct
// from .backtrack-apply above because this one must NOT bypass damping and
// must NOT re-post the public message:
//
//   - damping still applies. The two settings compose: this decides whether
//     the woods advance, pacing decides whether they can. Bypassing here
//     would silently override a pacing rule the GM also chose.
//   - silent, because the prompt already stirred the woods when the die
//     landed. A second line on Apply would appear only for applied
//     transgressions -- the exact tell this feature exists to prevent.
//   - skipConfirm, or applying would prompt again, forever.
$(document).on('click', '.transgression-apply', async function(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const btn = event.currentTarget;
  const region = btn.dataset.region || TransgressionTracker.getCurrentRegion();
  if (!region) {
    ui.notifications.warn('No region set — open the Transgression Tracker and pick one.');
    return;
  }
  // Disable immediately: ChatMessage.create() round-trips, and a double-click
  // in that window would advance the track twice for one Darkest Die.
  btn.disabled = true;
  const result = await TransgressionTracker.incrementTransgression(region, {
    skipConfirm: true, silent: true,
  });
  const held = result && result.level != null
    ? ` <span class="damped-reason">(track at ${result.level})</span>`
    : '';
  $(btn).closest('.backtrack-actions')
    .html(`<em class="backtrack-done">Transgression applied.${held}</em>`);
});

$(document).on('click', '.backtrack-dismiss', function(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  $(event.currentTarget).closest('.backtrack-actions')
    .html('<em class="backtrack-done">Let pass.</em>');
});

$(document).on('click', '.travel-arrive-btn', async function(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  await TravelTool.arriveFromHold();
});

$(document).on('click', '.travel-abandon-btn', async function(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  await TravelTool.abandonHold();
});

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

