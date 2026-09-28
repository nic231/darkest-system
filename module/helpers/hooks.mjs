/**
 * Hook names that changed under us between Foundry generations.
 *
 * v13 rebuilt the player list as ApplicationV2 `Players`, and AppV2 fires
 * render hooks per class name -- so `renderPlayerList` simply stopped firing,
 * silently, with no deprecation warning. Anything listening for it went dead.
 *
 * v13 also deprecated `renderChatMessage` (removed in v15) in favour of
 * `renderChatMessageHTML`, which passes an HTMLElement instead of jQuery.
 *
 * The system still declares v11 as its minimum, so pick by what exists
 * rather than dropping the old names outright. `foundry.applications.ui`
 * is the v13 namespace that holds `Players`.
 */
const V13 = !!foundry.applications?.ui?.Players;

export const PLAYERS_HOOK = V13 ? 'renderPlayers' : 'renderPlayerList';
export const CHAT_HOOK = V13 ? 'renderChatMessageHTML' : 'renderChatMessage';
