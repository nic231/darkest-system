/**
 * Which GM client owns a shared action.
 *
 * Gating on `game.user.isGM` is not enough for anything that mutates world
 * state or fans out to a single external target: with a GM and an assistant
 * GM both connected, that check is true on BOTH clients at once, so one
 * player's roll advances the transgression track twice and posts two
 * messages.
 *
 * Electing the lowest-id active GM gives every client the same answer from
 * the same user list, with no coordination. If the primary disconnects, the
 * next one takes over automatically.
 */
export function isPrimaryGM() {
  if (!game.user?.isGM) return false;
  const gms = game.users.filter(u => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id));
  return gms.length === 0 || gms[0].id === game.user.id;
}
