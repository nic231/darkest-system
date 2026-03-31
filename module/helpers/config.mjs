/**
 * Configuration constants for The Darkest System
 */
export const DARKEST = {};

/**
 * The set of Actor types
 */
DARKEST.actorTypes = {
  character: "DARKEST.Actor.Character",
  npc: "DARKEST.Actor.NPC"
};

/**
 * The set of Item types
 */
DARKEST.itemTypes = {
  wound: "DARKEST.Wound.Name",
  doom: "DARKEST.Doom.Name",
  ability: "DARKEST.Ability.Name",
  equipment: "DARKEST.Equipment.Name"
};

/**
 * Wound types
 */
DARKEST.woundTypes = {
  physical: "DARKEST.Wound.Physical",
  mental: "DARKEST.Wound.Mental"
};

/**
 * Ability types
 */
DARKEST.abilityTypes = {
  passive: "DARKEST.Ability.Passive",
  active: "DARKEST.Ability.Active"
};

/**
 * Armor types for equipment
 */
DARKEST.armorTypes = {
  none: "DARKEST.Equipment.None",
  light: "DARKEST.Equipment.Light",
  heavy: "DARKEST.Equipment.Heavy"
};

/**
 * Rating modification categories
 */
DARKEST.ratingModCategories = {
  physical: "DARKEST.Modifications.Physical",
  mental: "DARKEST.Modifications.Mental",
  stealth: "DARKEST.Modifications.Stealth",
  social: "DARKEST.Modifications.Social"
};

/**
 * Default rating values
 */
DARKEST.defaultRating = 3;
DARKEST.minRating = 1;
DARKEST.maxRating = 10;

/**
 * Task difficulty reference
 */
DARKEST.taskDifficulty = {
  trivial: { rating: 1, label: "Trivial" },
  easy: { rating: 2, label: "Easy" },
  simple: { rating: 3, label: "Simple" },
  standard: { rating: 4, label: "Standard" },
  challenging: { rating: 5, label: "Challenging" },
  difficult: { rating: 6, label: "Difficult" },
  hard: { rating: 7, label: "Hard" },
  extreme: { rating: 8, label: "Extreme" },
  legendary: { rating: 9, label: "Legendary" },
  impossible: { rating: 10, label: "Nearly Impossible" }
};

/**
 * Armor bonus values
 */
DARKEST.armorBonus = {
  none: 0,
  light: 1,
  heavy: 2
};
