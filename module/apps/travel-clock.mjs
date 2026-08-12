/**
 * Travel & Time Tracker
 *
 * Two pieces that share one world clock:
 *  - TravelTool: a GM window for advancing time by travelling a route.
 *    Routes come from the companion module (which owns the book's
 *    distances) via the darkestSystem.registerTravelRoutes hook, so the
 *    system works standalone with manual entry only.
 *  - The dial overlay: a small always-visible sun/moon readout everyone
 *    sees, rendered by renderDial() into Foundry's UI.
 *
 * The clock announces time passing and day rollovers in chat, but never
 * auto-applies mechanical consequences (Winter's Mercy exposure wounds,
 * 24-hour rest locks, per-day ability refreshes). Those stay GM calls --
 * the dial tells you when, it doesn't decide for you.
 */

import { SessionLog } from './session-log.mjs';
import { DarkestAudio } from './audio.mjs';
// Circular by design: scene-ambience needs the clock to decide which layers
// are audible. Safe because neither side touches the other during module
// evaluation -- only inside functions, long after both have loaded.
import { SceneAmbience } from './scene-ambience.mjs';

const SETTING_CLOCK = 'travelClock';
const SETTING_BIRDSONGS = 'knownBirdsongs';
const SETTING_ARRIVAL_TEXT = 'showArrivalText';
const SETTING_TRANSITION_MS = 'transitionDelayMs';
const SETTING_TRANSITION_MAX_MS = 'transitionDelayMaxMs';
const SETTING_TRAVEL_SCENE = 'travelSceneUuid';
const SETTING_HOLD = 'travelHold';

// Journey length at which the transition reaches its full duration. Past a
// full day on the move, "longer" stops meaning anything to the fade.
const TRANSITION_FULL_MINUTES = 480;

// Travel routes injected by the darkest-woods module. Empty without it.
export let TRAVEL_ROUTES = [];

// Per-location arrival lines, also from the content module. Empty without it,
// in which case arrivals fall back to REGION_ARRIVAL.
export let ARRIVAL_LINES = {};

Hooks.once('darkestSystem.registerTravelRoutes', (data) => {
  if (Array.isArray(data?.routes)) TRAVEL_ROUTES = data.routes;
  if (data?.arrivalLines) ARRIVAL_LINES = data.arrivalLines;
});

// The birds whose songs unlock secret trails. One route in the book is a
// birdsong path without a named bird, hence the catch-all.
export const BIRDSONGS = [
  { key: 'thrush', label: 'Wood Thrush' },
  { key: 'cardinal', label: 'Cardinal' },
  { key: 'grackle', label: 'Grackle' },
  { key: 'dove', label: 'Mourning Dove' },
  { key: 'warbler', label: 'Pine Warbler' },
  { key: 'nightingale', label: 'Nightingale' },
  { key: 'unnamed', label: 'Unnamed birdsong' },
];

// Birdsong playback was tried once against the book's own audio and removed:
// those files are full location recordings ("The Path from the Elder Tree"
// cassette happens to contain a Pine Warbler), so cueing a birdsong dumped a
// whole tape into the scene. It is back now on a different footing -- it
// plays only GM-supplied single-bird clips, dropped into
// extracted_content/audio/ as birdsong-<bird>.ogg, and the button is absent
// unless such a clip exists. The book's location audio is still left alone,
// for the GM to share when the party finds the recording.

// Travel speed in km/h. Only the travel time changes with pace -- pace
// deliberately carries no other mechanical effect (not a published rule).
//
// Driving is a separate mode rather than another walking pace. It matters
// on The Road, which is a real paved road with a working car on it, and
// nowhere else -- you cannot drive a forest trail. The speed is
// deliberately modest: cracked asphalt in permanent darkness, with no
// reason to hurry toward anything out here.
const PACE_SPEED = {
  slow: 3,
  normal: 4,
  fast: 5,
  boat: 5,
  drive: 50,
};

const PACE_LABEL = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
  boat: 'By pirogue',
  drive: 'Driving',
};

// Only these regions have anything a vehicle can use.
const DRIVABLE_REGIONS = new Set(['the-road']);

// Regions with pirogues moored and enough water to float one. The Dismal's
// residents keep flat-bottomed swamp boats at the pier in a Town Called
// Dismal; the Flood has a raft by the Bosque.
const BOATABLE_REGIONS = new Set(['the-dismal', 'a-town-called-dismal', 'the-flood']);

/** Whether a route can be driven -- paved road only. */
function isDrivable(route) {
  return /\broad\b/i.test(route?.label || '');
}

/**
 * Whether a route is water a pirogue can actually be poled along.
 *
 * The book marks these explicitly: "Flooded Trail", "Waterway", and paths
 * described as covered in a foot or two of water. A dry track through the
 * swamp is still a dry track -- you'd be carrying the boat.
 */
function isNavigable(route) {
  return /\b(waterway|flooded|water|bayou|channel|creek)\b/i.test(route?.label || '');
}

/**
 * On foot, standing water halves your speed -- the book is explicit that
 * these paths are walked "at half speed". A pirogue removes that penalty
 * and is a touch faster besides ("normal walking speed -- or even a bit
 * faster"), which is why `boat` above sits at 5 km/h rather than 4.
 *
 * This applies to the WALKING paces only; `boat` is already the unpenalised
 * speed and `drive` never meets a flooded trail.
 */
function wadingPenalty(route, pace) {
  const onFoot = pace === 'slow' || pace === 'normal' || pace === 'fast';
  return (onFoot && isNavigable(route)) ? 0.5 : 1;
}

// Regions whose time of day never changes, regardless of the world clock.
// "The Road: Paved road with faded yellow stripe. Night always."
const FIXED_TIME_REGIONS = {
  'the-road': { phase: 'night', label: 'Endless Night' },
};

/**
 * Region-specific travel flavour, added at random to the public travel
 * message.
 *
 * These describe CONDITIONS ONLY -- terrain, weather, temperature, light,
 * smell, footing. Nothing here may imply an event, a presence, or
 * anything uncanny: no "something moves", no tracks that stop, no
 * birdsong in the wrong place. Those beats belong to the GM, and a random
 * line stealing one undercuts it. If a line could make a player ask
 * "wait, what was that?", it does not belong in this table.
 *
 * Drawn from each region's stated conditions: The Lost is temperate and
 * rainy with no wind, The Dismal is a humid swamp, Ravages is an endless
 * fire, The Keepers is cold pine mountains, The Flood is constant rain,
 * Winter's Mercy is lethal cold, The Backwoods is dense and untravelled,
 * and The Road is a paved road under permanent night.
 */
const REGION_FLAVOUR = {
  'the-lost': [
    'The trees stand close, and the light through the canopy stays thin and grey.',
    'Rain comes and goes. There is no wind to carry it.',
    'Damp leaf litter deadens every footstep.',
    'The undergrowth is low and even, and the ground stays soft.',
    'The air is cool and still, and smells of wet bark.',
    'Roots cross the path often enough to keep everyone watching their feet.',
  ],
  'the-dismal': [
    'The muddy ground gives underfoot, and the air tastes of stagnant water.',
    'The stink of rot thickens, then thins, then thickens again.',
    'Insects hang in curtains over the wet ground.',
    'Standing water spreads across the low ground, black and unmoving.',
    'The humidity is total. Clothes cling and never dry.',
    'Moss and dead creeper hang from every branch within reach.',
  ],
  'the-ravages-of-flame': [
    'Ash falls steadily, settling in hair and collars.',
    'The heat never eases. Breathing is work.',
    'The smoke thins just enough to show more burning ahead.',
    'The ground is hot through boot leather, and blackened underfoot.',
    'Everything is the colour of char and old orange light.',
    'The air is dry enough to crack lips within the hour.',
  ],
  'the-keepers': [
    'The pines close overhead and the cold settles into everything.',
    'Loose stone shifts underfoot on the climb.',
    'The air is thin and sharp, and the going is slow.',
    'Mist pools in the hollows below, thick and unmoving.',
    'Fallen needles carpet the slope, slick where they are wet.',
    'The grade never quite levels out. The legs feel it.',
  ],
  'the-flood': [
    'The rain does not stop. It has not stopped for a long time.',
    'Water runs over the path ankle-deep, then knee-deep, then shallow again.',
    'Everything is soaked through and stays that way.',
    'The sound of running water comes from every direction at once.',
    'The ground beneath the water is soft, and the footing is uncertain.',
    'Debris collects against the trees where the current slows.',
  ],
  'winters-mercy': [
    'The cold gets into the joints and stays there.',
    'Fresh snow hides whatever the ground is really doing.',
    'Breath freezes in the air with every step.',
    'The white glare gives way to blue shadow, and the temperature drops again.',
    'Snow comes to mid-calf, and every stride costs.',
    'Ice sheathes the branches and cracks when they are touched.',
  ],
  'the-backwoods': [
    'The undergrowth thickens until the way ahead has to be forced.',
    'There is no trail here worth the name.',
    'The canopy closes overhead and takes what light there was.',
    'Thorns catch at sleeves and packs with every few steps.',
    'The ground is damp and cold, and stays that way.',
    'Deadfall crosses the route often enough to slow everything down.',
  ],
  'the-road': [
    'The faded yellow stripe runs on ahead into the dark.',
    'The road surface is cracked but level, and the walking is easy.',
    'The dark past the shoulder is complete, and stays that way.',
    'Weeds push up through the seams in the road surface.',
    'The night air is cool and dry, and the road holds the day it never had.',
    'The verge is gravel and dead grass, and the treeline sits well back.',
  ],
  'a-town-called-dismal': [
    'The boards give underfoot, and the walkway shifts with the weight of the party.',
    'Black water sits below the planking, still and close.',
    'The stilted houses lean over the walkway on both sides.',
    'The handrails are slick with damp and green with algae.',
    'The stink of the swamp comes up through the gaps in the boards.',
    'Every staircase down to the waterline ends at a jetty.',
  ],
  'the-ghost-caves': [
    'The rock closes in on both sides, and the passage narrows before it opens again.',
    'The air is cold and still, and carries the mineral smell of wet stone.',
    'Water drips somewhere ahead, steady and unhurried.',
    'The floor is uneven, and every step has to be placed.',
    'The dark beyond the light is complete.',
    'The ceiling drops low enough that the taller of the party stoop.',
  ],
  'the-rootrealm': [
    'The roots run on into the black in every direction, thick as houses.',
    'There is no ground here but root, and it curves away underfoot.',
    'The dark past the roots has no floor and no ceiling, and gives back nothing.',
    'The bark is damp and fibrous, and the footing is better than it looks.',
    'There is no wind and no sound of weather, only the creak of the roots taking weight.',
    'Distance is difficult to judge here. A root that looked close is not.',
  ],
  'the-temple-of-the-moon': [
    'Worked stone underfoot at last, level and dry.',
    'The corridors run straight, and the walls are dressed and even.',
    'The air is cool and dry, and smells faintly of cold ash.',
    'Sound carries here, and every footfall comes back off the stone.',
    'The passages are wide enough to walk abreast, and the ceilings are high.',
    'Pale light falls from openings somewhere above, thin but steady.',
  ],
};

/**
 * Where a party ends up, rather than the ground they crossed to get there.
 *
 * Shown on the arrival beat when the destination has no per-location line of
 * its own -- which is deliberate for the ~31 locations that ARE their own
 * reveal. Same conditions-only rule as REGION_FLAVOUR: these must never
 * pre-empt what the GM is about to describe.
 */
const REGION_ARRIVAL = {
  'the-lost':
    'The party stops. The air is temperate and completely still — not a breath of wind moves the canopy.',
  'the-dismal':
    'The party stops. Cypress and mangrove stand in black water on every side, and the insects find them immediately.',
  'a-town-called-dismal':
    'The party stops. Shacks stand on stilts above the water, and the boardwalks creak somewhere out of sight.',
  'the-ravages-of-flame':
    'The party stops. The air itself is hostile here — every breath catches and burns.',
  'the-keepers':
    'The party stops. The ground still slopes upward to the east, and the chill breeze has not let up.',
  'the-flood':
    'The party stops. Water stands over everything, and the rain keeps coming down.',
  'winters-mercy':
    'The party stops. Snow covers the ground and weighs the pine boughs, and the cold begins working inward at once.',
  'the-backwoods':
    'The party stops. The cold here is damp and gets into the clothes, and the trees stand too close together.',
  'the-road':
    "The party stops. The pale stripe painted down the road's middle runs off in both directions, and the trees stand back ten paces from its edge.",
  'the-ghost-caves':
    'The party stops. The rock presses close on every side, and the dark past the light gives back nothing.',
  'the-rootrealm':
    'The party stops. Roots run off into the black in every direction, and there is no ground here that is not root.',
  'the-temple-of-the-moon':
    'The party stops. Worked stone underfoot, dressed walls, and the sound of them carrying off down the corridors.',
};

// Travelling by pirogue changes what the party would actually notice. The
// walking lines above are written from inside the mud -- clothes clinging,
// footing uncertain, leeches on the legs -- none of which applies to
// someone sitting in a flat-bottomed boat. Conditions only, same as the
// rest of the table: nothing here implies an event.
const BOAT_FLAVOUR = {
  'the-dismal': [
    'The pole finds bottom easily, and the hull slides on between the cypress knees.',
    'Black water parts around the bow and closes again behind.',
    'Duckweed mats over the surface, and the boat leaves a green scar through it.',
    'Insects hang in curtains above the water, and the boat carries the party through them.',
    'Branches hang low enough that everyone learns to duck without looking.',
    'The stink of stagnant water rises where the pole disturbs the bottom.',
    'Cattails and tall grass close in on both sides, then open out again.',
    'The hull knocks against something submerged, and slides clear.',
  ],
  'a-town-called-dismal': [
    'The stilted houses pass by overhead, and the jetties drip.',
    'The pole finds bottom easily, and the hull slides on past the moorings.',
    'Black water laps at the pilings, and the boat rides its own wake.',
  ],
  'the-flood': [
    'The rain drums on the hull and pools in the bottom of the boat.',
    'The current pulls at the hull, and holding a line takes work.',
    'Floodwater carries the boat over what used to be a road.',
    'Debris knocks against the hull where the current slows.',
    'Treetops break the surface on both sides, and the boat threads between them.',
  ],
};

/**
 * Driving, which only happens on The Road.
 *
 * Written naive, like the arrival lines: these characters come out of the
 * Blades world and have no word for any of this. The car is "it", the
 * headlights are lamps, speed is measured against a horse. Nobody names the
 * machine, because nobody could.
 *
 * The Road is permanently night (see FIXED_TIME_REGIONS), so every line here
 * assumes darkness and headlights -- there is no daytime driving to write.
 */
const DRIVE_FLAVOUR = {
  'the-road': [
    'The lamps throw the yellow stripe out ahead, faster than any horse could run.',
    'The dark comes apart in front and closes up behind, and nothing else changes.',
    'Whatever moves it growls on under the floor, steady, and never tires.',
    'The seams in the road come up one after another, quicker than footsteps.',
    'Trees leap out of the black at the edge of the lamplight and are gone again.',
    'The road pours towards them and vanishes beneath, and the dark takes it back.',
    'It eats the miles the way nothing living does, and asks for nothing.',
    'Wind hammers past outside, though the air within stays oddly still.',
  ],
};

/**
 * The key artwork for the scene the party is standing in, if the content
 * module supplied one.
 *
 * Resolves through the location's journal entry rather than guessing a
 * filename from the slug: the naming is inconsistent enough that matching
 * by name only resolves about half of them, whereas the build script has
 * already wired an "Artwork" image page onto 91 of the 131 locations.
 */
export function currentLocationArt() {
  const slug = canvas?.scene?.getFlag('darkest-woods', 'locationSlug');
  if (!slug) return null;
  const entry = game.journal?.find(j => j.getFlag('darkest-woods', 'slug') === slug);
  if (!entry) return null;
  const page = entry.pages?.contents?.find(p => p.type === 'image' && p.src
    && /artwork/i.test(p.name || ''));
  if (!page?.src) return null;
  return { src: page.src, title: entry.name, uuid: page.uuid };
}

/**
 * How far a route actually is, for the session log's distance total.
 *
 * Most routes carry a real km figure. Thirty give a duration instead, and
 * the book quotes those as WALKING times -- so convert at walking speed,
 * the same assumption routeMinutes() already makes. Returns null where the
 * book gives neither ("a few steps", unmeasured trails): those are excluded
 * from the total and counted separately rather than guessed at.
 */
function routeKm(route) {
  if (!route) return null;
  if (typeof route.km === 'number') return route.km;
  if (route.hours) return route.hours * PACE_SPEED.normal;
  return null;
}

/**
 * A random atmospheric line for a region, or null if we have none.
 *
 * `boating` swaps in the on-the-water set where one exists -- a party in a
 * pirogue shouldn't be told the mud gives underfoot.
 */
// Last line shown per table, so the same one doesn't come up twice running.
// Keyed on the TABLE (region + walk/boat), not the region alone -- switching
// to a pirogue draws from a different list and shouldn't inherit its memory.
const _lastFlavour = new Map();

function regionFlavour(regionSlug, boating = false, driving = false) {
  const useBoat = boating && BOAT_FLAVOUR[regionSlug];
  const useDrive = !useBoat && driving && DRIVE_FLAVOUR[regionSlug];
  const mode = useBoat ? 'boat' : (useDrive ? 'drive' : 'walk');
  const lines = useBoat ? BOAT_FLAVOUR[regionSlug]
    : useDrive ? DRIVE_FLAVOUR[regionSlug]
      : REGION_FLAVOUR[regionSlug];
  if (!lines?.length) return null;
  if (lines.length === 1) return lines[0];

  // Uniform random repeats ~1 time in 6 with these table sizes, and an
  // immediate repeat reads as a bug rather than as atmosphere.
  const key = `${regionSlug}:${mode}`;
  const last = _lastFlavour.get(key);
  let i = Math.floor(Math.random() * lines.length);
  if (i === last) i = (i + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length;
  _lastFlavour.set(key, i);
  return lines[i];
}

/**
 * The arrival line for a destination: its own if the content module supplied
 * one, otherwise its region's. Returns null when neither exists, which is
 * how this degrades with no content module installed.
 */
function arrivalFlavour(locationSlug, regionSlug) {
  return ARRIVAL_LINES[locationSlug] || REGION_ARRIVAL[regionSlug] || null;
}

const VEIL_ID = 'darkest-transition-veil';
// The fade is only part of the pause: the screen has to actually SIT dark
// for a beat rather than spending the whole transition easing into it. The
// remainder is opaque, which also means the scene never swaps at the exact
// instant the veil finishes going black.
const VEIL_FADE_RATIO = 0.45;
const VEIL_FADE_MIN_MS = 400;
// A dropped 'arrive' message must never leave a player staring at a black
// screen, so the veil always removes itself regardless of what arrives.
// This is a MARGIN on top of the transition it covers, not a fixed ceiling:
// fades scale with journey length now, and a flat 5s would cut a long one
// short. It still covers both original failures -- a lost socket message and
// a hung scene.activate().
const VEIL_FAILSAFE_MARGIN_MS = 4000;
let _veilTimer = null;
// How long the current transition fades for, remembered so 'arrive' fades
// out as slowly as 'depart' faded in, and so the node is removed after the
// fade rather than during it.
let _veilFadeMs = 800;
// The ambience bed currently playing under a transition, so it can be faded
// out on arrival instead of running on over the new scene. Holds a PROMISE
// of a Sound -- see playLocal() in audio.mjs.
let _travelSound = null;

/**
 * Start or stop the looping travel bed on its own, with no veil.
 *
 * Only needed when transitions are switched off but a hold still wants its
 * ambience: the veil is what normally carries the sound, and a zero-length
 * one would fire its failsafe immediately and stop the bed again.
 *
 * Shares _travelSound with showTransitionVeil, so a later 'arrive' tears
 * this down exactly as it would a bed the veil had started.
 */
export function setTravelBed(audio = null) {
  if (audio) {
    if (_travelSound) return;   // already running; don't layer a second
    _travelSound = DarkestAudio.playTravelAmbience({ ...audio, loop: true });
    return;
  }

  if (!_travelSound) return;
  const pending = _travelSound;
  _travelSound = null;
  Promise.resolve(pending).then(snd => {
    if (!snd) return;
    if (typeof snd.fade === 'function') return snd.fade(0, { duration: 800 }).then(() => snd.stop?.());
    snd.stop?.();
  }).catch(() => { /* nothing worth breaking arrival over */ });
}

/**
 * Fade the screen out and back for a travel transition.
 *
 * Runs on every client via the travelTransition socket message. Deliberately
 * pointer-events: none, so even a stuck veil can't block input.
 *
 * @param {'depart'|'arrive'} phase
 * @param {object|null} audio        Cue for the ambient bed: {region, mode}.
 * @param {object} [opts]
 * @param {number} [opts.fadeMs]     How long the fade runs, scaled by journey length.
 * @param {number} [opts.coverMs]    How long the failsafe should wait before lifting itself.
 * @param {boolean} [opts.loop]      Loop the bed -- for the open-ended hold.
 * @param {boolean} [opts.keepAudio] Lift the veil but LEAVE the bed playing.
 */
export function showTransitionVeil(phase, audio = null, opts = {}) {
  const { fadeMs, coverMs, loop = false, keepAudio = false } = opts;

  if (phase === 'depart') {
    _veilFadeMs = Math.max(VEIL_FADE_MIN_MS, Number(fadeMs) || 800);

    let veil = document.getElementById(VEIL_ID);
    if (!veil) {
      veil = document.createElement('div');
      veil.id = VEIL_ID;
      document.body.appendChild(veil);
    }
    // The stylesheet's duration is only the default for a transition nobody
    // sized. A scaled fade has to drive it from here, on every client.
    veil.style.transitionDuration = `${_veilFadeMs}ms`;
    // Force a reflow so the transition runs from opacity 0 on a fresh node.
    void veil.offsetWidth;
    veil.classList.add('visible');

    // Ambience rides along with the veil so it starts on every client at the
    // same moment the screen goes dark, rather than only on the GM's.
    if (audio) {
      _travelSound = DarkestAudio.playTravelAmbience({ ...audio, loop });
    }

    clearTimeout(_veilTimer);
    // The failsafe has to carry the same audio intent as the transition it
    // covers. A hold starts a LOOPING bed and lifts its veil with
    // keepAudio -- if scene.activate() runs long and the failsafe wins the
    // race, a bare 'arrive' would tear that bed down and the whole roleplay
    // scene would play out in silence, with no way to restart it.
    const failsafeOpts = loop ? { keepAudio: true } : {};
    _veilTimer = setTimeout(
      () => showTransitionVeil('arrive', null, failsafeOpts),
      Number(coverMs) || (_veilFadeMs + VEIL_FAILSAFE_MARGIN_MS)
    );
    return;
  }

  clearTimeout(_veilTimer);
  _veilTimer = null;

  // Fade the bed out with the veil rather than cutting it dead.
  //
  // keepAudio is how the hold-for-roleplay mode lifts the veil ONTO the
  // travelling scene without killing the bed it just started -- without it
  // the ambience dies at the very moment the hold begins.
  //
  // The stored value is a promise, so it has to be resolved before .fade()
  // exists. That also closes a race: an 'arrive' arriving before playback
  // resolves used to leave the sound running with nothing holding a handle
  // to it.
  if (_travelSound && !keepAudio) {
    const pending = _travelSound;
    _travelSound = null;
    const out = Math.min(_veilFadeMs, 1500);
    Promise.resolve(pending).then(snd => {
      if (!snd) return;
      if (typeof snd.fade === 'function') return snd.fade(0, { duration: out }).then(() => snd.stop?.());
      snd.stop?.();
    }).catch(() => { /* a sound that won't fade is not worth breaking arrival over */ });
  }

  const veil = document.getElementById(VEIL_ID);
  if (!veil) return;
  if (fadeMs) _veilFadeMs = Math.max(VEIL_FADE_MIN_MS, Number(fadeMs));
  veil.style.transitionDuration = `${_veilFadeMs}ms`;
  veil.classList.remove('visible');
  // Must outlast the fade, or the node is yanked mid-transition and the
  // screen snaps back instead of easing.
  setTimeout(() => veil.remove(), _veilFadeMs + 100);
}

/**
 * Turn an exit label into a description of the journey that names no
 * destination.
 *
 * Route labels in the book are already written from the party's own point
 * of view -- "Trail to the North", "Track to the South", "Back Down the
 * Road" -- which is exactly what a lost group would know. Naming the
 * destination in public chat would spoil it (the players don't know
 * they're walking to Baba Yaga's Hut until they arrive), so the GM's
 * dropdown keeps the real name and the chat gets this instead.
 *
 * ~91% of routes match the Trail/Track/Road/Path + direction pattern.
 * Anything unusual ("Cave Opening", "Stairs", "Mordecai's Door") is
 * distinctive enough to read well verbatim.
 */
function describeJourney(label, driving = false, boating = false) {
  if (!label) {
    if (boating) return 'The party poles on through the water';
    return driving ? 'The party drives on' : 'The party travels on';
  }

  // "Trail to the North" / "Trail Northwest" -> "follows the trail north"
  const directed = label.match(
    /^(?:(Flooded|Steep|Narrow|Winding|Overgrown)\s+)?(Trail|Track|Road|Path|Way|Stairs?|Tunnel|Bridge|Waterway)\s+(?:(?:to|toward)\s+the\s+)?(North|South|East|West|Northeast|Northwest|Southeast|Southwest)$/i
  );
  if (directed) {
    const [, adj, kind, dir] = directed;
    const surface = `${adj ? adj.toLowerCase() + ' ' : ''}${kind.toLowerCase()}`;
    const verb = boating ? 'poles' : (driving ? 'drives' : 'follows');
    return `The party ${verb} the ${surface} ${dir.toLowerCase()}`;
  }

  // The Road's stock directions read naturally as-is.
  if (/^Farther Up the Road$/i.test(label)) {
    return driving ? 'The party drives on up the road' : 'The party continues up the road';
  }
  if (/^Back Down the Road$/i.test(label) || /^The Road Back$/i.test(label)) {
    return driving ? 'The party drives back down the road' : 'The party heads back down the road';
  }
  if (/^The Road on the (Left|Right)$/i.test(label)) {
    const side = RegExp.$1.toLowerCase();
    return `The party ${driving ? 'drives' : 'takes'} the road on the ${side}`;
  }

  // A label that already names a route ("Secret Path of the Grackle",
  // "Stairs Down") slots in after "takes the". Anything else is a phrase
  // rather than a noun ("Exiting the Woods", "Woodfolk Symbol") and would
  // read as nonsense there, so fall back to something always grammatical.
  if (/\b(trail|track|road|path|way|stairs?|staircase|tunnel|bridge|pier|door|opening|gate|steps|waterway|passage|root)\b/i.test(label)) {
    const verb = boating ? 'poles along the' : 'takes the';
    return `The party ${verb} ${label.replace(/^The\s+/i, '').toLowerCase()}`;
  }

  // "To the Landing", "To the Dark Vault" -- a destination, not a route.
  // Naming it is safe here: these labels ARE what the party can see ahead
  // of them (a landing, a staircase), not a location's secret name.
  const toward = label.match(/^(?:To|Towards?|Into)\s+(.+)$/i);
  if (toward) {
    return `The party heads ${boating ? 'the boat ' : ''}toward ${toward[1].toLowerCase()}`;
  }

  // "Up the Root", "Down the Root", "Further Up", "Going Back Down" --
  // directional phrases that read naturally after "makes their way".
  if (/^(Up|Down|Further|Farther|Going|Back|Deeper)\b/i.test(label)) {
    return `The party makes their way ${label.replace(/^Going\s+/i, '').toLowerCase()}`;
  }

  // A bare place or object name ("Caleb's Shack", "Woodfolk Symbol").
  return boating
    ? 'The party presses on through the water'
    : 'The party presses on';
}

export class TravelClock {

  // ── Clock state ───────────────────────────────────────────────────────

  static getClock() {
    const defaults = { day: 1, minutes: 8 * 60 }; // Day 1, 08:00
    try {
      return game.settings.get('darkest-system', SETTING_CLOCK) || defaults;
    } catch (e) {
      return defaults;
    }
  }

  static async setClock(clock) {
    await game.settings.set('darkest-system', SETTING_CLOCK, clock);
  }

  /**
   * Advance the clock by a number of minutes, rolling over days.
   * Returns { day, minutes, daysPassed } describing the new state.
   */
  static async advance(minutes) {
    const clock = TravelClock.getClock();
    const total = clock.minutes + Math.round(minutes);
    const daysPassed = Math.floor(total / 1440);
    const next = {
      day: clock.day + daysPassed,
      minutes: ((total % 1440) + 1440) % 1440,
    };
    await TravelClock.setClock(next);
    TravelClock.broadcastUpdate();
    return { ...next, daysPassed };
  }

  // ── Birdsongs ─────────────────────────────────────────────────────────

  /** Birdsongs the party has learned, as a set of keys. */
  static getKnownBirdsongs() {
    try {
      return new Set(game.settings.get('darkest-system', SETTING_BIRDSONGS) || []);
    } catch (e) {
      return new Set();
    }
  }

  static async setKnownBirdsongs(keys) {
    await game.settings.set('darkest-system', SETTING_BIRDSONGS, [...keys]);
    TravelClock.broadcastUpdate();
  }

  /** Toggle one birdsong on or off. GM-only in practice. */
  static async toggleBirdsong(key) {
    const known = TravelClock.getKnownBirdsongs();
    if (known.has(key)) known.delete(key);
    else known.add(key);
    await TravelClock.setKnownBirdsongs(known);
  }

  /** Whether a given route is currently passable. */
  static canUseRoute(route, known = null) {
    if (!route.birdsong) return true;
    const songs = known ?? TravelClock.getKnownBirdsongs();
    return songs.has(route.bird ?? 'unnamed');
  }

  // ── Route finding ─────────────────────────────────────────────────────

  /**
   * Travel time for a single route, in minutes, at the given pace.
   *
   * Routes the book never quantified are charged a small nominal cost
   * rather than nothing. Treating them as free made the route finder
   * prefer absurd paths -- a 16-leg detour through the Rootrealm scored
   * "faster" than an 8-leg walk purely because its legs were unmeasured.
   * A few minutes each keeps them cheap without making them free.
   */
  static UNMEASURED_LEG_MINUTES = 15;

  /**
   * "A few steps" between adjacent locations still costs a little time --
   * crossing a clearing, picking down a staircase, getting everyone moving
   * again. 1-3 minutes, rolled fresh each trip so repeated hops don't tick
   * over in a suspiciously even rhythm.
   *
   * Deliberately NOT applied inside routeMinutes(): that feeds the route
   * finder, and a leg whose cost changes every time it's measured makes
   * Dijkstra's "shortest" path unstable. Estimates stay at zero; only the
   * actual journey spends the minutes.
   */
  static stepMinutes() {
    return 1 + Math.floor(Math.random() * 3);
  }

  static routeMinutes(route, pace = 'normal') {
    // Driving only helps on a road. A car on a forest trail is a car
    // parked at the trailhead, so fall back to walking pace elsewhere.
    let effectivePace = (pace === 'drive' && !isDrivable(route)) ? 'normal' : pace;
    // Likewise a pirogue on dry land: you'd be carrying it. Fall back to
    // walking, which on a dry route takes no wading penalty either.
    if (effectivePace === 'boat' && !isNavigable(route)) effectivePace = 'normal';

    // Wading standing water is half speed; a boat avoids that entirely.
    const penalty = wadingPenalty(route, effectivePace);

    if (route.hours) {
      // The book quotes The Road's routes as durations ("about three
      // hours down the road") -- those are WALKING times. Convert back to
      // a distance at walking speed before applying the actual pace,
      // otherwise "3 hours" would stay 3 hours in a car.
      const impliedKm = route.hours * PACE_SPEED.normal;
      return (impliedKm / (PACE_SPEED[effectivePace] * penalty)) * 60;
    }
    if (route.km) return (route.km / (PACE_SPEED[effectivePace] * penalty)) * 60;
    // km === 0 means "a few steps" -- genuinely negligible.
    if (route.km === 0) return 0;
    return TravelClock.UNMEASURED_LEG_MINUTES;
  }

  /**
   * Shortest path between two locations by travel time (Dijkstra).
   *
   * The map is a single connected component of 131 locations, so a path
   * almost always exists -- but only across routes the party can actually
   * use, which is why birdsong trails are filtered out unless known.
   *
   * Returns { legs, minutes } or null if unreachable. This finds the
   * QUICKEST route, not the one the party knows; whether they'd actually
   * find it is the GM's call, which is why the result is shown as an
   * editable plan rather than executed directly.
   */
  static findRoute(fromSlug, toSlug, pace = 'normal') {
    if (!fromSlug || !toSlug || fromSlug === toSlug) return null;

    const known = TravelClock.getKnownBirdsongs();
    const adjacency = new Map();
    for (const route of TRAVEL_ROUTES) {
      if (!route.fromSlug || !route.toSlug) continue;
      if (!TravelClock.canUseRoute(route, known)) continue;
      if (!adjacency.has(route.fromSlug)) adjacency.set(route.fromSlug, []);
      adjacency.get(route.fromSlug).push(route);
    }

    const best = new Map([[fromSlug, 0]]);
    const prev = new Map();
    // A simple priority queue is fine at this size (131 nodes).
    const queue = [{ slug: fromSlug, cost: 0 }];

    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      const { slug, cost } = queue.shift();
      if (slug === toSlug) break;
      if (cost > (best.get(slug) ?? Infinity)) continue;

      for (const route of adjacency.get(slug) ?? []) {
        const next = cost + TravelClock.routeMinutes(route, pace);
        if (next < (best.get(route.toSlug) ?? Infinity)) {
          best.set(route.toSlug, next);
          prev.set(route.toSlug, route);
          queue.push({ slug: route.toSlug, cost: next });
        }
      }
    }

    if (!prev.has(toSlug)) return null;

    const legs = [];
    let cursor = toSlug;
    while (cursor !== fromSlug) {
      const route = prev.get(cursor);
      if (!route) return null;
      legs.unshift(route);
      cursor = route.fromSlug;
    }

    return { legs, minutes: best.get(toSlug) ?? 0 };
  }

  /** Every location that appears in the route graph, for the pickers. */
  static allLocations() {
    const seen = new Map();
    for (const route of TRAVEL_ROUTES) {
      if (route.fromSlug && !seen.has(route.fromSlug)) seen.set(route.fromSlug, route.fromTitle);
      if (route.toSlug && !seen.has(route.toSlug)) seen.set(route.toSlug, route.toTitle);
    }
    return [...seen.entries()]
      .map(([slug, title]) => ({ slug, title: title || slug }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // ── Display helpers ───────────────────────────────────────────────────

  /** "14:35" from minutes-since-midnight. */
  static formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** "4h 20m" / "45m" from a duration in minutes. */
  static formatDuration(minutes) {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  /**
   * The light dies as the woods take hold. Per the book:
   *
   *   "The characters' first day and night in the woods pass normally...
   *    After that first day, however, the days begin to grow drastically
   *    shorter, with dusk and dawn growing longer until finally they
   *    merge. Eventually, it becomes standard that a 'day' consists of
   *    about ten hours of dusk and fourteen hours of night."
   *
   * So day 1 is a normal 24h cycle, and the end state has NO true daylight
   * at all -- just 10h of dusk and 14h of night. We interpolate between
   * the two across DAYLIGHT_DECAY_DAYS: true daylight shrinks toward zero
   * while dusk expands to swallow it, and night grows to 14h.
   *
   * Even "normal" daylight here is only half-light -- the canopy is thick
   * and nights are pitch black -- but that's flavour for the GM to
   * narrate, not something the clock needs to model.
   */
  static DAYLIGHT_DECAY_DAYS = 5;

  /**
   * Phase boundaries for a given day number, as clock hours (0-24).
   *
   * The light is centred on midday and eaten from both ends: as the days
   * shorten, dawn starts later and night starts earlier, with dusk
   * growing to fill the gap. Night wraps through midnight, as it should.
   *
   * Day 1 is a normal day -- dawn ~06:00, daylight to ~16:00, dusk to
   * ~19:00, night after. By the end state there is no dawn or daylight at
   * all: 10h of dusk (centred on midday, ~07:00-17:00) and 14h of night.
   */
  static dayStructure(day) {
    // Progress from 0 (day 1, normal) to 1 (fully merged dusk/night).
    const t = Math.min(1, Math.max(0, (day - 1) / TravelClock.DAYLIGHT_DECAY_DAYS));

    const lerp = (from, to) => from + (to - from) * t;

    // Lengths, interpolated toward the book's stated end state.
    const dawnLength = lerp(2, 0);   // 2h -> none
    const dayLength = lerp(10, 0);   // 10h -> none
    const duskLength = lerp(3, 10);  // 3h -> 10h

    // Keep the lit part of the cycle centred on midday (12:00) so the
    // clock still reads the way people expect -- morning is morning,
    // afternoon is afternoon -- while the light narrows around noon.
    const litLength = dawnLength + dayLength + duskLength;
    const dawnStart = 12 - litLength / 2;

    return {
      dawnStart,
      dayStart: dawnStart + dawnLength,
      duskStart: dawnStart + dawnLength + dayLength,
      nightStart: dawnStart + litLength,
      // Exposed for the tool/dial so the GM can see the woods closing in.
      daylightHours: Math.round(dayLength * 10) / 10,
      merged: dayLength <= 0.05 && dawnLength <= 0.05,
    };
  }

  /** Coarse phase of day, for the dial icon and chat flavour. */
  static phaseOf(minutes, day = 1) {
    const h = minutes / 60;
    const s = TravelClock.dayStructure(day);

    // Night wraps through midnight, so it's everything outside the lit
    // window rather than a single trailing block.
    if (h < s.dawnStart || h >= s.nightStart) return 'night';
    if (h >= s.duskStart) return 'dusk';
    if (h >= s.dayStart) return 'day';
    return 'dawn';
  }

  static PHASE_META = {
    dawn: { icon: 'fa-sun', label: 'Dawn', cls: 'phase-dawn' },
    day: { icon: 'fa-sun', label: 'Day', cls: 'phase-day' },
    dusk: { icon: 'fa-cloud-sun', label: 'Dusk', cls: 'phase-dusk' },
    night: { icon: 'fa-moon', label: 'Night', cls: 'phase-night' },
  };

  /** The region slug of the currently-viewed scene, if it has one. */
  static currentRegion() {
    return canvas?.scene?.flags?.['darkest-woods']?.region
      ?? game.scenes?.active?.flags?.['darkest-woods']?.region
      ?? null;
  }

  /**
   * What the dial should show right now. Regions with fixed time (The
   * Road's endless night) override the underlying clock's phase, but the
   * clock itself keeps running -- time still passes there.
   */
  static displayState() {
    const clock = TravelClock.getClock();
    const region = TravelClock.currentRegion();
    const fixed = region ? FIXED_TIME_REGIONS[region] : null;
    const phase = fixed ? fixed.phase : TravelClock.phaseOf(clock.minutes, clock.day);
    const meta = TravelClock.PHASE_META[phase];
    const structure = TravelClock.dayStructure(clock.day);
    return {
      day: clock.day,
      time: TravelClock.formatTime(clock.minutes),
      phase,
      phaseLabel: fixed ? fixed.label : meta.label,
      icon: meta.icon,
      cls: meta.cls,
      fixed: !!fixed,
      daylightHours: structure.daylightHours,
      merged: structure.merged,
    };
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  static broadcastUpdate() {
    game.socket.emit('system.darkest-system', { type: 'travelClockUpdate' });
    // Local listeners (scene darkness) need to know the clock moved even
    // though the socket doesn't loop back to this client.
    Hooks.callAll('darkestSystem.clockChanged', TravelClock.displayState());
  }

  static refresh() {
    renderDial();
    // Re-render the tool too: its "From here" route list and the region
    // it reads for flavour both depend on the active scene, so it goes
    // stale the moment the GM switches scenes by any other means.
    const tool = Object.values(ui.windows).find(w => w instanceof TravelTool);
    if (tool?.rendered) tool.render();
  }
}

/* ----------------------------------------
   The dial overlay
---------------------------------------- */

/**
 * Sit the dial directly above the player list. The list grows upward as
 * players connect, so a fixed offset works at an empty table and gets
 * covered at a full one -- measure the real element instead.
 */
function positionDial(el) {
  const players = document.getElementById('players');
  if (!players) return;
  const gap = 10;
  el.style.bottom = `${players.offsetHeight + gap}px`;
}

/**
 * Render (or update) the always-visible dial. Kept as a plain DOM node
 * docked to the UI rather than an Application, so it doesn't occupy a
 * window slot or need opening -- it's ambient, like a clock on the wall.
 */
export function renderDial() {
  if (!game.ready) return;

  const state = TravelClock.displayState();
  let el = document.getElementById('darkest-travel-dial');

  if (!el) {
    el = document.createElement('div');
    el.id = 'darkest-travel-dial';
    document.body.appendChild(el);
    // GMs get one-click access to the travel tool from the dial itself.
    el.addEventListener('click', () => {
      if (!game.user.isGM) return;
      const existing = Object.values(ui.windows).find(w => w instanceof TravelTool);
      if (existing) existing.bringToTop();
      else new TravelTool().render(true);
    });
  }

  el.className = `darkest-travel-dial ${state.cls}${game.user.isGM ? ' gm-clickable' : ''}`;

  // Players get the phase and day only. The exact daylight remaining is
  // GM information -- the characters have no way to measure it, and
  // noticing the light failing is a realisation the players should reach
  // themselves. Once the sun has stopped rising entirely that IS plainly
  // observable, so both sides get told.
  let lightNote;
  if (state.fixed) lightNote = 'The sun never rises here.';
  else if (state.merged) lightNote = 'The sun no longer rises.';
  else if (game.user.isGM) lightNote = `GM: about ${state.daylightHours}h of true daylight left.`;
  else lightNote = null;

  el.title = [
    `${state.phaseLabel} — Day ${state.day}`,
    lightNote,
    game.user.isGM ? '\nClick to open the Travel & Time tool' : null,
  ].filter(Boolean).join('\n');

  el.innerHTML = `
    <i class="fas ${state.icon} dial-icon"></i>
    <div class="dial-readout">
      <span class="dial-time">${state.fixed ? state.phaseLabel : state.time}</span>
      <span class="dial-day">Day ${state.day}${state.merged && !state.fixed ? ' · sunless' : ''}</span>
    </div>`;

  positionDial(el);
}

/* ----------------------------------------
   The travel tool (GM)
---------------------------------------- */

export class TravelTool extends Application {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'darkest-travel-tool',
      title: 'Travel & Time',
      template: 'systems/darkest-system/templates/apps/travel-tool.hbs',
      classes: ['darkest-system', 'travel-tool'],
      width: 400,
      height: 'auto',
      resizable: false,
      minimizable: true,
      popOut: true,
    });
  }

  getData() {
    const clock = TravelClock.getClock();
    const state = TravelClock.displayState();

    // Only routes leaving where the party actually is. Listing all 318 was
    // unusable, and the useful ones are always the exits from here.
    // A queued multi-leg journey continues from its LAST leg's
    // destination, not the current scene -- otherwise you can only ever
    // add neighbours of where you started.
    const originSlug = this._legs?.length
      ? this._legs[this._legs.length - 1].route.toSlug
      : (canvas?.scene?.flags?.['darkest-woods']?.locationSlug ?? null);

    const hereRoutes = TRAVEL_ROUTES
      .filter(r => r.fromSlug === originSlug)
      .map(r => ({
        key: `${r.fromSlug}::${r.label}`,
        label: TravelTool._routeLabel(r),
      }));

    // Prefer the last leg's own destination title -- a dead-end location
    // has no outgoing routes, so looking it up by fromSlug would fail.
    const originName = this._legs?.length
      ? (this._legs[this._legs.length - 1].route.toTitle ?? null)
      : (originSlug ? (TRAVEL_ROUTES.find(r => r.fromSlug === originSlug)?.fromTitle ?? null) : null);

    // Queued legs, with a running total so the GM can see the whole trip.
    const legs = (this._legs ?? []).map((l, i) => ({
      index: i,
      label: l.route.toTitle || 'Unknown',
      via: l.route.label,
      duration: l.minutes >= 1 ? TravelClock.formatDuration(l.minutes) : '—',
    }));
    const legTotal = (this._legs ?? []).reduce((sum, l) => sum + l.minutes, 0);

    const known = TravelClock.getKnownBirdsongs();

    // A journey paused on the road. Flagged stale after a couple of hours --
    // a long roleplay scene is legitimate, so this is a nudge rather than
    // anything automatic.
    const heldRaw = TravelTool.getHold();
    const hold = heldRaw ? {
      ...heldRaw,
      stale: (Date.now() - (heldRaw.startedAt ?? 0)) > 2 * 60 * 60 * 1000,
    } : null;

    return {
      day: clock.day,
      time: TravelClock.formatTime(clock.minutes),
      phaseLabel: state.phaseLabel,
      isFixedRegion: state.fixed,
      daylightHours: state.daylightHours,
      merged: state.merged,
      originName,
      originSlug,
      hereRoutes,
      hasHereRoutes: hereRoutes.length > 0,
      hasRoutes: TRAVEL_ROUTES.length > 0,
      legs,
      hasLegs: legs.length > 0,
      legTotal: legTotal >= 1 ? TravelClock.formatDuration(legTotal) : null,
      // Cross-map planning: pick two places, get a route.
      locations: TravelClock.allLocations(),
      // hasAudio drives the play button. Absent unless the GM has actually
      // supplied a clip for that bird, or mapped it to a Syrinscape element.
      birdsongs: BIRDSONGS.map(b => ({
        ...b,
        known: known.has(b.key),
        hasAudio: DarkestAudio.hasBirdsong(b.key),
      })),
      hasLocationArt: !!currentLocationArt(),
      ambience: SceneAmbience.status(),
      hold,
      travelSceneName: TravelTool.travelScene()?.name ?? null,
      canHold: TravelTool.canHold(),
      // Every pace is offered; _updatePaceOptions() disables the ones the
      // SELECTED ROUTE can't take, which is the check travel actually makes.
      paces: Object.keys(PACE_SPEED).map(p => ({
        key: p,
        label: PACE_LABEL[p],
        speed: PACE_SPEED[p],
      })),
    };
  }

  /**
   * Turn whatever the GM typed into a location slug.
   *
   * Tries, in order: exact title, exact slug, title ignoring a leading
   * "The", then a unique substring match. Substring is only accepted when
   * it matches exactly one location -- guessing between several would
   * silently send the party somewhere they didn't ask to go.
   */
  static _resolveLocation(input) {
    const raw = (input ?? '').trim();
    if (!raw) return null;

    const needle = raw.toLowerCase();
    const stripThe = (s) => s.replace(/^the\s+/i, '').toLowerCase();
    const locations = TravelClock.allLocations();

    const exact = locations.find(l => l.title.toLowerCase() === needle || l.slug === needle);
    if (exact) return exact.slug;

    const noThe = locations.find(l => stripThe(l.title) === stripThe(raw));
    if (noThe) return noThe.slug;

    const partial = locations.filter(l => l.title.toLowerCase().includes(needle));
    return partial.length === 1 ? partial[0].slug : null;
  }

  static _routeLabel(r) {
    const dest = r.toTitle || 'Unknown';
    let dist;
    if (r.km === 0) dist = 'a few steps';
    else if (r.km) dist = `${r.km} km`;
    else if (r.hours) dist = `~${r.hours}h`;
    else dist = 'distance unknown';
    return `${r.fromTitle} → ${dest} (${dist})`;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Selecting a known route fills the manual distance box, so the GM can
    // still nudge it before committing.
    html.find('[name="route"]').on('change', (ev) => {
      const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === ev.currentTarget.value);
      // Always reset both boxes first -- otherwise clearing the dropdown,
      // or picking a route with no distance, silently leaves the previous
      // selection's numbers behind and travels the wrong distance.
      html.find('[name="km"]').val(route?.km ? route.km : '');
      html.find('[name="hours"]').val(route?.hours ?? '');
      this._updatePreview(html);
    });

    html.find('[name="km"], [name="hours"], [name="pace"]').on('change keyup', () => this._updatePreview(html));

    // Multi-leg journeys: queue several hops, then walk them as one trip.
    html.find('.leg-add').click(() => this._addLeg(html));
    html.find('.leg-remove').click((ev) => {
      const i = parseInt(ev.currentTarget.dataset.index);
      this._legs.splice(i, 1);
      this.render();
    });
    html.find('.leg-clear').click(() => {
      this._legs = [];
      this.render();
    });

    html.find('.travel-go').click(() => this._travel(html));
    // Passing time gets no flavour and no narration at all -- the GM
    // describes what happened and triggers whatever follows. The message
    // exists only to record that the clock moved.
    //
    // These stay usable during a hold: they pass no route, so they skip the
    // transition entirely. That's how a GM charges extra time for a long
    // conversation on the road.
    html.find('.time-skip').click((ev) => {
      const mins = parseInt(ev.currentTarget.dataset.minutes) || 0;
      this._passTime(mins, 'Time has passed.');
    });

    html.find('.hold-arrive').click(() => TravelTool.arriveFromHold());
    html.find('.hold-abandon').click(() => TravelTool.abandonHold());
    html.find('.travel-scene-pick').click(() => this._pickTravelScene());
    html.find('.travel-scene-clear').click(async () => {
      await game.settings.set('darkest-system', SETTING_TRAVEL_SCENE, '');
      this.render();
    });

    html.find('.clock-reset').click(() => this._promptReset());

    // Show this location's key art to the players. Deliberately manual --
    // some locations ARE their own reveal, so popping art automatically on
    // arrival would spoil them.
    // Preview on the GM's screen first, with a Share button on the popup.
    // Sharing straight away would mean showing the players an image the GM
    // hasn't seen -- and some of this art is a reveal in itself.
    html.find('.show-location-art').click(() => {
      const art = currentLocationArt();
      if (!art) {
        ui.notifications.warn('No artwork for this location.');
        return;
      }
      // v14 takes a single options object -- the older (src, options) form
      // silently fails. Fall back to it for older cores.
      let popout;
      try {
        popout = new ImagePopout({
          src: art.src,
          uuid: art.uuid,
          window: { title: art.title },
        });
      } catch {
        popout = new ImagePopout(art.src, { title: art.title, uuid: art.uuid });
      }
      popout.render(true);
    });

    // Separate, explicit share. Keeping it out of the preview means the
    // handover is always a deliberate second action.
    html.find('.share-location-art').click(() => {
      const art = currentLocationArt();
      if (!art) {
        ui.notifications.warn('No artwork for this location.');
        return;
      }
      ImagePopout.shareImage({ image: art.src, title: art.title, uuid: art.uuid });
      ui.notifications.info(`Showed the ${art.title} artwork to players.`);
    });

    // Birdsong toggles -- shared state with the Transgression Tracker.
    html.find('.birdsong-toggle').click(async (ev) => {
      await TravelClock.toggleBirdsong(ev.currentTarget.dataset.bird);
      TravelClock.refresh();
    });

    // Play a birdsong to the whole table. Diegetic: the party is listening
    // to the recording, so everyone hears it.
    //
    // Emit AND play locally, because game.socket.emit doesn't loop back --
    // the socket covers other clients, the direct call covers this one. That
    // is right for a local file, where each browser plays its own copy.
    //
    // It would be wrong for a SHARED audio source: routing this to one
    // Syrinscape account would fire the same sound once per connected
    // client. Anything added here that isn't per-client must be gated to a
    // single client first (see isPrimaryGM in darkest-system.mjs).
    html.find('.birdsong-play').click((ev) => {
      ev.stopPropagation();  // don't toggle the bird as well
      const bird = ev.currentTarget.dataset.bird;
      game.socket.emit('system.darkest-system', { type: 'playBirdsong', bird });
      if (!DarkestAudio.playBirdsong(bird)) {
        ui.notifications.warn('No recording found for that birdsong.');
      }
    });


    // Cross-map planning: work out a route between two arbitrary places.
    html.find('.plan-find').click(() => this._findRoute(html));
    // Picking from the datalist fires 'change', so plan straight away --
    // but quietly, since this also fires on blur with a half-typed name
    // and shouldn't scold the GM mid-thought.
    html.find('[name="planTo"]').on('change', () => this._findRoute(html, { quiet: true }));

    this._updatePreview(html);
  }

  /** The route currently selected in the dropdown, if any. */
  _selectedRoute(html) {
    const key = html.find('[name="route"]').val();
    return key ? TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === key) : null;
  }

  /**
   * Minutes implied by the current form values.
   *
   * Routed through routeMinutes() rather than doing the arithmetic here, so
   * the preview and the actual journey can't disagree: the wading penalty
   * and the drive/boat fallbacks all live in that one function, and it
   * needs the route's LABEL to apply them. The manual km/hours boxes are
   * still authoritative for the distance -- the GM can overtype what a
   * route filled in -- but the selected route supplies the terrain.
   */
  _computeMinutes(html) {
    const pace = html.find('[name="pace"]').val() || 'normal';
    const hours = parseFloat(html.find('[name="hours"]').val());
    const km = parseFloat(html.find('[name="km"]').val());
    const route = this._selectedRoute(html);

    if (!isNaN(hours) && hours > 0) {
      return TravelClock.routeMinutes({ label: route?.label, hours }, pace);
    }
    if (!isNaN(km) && km > 0) {
      return TravelClock.routeMinutes({ label: route?.label, km }, pace);
    }
    return 0;
  }

  /**
   * Grey out paces the selected route can't take.
   *
   * The gating that matters happens on the ROUTE label (isDrivable /
   * isNavigable), not the region -- a dry trail through the Dismal is still
   * a dry trail. The dropdown used to hint by region, so a pirogue looked
   * available anywhere in the swamp and then silently fell back to walking.
   * Now the option itself is disabled, and says why.
   *
   * With no route picked, everything stays enabled: the GM may be entering a
   * raw distance, which has no label to test.
   */
  _updatePaceOptions(html) {
    const route = this._selectedRoute(html);
    const select = html.find('[name="pace"]');

    const region = TravelClock.currentRegion();

    select.find('option').each((_, opt) => {
      const key = opt.value;
      let blocked = null;
      if (route) {
        // A route is chosen, so test the thing travel actually tests.
        if (key === 'drive' && !isDrivable(route)) blocked = 'no road here';
        else if (key === 'boat' && !isNavigable(route)) blocked = 'no water here';
      } else if (region) {
        // No route yet: fall back to whether the vehicle exists in this
        // region at all. There's no boat moored in the Backwoods whatever
        // route you end up picking.
        if (key === 'drive' && !DRIVABLE_REGIONS.has(region)) blocked = 'no roads in this region';
        else if (key === 'boat' && !BOATABLE_REGIONS.has(region)) blocked = 'no boat in this region';
      }
      opt.disabled = !!blocked;
      const base = opt.dataset.baseLabel ?? opt.textContent;
      opt.dataset.baseLabel = base;
      opt.textContent = blocked ? `${base} — ${blocked}` : base;
    });

    // If the pace that's selected has just become invalid, move off it
    // rather than leaving a disabled option showing as chosen.
    const current = select.find('option:selected')[0];
    if (current?.disabled) {
      select.val('normal');
      ui.notifications.info('That route is walked — pace set back to normal.');
    }
  }

  _updatePreview(html) {
    const preview = html.find('.travel-preview');
    this._updatePaceOptions(html);

    // A queued journey is what the Travel button will actually walk, so
    // preview that rather than whatever is left in the form boxes.
    if (this._legs?.length) {
      const legMinutes = this._legs.reduce(
        (sum, l) => sum + (l.minutes || (l.route?.km === 0 ? 2 : 0)), 0
      );
      const legs = this._legs.length;
      preview.text(
        `${legs} leg${legs > 1 ? 's' : ''} queued — `
        + `${TravelClock.formatDuration(legMinutes)}, ${this._arrivalNote(legMinutes)}`
      );
      return;
    }

    const minutes = this._computeMinutes(html);
    const route = this._selectedRoute(html);

    if (!minutes) {
      if (!route) {
        preview.text('Enter a distance or pick a route.');
        return;
      }
      // "A few steps" between adjacent locations: a minute or three, rolled
      // when the party actually sets off, so quote the range rather than a
      // figure that won't match the chat message.
      if (route.km === 0) {
        preview.text('A few steps — 1-3 minutes.');
        return;
      }
      // Distance the book never gave. routeMinutes() charges a nominal
      // amount so the route planner behaves; say what that costs.
      preview.text(
        `Distance unrecorded — about ${TravelClock.formatDuration(TravelClock.UNMEASURED_LEG_MINUTES)}.`
      );
      return;
    }

    preview.text(`${TravelClock.formatDuration(minutes)} — ${this._arrivalNote(minutes)}`);
  }

  /** "arrive 14:32" / "arrive 09:15 (+1 day)" for a duration in minutes. */
  _arrivalNote(minutes) {
    const clock = TravelClock.getClock();
    const after = clock.minutes + Math.round(minutes);
    const days = Math.floor(after / 1440);
    const arrival = TravelClock.formatTime(((after % 1440) + 1440) % 1440);
    const dayNote = days > 0 ? ` (+${days} day${days > 1 ? 's' : ''})` : '';
    return `arrive ${arrival}${dayNote}`;
  }

  /**
   * Plan a route between two arbitrary locations and load it into the leg
   * queue, where the GM can edit it before committing.
   *
   * This finds the QUICKEST usable path, which is not the same as the one
   * the party would actually find -- they may not know the way at all.
   * That's why the result lands in the editable queue rather than
   * travelling immediately: the tool does the arithmetic, the GM decides
   * whether the party could plausibly walk it.
   */
  _findRoute(html, { quiet = false } = {}) {
    const warn = (msg) => { if (!quiet) ui.notifications.warn(msg); };

    // The pickers are free-text (datalist), so resolve typed names back to
    // slugs -- and be forgiving about it, since "cemetery" should find
    // "The Cemetery" when half the map starts with "The".
    const fromInput = html.find('[name="planFrom"]').val();
    const toInput = html.find('[name="planTo"]').val();
    const pace = html.find('[name="pace"]').val() || 'normal';

    if (!fromInput || !toInput) {
      warn('Type where the party is starting and where they are going.');
      return;
    }

    const from = TravelTool._resolveLocation(fromInput);
    const to = TravelTool._resolveLocation(toInput);

    if (!from) {
      warn(`No location matching "${fromInput}".`);
      return;
    }
    if (!to) {
      warn(`No location matching "${toInput}".`);
      return;
    }
    if (from === to) {
      warn('The party is already there.');
      return;
    }

    const result = TravelClock.findRoute(from, to, pace);
    if (!result) {
      const known = TravelClock.getKnownBirdsongs();
      ui.notifications.warn(known.size < BIRDSONGS.length
        ? 'No route the party can currently walk — a secret trail may be needed. Check the birdsongs they know.'
        : 'No route found between those locations.');
      return;
    }

    this._lastPace = pace;
    this._legs = result.legs.map(route => ({
      route,
      minutes: TravelClock.routeMinutes(route, pace),
    }));
    this.render();
  }

  /**
   * Queue the currently-selected route as another leg of a longer
   * journey. The party often crosses several locations in one push, and
   * doing that as separate trips means a chat message and a scene change
   * for each -- this collapses it into one journey with one arrival.
   */
  _addLeg(html) {
    const routeKey = html.find('[name="route"]').val();
    const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === routeKey);
    if (!route) {
      ui.notifications.warn('Pick a route to add.');
      return;
    }

    this._legs ??= [];
    // Remember the pace the journey was planned at, so travelling it
    // later still knows whether the party was driving.
    this._lastPace = html.find('[name="pace"]').val() || 'normal';
    this._legs.push({ route, minutes: this._computeMinutes(html) });
    // Re-rendering repoints the dropdown at the new last stop, so the next
    // pick continues the journey rather than starting over.
    this.render();
  }

  /**
   * Walk a queued multi-leg journey as a single trip: one chat message,
   * one arrival, the clock advanced by the whole duration.
   */
  async _travelLegs() {
    const legs = this._legs;
    // Each "few steps" leg is rolled separately, so a chain of short hops
    // accumulates the way walking them one at a time would.
    const totalMinutes = legs.reduce(
      (sum, l) => sum + (l.minutes || (l.route?.km === 0 ? TravelClock.stepMinutes() : 0)),
      0
    );
    const last = legs[legs.length - 1];

    // Describe only the FIRST leg -- the party set out that way, and
    // naming every turn would spell out the route they're discovering.
    const driving = this._lastPace === 'drive' && isDrivable(legs[0].route);
    const boating = this._lastPace === 'boat' && isNavigable(legs[0].route);
    const opening = describeJourney(legs[0].route.label, driving, boating);
    // A journey entirely on roads isn't "stretches of trail" -- nor is one
    // poled along waterways.
    const allRoad = legs.every(l => isDrivable(l.route));
    const allWater = legs.every(l => isNavigable(l.route));
    const stretch = allWater ? 'stretches of water'
      : allRoad ? 'stretches of road'
      : 'stretches of trail';
    const legNote = legs.length > 1
      ? `, and keeps going for ${legs.length} ${stretch}`
      : '';

    // Log every leg, not just the last -- the intermediate stops are the
    // most useful part of the map, and _passTime only ever sees the final
    // route. Recorded before _passTime so the order reads correctly.
    for (const leg of legs.slice(0, -1)) {
      SessionLog.recordMove({
        fromTitle: leg.route?.fromTitle,
        toTitle: leg.route?.toTitle,
        label: leg.route?.label,
        minutes: leg.minutes,
        km: routeKm(leg.route),
        region: TravelClock.currentRegion(),
        pace: this._lastPace,
      });
    }

    this._legs = [];
    await this._passTime(totalMinutes, `${opening}${legNote}.`, {
      region: TravelClock.currentRegion(),
      route: last.route,
      boating,
      // Only claim the party drove if EVERY leg was road -- a journey that
      // leaves the tarmac partway is a walk with a drive at one end.
      driving: driving && allRoad,
      pace: this._lastPace,
      hold: this._holdRequested,
    });
  }

  async _travel(html) {
    // A held journey is an open-ended pause, so it can't be guarded by the
    // in-flight flag below -- that would stay set for the length of a
    // roleplay scene and lock the tool. The hold setting is the guard, and
    // being world-scoped it survives a refresh too.
    if (TravelTool.getHold()) {
      const hold = TravelTool.getHold();
      ui.notifications.warn(
        `The party is still on the road to ${hold.toTitle || 'their destination'} — arrive, or turn back, first.`
      );
      return;
    }

    // The transition now awaits a timer mid-flight, so a second click during
    // that pause would advance the clock twice, post two departure messages,
    // and lift the veil on the first journey while the second is still
    // running. Worse, _travelLegs() clears this._legs before awaiting, so a
    // re-entrant call would read an empty array and throw on last.route.
    //
    // Static, because arriving from a hold runs from a chat button with no
    // window behind it and has to take the same lock.
    if (TravelTool._travelling) {
      ui.notifications.warn('The party is already on the move.');
      return;
    }

    // Read once here: _travelLegs() has no html to read it from later.
    // Mirrors how _lastPace is captured.
    this._holdRequested = html.find('[name="holdForRp"]').is(':checked');

    TravelTool._travelling = true;
    try {
      await this._travelInner(html);
    } finally {
      TravelTool._travelling = false;
      this.render();
    }
  }

  async _travelInner(html) {
    // A queued journey takes precedence over whatever is in the form.
    if (this._legs?.length) return this._travelLegs();

    let minutes = this._computeMinutes(html);
    const pace = html.find('[name="pace"]').val() || 'normal';
    const routeKey = html.find('[name="route"]').val();
    const route = TRAVEL_ROUTES.find(r => `${r.fromSlug}::${r.label}` === routeKey);

    // A route with no distance is still a real journey -- "a few steps"
    // between adjacent locations, or one the book never quantified. Only
    // block when there's nothing to act on at all: no route picked AND no
    // distance typed.
    if (!minutes && !route) {
      ui.notifications.warn('Pick a route, or enter a distance.');
      return;
    }

    // Adjacent locations ("a few steps") still cost a minute or three.
    // A route the book never measured costs the same nominal amount the
    // route planner charges it, so the preview and the clock agree.
    if (!minutes && route) {
      minutes = route.km === 0
        ? TravelClock.stepMinutes()
        : TravelClock.routeMinutes(route, pace);
    }

    // Public text never names the destination -- the party doesn't know
    // where they're going until they get there. See describeJourney().
    const driving = pace === 'drive' && (!route || isDrivable(route));
    const boating = pace === 'boat' && (!route || isNavigable(route));
    const journey = route
      ? describeJourney(route.label, driving, boating)
      : (driving ? 'The party drives on'
        : boating ? 'The party poles on through the water'
        : 'The party travels');
    // "at a driving pace" / "at a by pirogue pace" read badly; the verb
    // already carries the mode.
    const paceNote = (pace === 'normal' || pace === 'drive' || pace === 'boat')
      ? ''
      : ` at a ${PACE_LABEL[pace].toLowerCase()} pace`;

    await this._passTime(minutes, `${journey}${paceNote}.`, {
      region: TravelClock.currentRegion(),
      route,
      boating,
      driving,
      pace,
      hold: this._holdRequested,
    });
  }

  /**
   * Set the day and time directly. Sessions don't always start where the
   * last one ended -- a flashback, a time skip between arcs, or simply
   * fixing a misclick all need the clock moved by hand rather than
   * advanced.
   */
  async _promptReset() {
    const clock = TravelClock.getClock();
    const h = String(Math.floor(clock.minutes / 60)).padStart(2, '0');
    const m = String(clock.minutes % 60).padStart(2, '0');

    const content = `<form class="darkest-dialog">
      <div class="form-group">
        <label>Day</label>
        <input type="number" name="day" min="1" step="1" value="${clock.day}" />
      </div>
      <div class="form-group">
        <label>Time</label>
        <input type="time" name="time" value="${h}:${m}" />
      </div>
      <p class="hint">Sets the clock directly. No time is counted as having passed.</p>
    </form>`;

    if (this._resetDialog?.rendered) await this._resetDialog.close();

    this._resetDialog = new Dialog({
      title: 'Set Day &amp; Time',
      content,
      buttons: {
        set: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Set',
          callback: async (html) => {
            const day = Math.max(1, parseInt(html.find('[name="day"]').val()) || 1);
            const [hh, mm] = (html.find('[name="time"]').val() || '08:00').split(':').map(Number);
            const minutes = ((hh || 0) * 60 + (mm || 0)) % 1440;

            await TravelClock.setClock({ day, minutes });
            TravelClock.broadcastUpdate();
            TravelClock.refresh();
            this.render();

            await ChatMessage.create({
              content: `<div class="travel-chat">
                <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> The clock is set.</div>
                <div class="travel-chat-body">
                  It is <strong>${TravelClock.formatTime(minutes)}</strong> on <strong>Day ${day}</strong>.
                </div>
              </div>`
            });
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' }
      },
      default: 'set',
      close: () => { this._resetDialog = null; }
    }, { width: 300 });
    this._resetDialog.render(true);
  }

  /**
   * Switch to the destination's scene after travelling, if one exists and
   * has been imported into the world. Compendium scenes aren't activatable
   * until imported, so a missing scene is normal, not an error -- the GM
   * may simply not have imported that region yet.
   */
  async _activateDestinationScene(route) {
    return TravelTool._activateSceneBySlug(route?.toSlug);
  }

  /**
   * Choose the generic travelling scene.
   *
   * Lives here rather than on the settings sheet because the list can't be
   * built at registration time: settings register on init, before
   * game.scenes exists, so a choices map would always come out empty. Built
   * on click instead, when the world is actually loaded.
   */
  async _pickTravelScene() {
    const current = game.settings.get('darkest-system', SETTING_TRAVEL_SCENE) || '';
    const esc = (s) => foundry.utils.escapeHTML?.(s) ?? String(s);
    const options = game.scenes.contents
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(s => `<option value="${s.uuid}"${s.uuid === current ? ' selected' : ''}>${esc(s.name)}</option>`)
      .join('');

    if (!options) {
      ui.notifications.warn('There are no scenes in this world yet.');
      return;
    }

    new Dialog({
      title: 'Travelling Scene',
      content: `<form>
        <p class="notes">Shown while the party is on the road, so pick something generic — it stands in for every region.</p>
        <div class="form-group">
          <label>Scene</label>
          <select name="scene">${options}</select>
        </div>
      </form>`,
      buttons: {
        set: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Set',
          callback: async (html) => {
            const uuid = html.find('[name="scene"]').val() || '';
            await game.settings.set('darkest-system', SETTING_TRAVEL_SCENE, uuid);
            this.render();
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'set',
    }, { width: 360 }).render(true);
  }

  /**
   * Activate the scene flagged with this location slug, if it's imported.
   *
   * Static because arriving from a hold happens from a chat button, which
   * has no travel tool window to call through.
   */
  static async _activateSceneBySlug(slug) {
    if (!slug) return null;

    const scene = game.scenes.find(s =>
      s.getFlag('darkest-woods', 'locationSlug') === slug
    );
    if (!scene) return null;

    await scene.activate();
    return scene;
  }

  /**
   * The generic travelling scene, if the GM has set one and it still exists.
   *
   * Stored as a UUID rather than an id so a scene moved between folders
   * still resolves. Returns null when unset OR when the scene has since been
   * deleted -- both mean hold mode is unavailable, and a stale uuid must
   * never be able to strand the party somewhere that isn't there.
   */
  static travelScene() {
    let uuid = '';
    try {
      uuid = game.settings.get('darkest-system', SETTING_TRAVEL_SCENE) || '';
    } catch {
      return null;
    }
    if (!uuid) return null;
    try {
      const scene = fromUuidSync(uuid);
      return (scene instanceof Scene) ? scene : null;
    } catch {
      return null;
    }
  }

  /** Is hold-for-roleplay available? Only with a travelling scene set. */
  static canHold() {
    return !!TravelTool.travelScene();
  }

  /** The journey currently paused for roleplay, or null. */
  static getHold() {
    try {
      return game.settings.get('darkest-system', SETTING_HOLD) || null;
    } catch {
      return null;
    }
  }

  /**
   * Record (or clear) the paused journey.
   *
   * Broadcast so every GM's travel tool updates its banner, not just the one
   * that pressed the button -- game.socket.emit doesn't loop back, so the
   * local refresh is separate.
   */
  static async setHold(hold) {
    await game.settings.set('darkest-system', SETTING_HOLD, hold);
    game.socket.emit('system.darkest-system', { type: 'travelHoldChanged' });
    TravelClock.refresh();
    Hooks.callAll('darkestSystem.travelHoldChanged', hold);
  }

  /**
   * Pause between setting out and arriving, in ms, scaled by how far they went.
   *
   * The configured pause is the FLOOR. A few steps between two clearings is
   * over before it started, and stretching that fade just reads as lag; a
   * full day on the move earns a longer beat. Square root rather than linear
   * so the first hour is felt more than the eighth -- the difference between
   * a hop and a hike matters, the difference between eight hours and ten
   * doesn't.
   *
   *   5m -> 1.75s   1h -> 2.4s   4h -> 3.3s   8h+ -> 4.0s
   *   (with the default 1500ms floor and 4000ms ceiling)
   */
  static transitionDelay(minutes = 0) {
    let floor = 0;
    let ceiling = 0;
    try {
      floor = game.settings.get('darkest-system', SETTING_TRANSITION_MS) ?? 0;
      ceiling = game.settings.get('darkest-system', SETTING_TRANSITION_MAX_MS) ?? floor;
    } catch {
      return 0;
    }

    // 0 disables the pause and the fade entirely, as it always has.
    if (floor <= 0) return 0;
    // A ceiling below the floor is a misconfiguration, not a request for a
    // shorter fade on longer journeys.
    const top = Math.max(floor, ceiling);
    if (top === floor) return floor;

    const t = Math.sqrt(Math.min(1, Math.max(0, (Number(minutes) || 0) / TRANSITION_FULL_MINUTES)));
    return Math.round(floor + (top - floor) * t);
  }

  /** The fade portion of a given pause. See VEIL_FADE_RATIO. */
  static fadeFor(delay) {
    return Math.max(VEIL_FADE_MIN_MS, Math.round(delay * VEIL_FADE_RATIO));
  }

  /**
   * Veil every client's screen for the transition.
   *
   * Players don't get the scene change instantly -- scene.activate()
   * propagates asynchronously and they see a hard canvas swap. The veil
   * covers exactly that. game.socket.emit doesn't loop back, so the GM's
   * own client runs it directly as well.
   */
  static broadcastVeil(phase, audio = null, opts = {}) {
    // Emit then run locally: game.socket.emit doesn't loop back, so the
    // socket covers other clients and the direct call covers this one. Every
    // client fades its own screen and plays its own copy of the audio file,
    // which is what we want. See the note on .birdsong-play about why a
    // single shared audio source would need gating to one client instead.
    //
    // opts is plain numbers and booleans, so it serialises over the socket
    // as-is -- every client needs the fade duration to match, or they drift.
    game.socket.emit('system.darkest-system', { type: 'travelTransition', phase, audio, opts });
    showTransitionVeil(phase, audio, opts);
  }

  /**
   * Start or stop the travel bed on every client without touching the veil.
   * Only used when transitions are disabled -- see setTravelBed().
   */
  static broadcastTravelBed(audio = null) {
    game.socket.emit('system.darkest-system', { type: 'travelBed', audio });
    setTravelBed(audio);
  }

  async _passTime(minutes, flavour, opts = {}) {
    // Capture the region BEFORE any scene change, so the flavour describes
    // the ground actually crossed rather than wherever the party ends up.
    const flavourLine = opts.region
      ? regionFlavour(opts.region, opts.boating, opts.driving)
      : null;

    const result = await TravelClock.advance(minutes);
    const state = TravelClock.displayState();

    // A journey of a few steps (or one the book never quantified) moves
    // the party without moving the clock -- report the time rather than
    // claiming "0m passes".
    const timeLine = minutes >= 1
      ? `<strong>${TravelClock.formatDuration(minutes)}</strong> passes.
         It is now <strong>${state.fixed ? state.phaseLabel : state.time}</strong>
         on <strong>Day ${result.day}</strong>.`
      : `It is <strong>${state.fixed ? state.phaseLabel : state.time}</strong>
         on <strong>Day ${result.day}</strong>.`;

    const now = TravelClock.dayStructure(result.day);
    // A journey that changes the scene gets a two-beat treatment: set out,
    // pause, arrive. Everything else (waiting, a manual time skip) is a
    // single message with the time on it, as before.
    const isJourney = !!opts.route;

    let content = `<div class="travel-chat">
      <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> ${flavour}</div>
      ${flavourLine ? `<div class="travel-chat-flavour">${flavourLine}</div>` : ''}
      ${isJourney ? '' : `<div class="travel-chat-body">${timeLine}</div>`}`;

    if (result.daysPassed > 0 && !isJourney) {
      // Public side says only that a day turned. The shrinking daylight
      // is deliberately NOT announced: the characters have no way to
      // measure it (on day 2 there's nothing to compare against), and
      // noticing the light failing is exactly the realisation the players
      // should reach on their own.
      content += `<div class="travel-chat-newday">
        <i class="fas ${now.merged ? 'fa-moon' : 'fa-sun'}"></i>
        ${now.merged ? 'Another lightless day begins.' : 'A new day dawns.'}
      </div>`;
    }
    content += `</div>`;

    Hooks.callAll('darkestSystem.travelBegin', {
      route: opts.route ?? null, minutes, region: opts.region ?? null, pace: opts.pace ?? null,
    });

    await ChatMessage.create({
      content,
      flags: { 'darkest-system': { travel: true, phase: isJourney ? 'depart' : 'wait' } },
    });

    // The GM's side of a day boundary: the book's daily effects to check,
    // and how far the light has actually fallen. Whispered, because both
    // are GM bookkeeping rather than anything the party can perceive.
    if (result.daysPassed > 0) {
      const before = TravelClock.dayStructure(result.day - result.daysPassed);

      // The day the sun stops rising is the one piece of the daylight decay
      // the characters can actually perceive -- it isn't a measurement, it's
      // a fact anyone would notice. The exact hours stay GM-only below, but
      // this moment is public, and it only ever happens once.
      if (now.merged && !before.merged) {
        await ChatMessage.create({
          content: `<div class="travel-chat travel-chat-sunless">
            <div class="travel-chat-head"><i class="fas fa-moon"></i> The sun does not rise.</div>
            <div class="travel-chat-flavour">
              The party waits for a dawn that does not come. What light there is
              never grows past dusk, and then it goes.
            </div>
          </div>`,
          flags: { 'darkest-system': { travel: true, phase: 'sunless' } },
        });
      }

      let lightNote;
      if (now.merged && !before.merged) {
        lightNote = 'The sun no longer rises. Dusk and night have fully merged.';
      } else if (now.merged) {
        lightNote = 'Still sunless — 10h dusk, 14h night.';
      } else {
        lightNote = `Daylight is down to about ${now.daylightHours}h.`;
      }

      const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
      if (gmIds.length) {
        await ChatMessage.create({
          content: `<div class="travel-chat">
            <div class="travel-chat-head"><i class="fas fa-hourglass-half"></i> Day ${result.day} begins.</div>
            <div class="travel-chat-light">${lightNote}</div>
            <div class="travel-chat-hint">Check exposure, rest locks, and daily ability uses.</div>
          </div>`,
          whisper: gmIds,
        });
      }
    }

    // Record the move for the GM-only session log. The public chat message
    // above deliberately never names the destination, so this is the only
    // place the real from/to survives -- it's what the map gets drawn from.
    if (opts.route) {
      SessionLog.recordMove({
        fromTitle: opts.route.fromTitle,
        toTitle: opts.route.toTitle,
        label: opts.route.label,
        minutes,
        km: routeKm(opts.route),
        region: opts.region,
        day: result.day,
        time: state.fixed ? state.phaseLabel : state.time,
        pace: opts.pace,
      });
    }

    // Move the party to where they actually walked to.
    //
    // The scene change used to happen immediately after the chat message,
    // which read as a jump cut -- the text landed and the canvas swapped
    // under it. Now the party sets out, the screen holds for a beat (veiled
    // on every client, so players don't watch a hard canvas swap either),
    // and only then do they arrive.
    if (opts.route) {
      // Longer journeys get a longer transition; see transitionDelay().
      const delay = TravelTool.transitionDelay(minutes);
      const fadeMs = TravelTool.fadeFor(delay);
      // Region is the ground being crossed (captured before the scene
      // change); mode distinguishes poling a pirogue from walking it.
      const audio = {
        region: opts.region ?? null,
        mode: opts.boating ? 'boat' : (opts.pace === 'drive' ? 'drive' : 'walk'),
      };

      // Hold-for-roleplay takes a different path entirely: it stops at the
      // travelling scene and waits for the GM, so neither the arrival card
      // nor the travelArrive hook fires here -- the party hasn't arrived.
      if (opts.hold && TravelTool.canHold()) {
        await this._beginHold({ delay, fadeMs, audio, opts, minutes, timeLine, result });
        TravelClock.refresh();
        this.render();
        return;
      }

      let scene = null;
      try {
        if (delay > 0) {
          TravelTool.broadcastVeil('depart', audio, {
            fadeMs,
            coverMs: delay + fadeMs + VEIL_FAILSAFE_MARGIN_MS,
          });
          await new Promise(r => setTimeout(r, delay));
        }

        scene = await this._activateDestinationScene(opts.route);

        if (scene) {
          ui.notifications.info(`Now viewing: ${scene.name}`);
        } else if (opts.route.toSlug) {
          ui.notifications.warn(
            `No scene imported for ${opts.route.toTitle || 'that destination'} -- import its region to travel there automatically.`
          );
        }
      } catch (err) {
        // The clock has already advanced by this point, so swallowing the
        // error and carrying on leaves a consistent state: the party is
        // where they were, but the time really did pass. Rethrowing would
        // skip the arrival message and leave the dial stale.
        console.error('Darkest System | scene activation failed during travel', err);
        ui.notifications.error('Could not switch to the destination scene -- see the console.');
      } finally {
        // Must run even if activation threw, or every client sits behind a
        // veil until its own failsafe fires.
        if (delay > 0) TravelTool.broadcastVeil('arrive', null, { fadeMs });
      }

      await TravelTool._postArrival({ route: opts.route, scene, timeLine, result, now });

      Hooks.callAll('darkestSystem.travelArrive', {
        route: opts.route,
        scene: scene ?? null,
        region: scene?.getFlag('darkest-woods', 'region') ?? null,
        day: result.day,
        time: state.fixed ? state.phaseLabel : state.time,
      });
    }

    TravelClock.refresh();
    this.render();
  }

  /**
   * The arrival beat: what the party finds when they stop walking.
   *
   * Carries the clock, because "it is now 16:40" belongs where they arrive
   * rather than where they set out. The description never names the
   * destination -- see describeJourney() for why -- and is suppressed
   * entirely by the showArrivalText setting.
   *
   * Static: arriving from a hold is driven by a chat button with no window
   * behind it. Uses no instance state, so there was nothing to move.
   */
  static async _postArrival({ route, scene, timeLine, result, now }) {
    const showText = game.settings.get('darkest-system', SETTING_ARRIVAL_TEXT);
    const region = scene?.getFlag('darkest-woods', 'region') ?? null;
    const line = showText ? arrivalFlavour(route.toSlug, region) : null;

    let content = `<div class="travel-chat travel-chat-arrival">
      <div class="travel-chat-head"><i class="fas fa-map-pin"></i> The party arrives.</div>
      ${line ? `<div class="travel-chat-flavour">${line}</div>` : ''}
      <div class="travel-chat-body">${timeLine}</div>`;

    if (result.daysPassed > 0) {
      content += `<div class="travel-chat-newday">
        <i class="fas ${now.merged ? 'fa-moon' : 'fa-sun'}"></i>
        ${now.merged ? 'Another lightless day begins.' : 'A new day dawns.'}
      </div>`;
    }
    content += `</div>`;

    await ChatMessage.create({
      content,
      flags: { 'darkest-system': { travel: true, phase: 'arrive' } },
    });
  }

  /**
   * Set out, but stop on the road.
   *
   * The clock has already advanced by the journey's full duration, so the
   * roleplay that happens here costs nothing further -- the conversation is
   * happening ON the way, not after it. That's also why timeLine is stashed
   * rather than recomputed: the arrival card should report the time they got
   * there, which was fixed the moment they set out.
   */
  async _beginHold({ delay, fadeMs, audio, opts, minutes, timeLine, result }) {
    const travelScene = TravelTool.travelScene();
    const origin = canvas?.scene ?? null;

    try {
      if (delay > 0) {
        // loop: the pause is open-ended, so a one-shot bed would run dry
        // in the middle of the conversation.
        TravelTool.broadcastVeil('depart', audio, {
          fadeMs,
          loop: true,
          coverMs: delay + fadeMs + VEIL_FAILSAFE_MARGIN_MS,
        });
        await new Promise(r => setTimeout(r, delay));
      } else {
        // Transitions turned off entirely, but the bed still belongs here --
        // it's the sound of the journey, not part of the fade, and without
        // it the whole hold would be silent. Started directly rather than
        // through a zero-length veil, whose failsafe would fire immediately
        // and tear the sound straight back down.
        TravelTool.broadcastTravelBed(audio);
      }

      await travelScene.activate();
    } catch (err) {
      // Same reasoning as the normal path: the clock has moved, so carry on
      // rather than rethrowing and leaving the dial stale. But without the
      // travelling scene there is nothing to hold ON, so fall through to a
      // normal arrival instead of stranding the party mid-journey.
      console.error('Darkest System | could not open the travelling scene', err);
      ui.notifications.error('Could not switch to the travelling scene -- arriving directly instead.');

      // Swap the scene BEFORE lifting the veil, not after: the veil exists
      // precisely to cover that swap, and no keepAudio here means the
      // looping bed is torn down with it.
      let scene = null;
      try {
        scene = await TravelTool._activateSceneBySlug(opts.route.toSlug);
      } catch (err2) {
        console.error('Darkest System | destination scene also failed', err2);
      } finally {
        TravelTool.broadcastVeil('arrive', null, { fadeMs });
      }

      await TravelTool._postArrival({
        route: opts.route, scene, timeLine, result,
        now: TravelClock.dayStructure(result.day),
      });
      Hooks.callAll('darkestSystem.travelArrive', {
        route: opts.route,
        scene: scene ?? null,
        region: scene?.getFlag('darkest-woods', 'region') ?? null,
        day: result.day,
      });
      return;
    }

    await TravelTool.setHold({
      toSlug: opts.route.toSlug ?? null,
      toTitle: opts.route.toTitle ?? null,
      region: opts.region ?? null,
      mode: audio.mode,
      minutes,
      timeLine,
      daysPassed: result.daysPassed ?? 0,
      day: result.day,
      originSceneUuid: origin?.uuid ?? null,
      startedAt: Date.now(),
    });

    await ChatMessage.create({
      content: `<div class="travel-chat travel-chat-holding">
        <div class="travel-chat-head"><i class="fas fa-route"></i> The party is on the road.</div>
        <div class="travel-chat-flavour">The way ahead is long, and there is time to talk.</div>
        <div class="travel-hold-actions">
          <button type="button" class="travel-arrive-btn"><i class="fas fa-map-pin"></i> Arrive</button>
          <button type="button" class="travel-abandon-btn"><i class="fas fa-rotate-left"></i> Turn back</button>
        </div>
      </div>`,
      flags: { 'darkest-system': { travel: true, phase: 'holding' } },
    });

    // keepAudio is the whole point: this lifts the veil ONTO the travelling
    // scene, and the normal 'arrive' teardown would kill the bed we just
    // started looping -- silencing the hold at the moment it begins.
    if (delay > 0) TravelTool.broadcastVeil('arrive', null, { fadeMs, keepAudio: true });
  }

  /**
   * Finish a held journey: the party gets where they were going.
   *
   * Static so the chat card's button can call it directly. Re-reads the hold
   * rather than trusting the caller, so a button on a stale card from an
   * earlier journey does nothing.
   */
  static async arriveFromHold() {
    const hold = TravelTool.getHold();
    if (!hold) {
      ui.notifications.warn('The party is not on the road.');
      return;
    }
    if (TravelTool._travelling) return;
    TravelTool._travelling = true;

    const delay = TravelTool.transitionDelay(hold.minutes ?? 0);
    const fadeMs = TravelTool.fadeFor(delay);
    let scene = null;

    try {
      if (delay > 0) {
        // No audio payload: the bed from the depart leg is still looping,
        // and starting a second one would layer them.
        TravelTool.broadcastVeil('depart', null, {
          fadeMs,
          coverMs: delay + fadeMs + VEIL_FAILSAFE_MARGIN_MS,
        });
        await new Promise(r => setTimeout(r, delay));
      }

      scene = await TravelTool._activateSceneBySlug(hold.toSlug);
      if (scene) {
        ui.notifications.info(`Now viewing: ${scene.name}`);
      } else if (hold.toSlug) {
        ui.notifications.warn(
          `No scene imported for ${hold.toTitle || 'that destination'} -- import its region to travel there automatically.`
        );
      }
    } catch (err) {
      console.error('Darkest System | scene activation failed arriving from a hold', err);
      ui.notifications.error('Could not switch to the destination scene -- see the console.');
    } finally {
      // Cleared FIRST. setHold() below awaits a server round-trip that can
      // reject (dropped socket, restarting server), and refresh() can throw
      // on a bad render -- either would skip this line and leave the static
      // flag stuck true, locking every travel action for the rest of the
      // session with no way back short of a reload.
      TravelTool._travelling = false;
      // No keepAudio here: this is the real arrival, so the bed fades out.
      TravelTool.broadcastVeil('arrive', null, { fadeMs });
      await TravelTool.setHold(null);
    }

    await TravelTool._postArrival({
      route: { toSlug: hold.toSlug, toTitle: hold.toTitle },
      scene,
      timeLine: hold.timeLine ?? '',
      result: { day: hold.day, daysPassed: hold.daysPassed ?? 0 },
      now: TravelClock.dayStructure(hold.day),
    });

    // Only now has the party actually arrived, so this is where the hook
    // fires -- scene darkness and anything else listening keys off it, and
    // during the hold there was nowhere to apply it to.
    Hooks.callAll('darkestSystem.travelArrive', {
      route: { toSlug: hold.toSlug, toTitle: hold.toTitle },
      scene: scene ?? null,
      region: scene?.getFlag('darkest-woods', 'region') ?? null,
      day: hold.day,
    });

    TravelClock.refresh();
  }

  /**
   * Call the journey off and go back.
   *
   * The clock is deliberately NOT rewound: the time really did pass, the
   * same reasoning the failed-activation path uses. They walked out and
   * walked back.
   */
  static async abandonHold() {
    const hold = TravelTool.getHold();
    if (!hold) {
      ui.notifications.warn('The party is not on the road.');
      return;
    }
    if (TravelTool._travelling) return;
    TravelTool._travelling = true;

    const delay = TravelTool.transitionDelay(hold.minutes ?? 0);
    const fadeMs = TravelTool.fadeFor(delay);

    try {
      if (delay > 0) {
        TravelTool.broadcastVeil('depart', null, {
          fadeMs,
          coverMs: delay + fadeMs + VEIL_FAILSAFE_MARGIN_MS,
        });
        await new Promise(r => setTimeout(r, delay));
      }

      const origin = hold.originSceneUuid ? fromUuidSync(hold.originSceneUuid) : null;
      if (origin instanceof Scene) await origin.activate();
      else ui.notifications.warn('Could not find where the party set out from.');
    } catch (err) {
      console.error('Darkest System | could not return to the origin scene', err);
      ui.notifications.error('Could not switch back -- see the console.');
    } finally {
      // Cleared first, for the same reason as arriveFromHold().
      TravelTool._travelling = false;
      TravelTool.broadcastVeil('arrive', null, { fadeMs });
      await TravelTool.setHold(null);
    }

    await ChatMessage.create({
      content: `<div class="travel-chat">
        <div class="travel-chat-head"><i class="fas fa-rotate-left"></i> The party turns back.</div>
        <div class="travel-chat-flavour">Whatever lay ahead, they do not meet it today.</div>
      </div>`,
      flags: { 'darkest-system': { travel: true, phase: 'abandon' } },
    });

    TravelClock.refresh();
  }
}

/**
 * Register the world-scoped clock setting.
 */
export function registerTravelClockSettings() {
  game.settings.register('darkest-system', SETTING_CLOCK, {
    name: 'Travel Clock',
    hint: 'Current in-world day and time',
    scope: 'world',
    config: false,
    type: Object,
    default: { day: 1, minutes: 8 * 60 },
  });

  // Shared by the travel tool and the Transgression Tracker -- both read
  // and write this one setting, so toggling in either place is reflected
  // in the other.
  game.settings.register('darkest-system', SETTING_BIRDSONGS, {
    name: 'Known Birdsongs',
    hint: 'Which birdsongs the party has learned, unlocking secret trails',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register('darkest-system', SETTING_ARRIVAL_TEXT, {
    name: 'Describe arrivals',
    hint: "After travelling, post a short description of where the party ends up. Never names the destination. Turn off to have arrivals report only the time.",
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register('darkest-system', SETTING_TRANSITION_MS, {
    name: 'Shortest travel transition (ms)',
    hint: 'How long the screen holds between setting out and arriving, so the travel text can be read before the scene changes. This is the floor, used for short hops. 0 disables the pause and the fade entirely.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 5000, step: 250 },
    default: 1500,
  });

  game.settings.register('darkest-system', SETTING_TRANSITION_MAX_MS, {
    name: 'Longest travel transition (ms)',
    hint: 'A long journey earns a longer fade. This is the ceiling, reached at a full day on the move (8h); shorter trips fall between the two. Set it equal to the floor above for a constant transition.',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 12000, step: 250 },
    default: 4000,
  });

  // The generic travelling scene, shown while the party is on the road in
  // hold-for-roleplay mode. config: false because it is picked from the
  // travel tool -- settings register on init, before game.scenes exists, so
  // a choices map built here would always be empty.
  game.settings.register('darkest-system', SETTING_TRAVEL_SCENE, {
    name: 'Travelling scene',
    hint: 'A generic scene shown while the party is on the road.',
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });

  // A journey paused on the travelling scene, awaiting the GM's Arrive.
  // World-scoped rather than in-memory so a browser refresh mid-hold
  // recovers instead of stranding the party on the travelling scene.
  game.settings.register('darkest-system', SETTING_HOLD, {
    name: 'Travel hold',
    hint: 'Internal: a journey paused for roleplay.',
    scope: 'world',
    config: false,
    type: Object,
    default: null,
  });
}

/**
 * Register hooks that keep the dial in sync.
 */
export function registerTravelClockHooks() {
  // A scene change moves the party: the dial's region-specific time and
  // the tool's "From here" routes both depend on it, so refresh both
  // rather than just redrawing the dial.
  Hooks.on('canvasReady', () => TravelClock.refresh());

  // Called directly rather than through Hooks.on('ready'): this function is
  // itself invoked from the system's ready handler, and Foundry never
  // replays a hook that has already fired -- so a 'ready' listener
  // registered here would never run at all.
  renderDial();

  // A hold survives a refresh (it's a world setting), but the ambience bed
  // and the veil don't -- those were client-side. Say so rather than leaving
  // the GM wondering why the road went quiet, and flag the case where
  // someone has switched scenes by hand and left the hold dangling.
  if (game.user.isGM) {
    const hold = TravelTool.getHold();
    if (hold) {
      const travelScene = TravelTool.travelScene();
      const onTravelScene = travelScene && canvas?.scene?.id === travelScene.id;
      ui.notifications.info(
        onTravelScene
          ? `The party is still on the road to ${hold.toTitle || 'their destination'} — press Arrive in the travel tool when ready.`
          : `A journey to ${hold.toTitle || 'a destination'} is still open, but this isn't the travelling scene. Arrive or turn back from the travel tool.`
      );
    }
  }
  // The player list changes height as people connect/disconnect, and the
  // dial sits directly on top of it -- re-measure whenever it redraws.
  Hooks.on('renderPlayerList', () => renderDial());

  game.socket.on('system.darkest-system', (data) => {
    if (data?.type === 'travelClockUpdate') TravelClock.refresh();
  });
}
