/**
 * Who is travelling.
 *
 * The system assumed one party until now: a leg was logged, and it was
 * understood to be everybody. That breaks the moment characters separate --
 * two groups walking different paths on the same day produce a single chain
 * that zig-zags between them, and a route map drawn from it would show a
 * journey nobody made.
 *
 * So travel is logged against a GROUP. There is always at least one ("The
 * Party"), it is selected in the travel tool, and every leg records which
 * group walked it.
 *
 * ---
 *
 * ON THE CLOCK. There is still exactly ONE clock, deliberately. A clock per
 * group would have to be read by the dial, the scene darkness, the ambience
 * layers and the daylight decay -- all of which ask "what time is it?" with
 * no notion of whose time. Keeping one clock means the GM runs one group,
 * then the other, and keeps them level by narration, which is what happens
 * at the table anyway. The log records the times it was told; it does not
 * try to reconcile them.
 *
 * Groups are a world setting rather than actor flags: a character can be in
 * no group, and the group outlives any particular roster.
 */

const SETTING_GROUPS = 'travelGroups';

/** The group every world starts with, so travel works before anyone splits. */
const DEFAULT_GROUP = { id: 'party', name: 'The Party', members: [], colour: '#d8a05a' };

/**
 * Distinct, legible on both the sketch map and the real one. Ordered so the
 * first few groups are furthest apart -- most games will only ever use two
 * or three.
 */
const GROUP_COLOURS = [
  '#d8a05a', // amber -- the default party
  '#7aa8d8', // cold blue
  '#8fc08f', // moss
  '#c88fc8', // heather
  '#d8d08f', // pale gold
  '#c8886a', // rust
];

export const TravelGroups = {

  /** Every group. Always returns at least the default. */
  all() {
    let stored;
    try {
      stored = game.settings.get('darkest-system', SETTING_GROUPS);
    } catch {
      stored = null;
    }
    const groups = Array.isArray(stored?.groups) ? stored.groups : [];
    return groups.length ? groups : [foundry.utils.deepClone(DEFAULT_GROUP)];
  },

  /** The group travel is currently logged against. */
  activeId() {
    try {
      const stored = game.settings.get('darkest-system', SETTING_GROUPS);
      const id = stored?.activeId;
      // A stale id -- the group was deleted -- falls back rather than
      // logging against a group that no longer exists.
      if (id && TravelGroups.all().some(g => g.id === id)) return id;
    } catch { /* fall through */ }
    return TravelGroups.all()[0].id;
  },

  active() {
    const id = TravelGroups.activeId();
    return TravelGroups.all().find(g => g.id === id) ?? TravelGroups.all()[0];
  },

  get(id) {
    return TravelGroups.all().find(g => g.id === id) ?? null;
  },

  /** Name for display, tolerating a group that has since been deleted. */
  nameOf(id) {
    if (!id) return TravelGroups.all()[0]?.name ?? 'The Party';
    return TravelGroups.get(id)?.name ?? 'A former group';
  },

  colourOf(id) {
    return TravelGroups.get(id)?.colour ?? GROUP_COLOURS[0];
  },

  async _write(data) {
    await game.settings.set('darkest-system', SETTING_GROUPS, data);
    Hooks.callAll('darkestSystem.travelGroupsChanged', data);
  },

  async setActive(id) {
    const groups = TravelGroups.all();
    if (!groups.some(g => g.id === id)) return;
    await TravelGroups._write({ groups, activeId: id });
  },

  async create({ name, members = [] } = {}) {
    const groups = TravelGroups.all();
    const used = new Set(groups.map(g => g.colour));
    const colour = GROUP_COLOURS.find(c => !used.has(c)) ?? GROUP_COLOURS[groups.length % GROUP_COLOURS.length];
    const group = {
      id: foundry.utils.randomID(),
      name: (name || '').trim() || `Group ${groups.length + 1}`,
      members,
      colour,
    };
    await TravelGroups._write({ groups: [...groups, group], activeId: group.id });
    return group;
  },

  async update(id, changes) {
    const groups = TravelGroups.all().map(g =>
      g.id === id ? { ...g, ...changes, id: g.id } : g
    );
    await TravelGroups._write({ groups, activeId: TravelGroups.activeId() });
  },

  /**
   * Delete a group.
   *
   * Its logged legs are NOT deleted -- they are a record of something that
   * happened, and removing them would silently rewrite the campaign's
   * history. They keep their groupId and render as "a former group".
   */
  async remove(id) {
    const groups = TravelGroups.all().filter(g => g.id !== id);
    if (!groups.length) return;   // never leave the world with no group
    const activeId = groups.some(g => g.id === TravelGroups.activeId())
      ? TravelGroups.activeId()
      : groups[0].id;
    await TravelGroups._write({ groups, activeId });
  },

  /**
   * Create or re-crew a group.
   *
   * Membership is informational -- nothing in the system checks it. It is
   * there so the GM can see at a glance who a tab refers to six sessions
   * later, and so the map legend can name the group meaningfully.
   */
  async manageDialog(existing = null) {
    if (!game.user.isGM) return;
    const editing = !!existing;
    const chars = TravelGroups.characters();
    const members = new Set(existing?.members ?? []);
    const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');

    const checkboxes = chars.length
      ? chars.map(c => `<label class="group-member">
          <input type="checkbox" name="member" value="${c.id}"${members.has(c.id) ? ' checked' : ''} />
          ${esc(c.name)}
        </label>`).join('')
      : '<p class="notes">No player characters in this world yet.</p>';

    const content = `<form class="darkest-dialog travel-group-form">
      <div class="form-group">
        <label>Name</label>
        <input type="text" name="name" value="${esc(existing?.name ?? '')}" placeholder="e.g. The Scouts" />
      </div>
      <div class="form-group">
        <label>Who is in it</label>
        <div class="group-members">${checkboxes}</div>
        <small class="hint">For your reference and the map legend — nothing is enforced.</small>
      </div>
    </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: editing ? 'Edit group' : 'New travel group',
        content,
        buttons: {
          save: {
            icon: `<i class="fas fa-${editing ? 'check' : 'plus'}"></i>`,
            label: editing ? 'Save' : 'Create',
            callback: async (html) => {
              const name = html.find('[name="name"]').val()?.trim();
              const picked = html.find('[name="member"]:checked')
                .map((_, el) => el.value).get();
              if (editing) await TravelGroups.update(existing.id, { name: name || existing.name, members: picked });
              else await TravelGroups.create({ name, members: picked });
              resolve(true);
            },
          },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel', callback: () => resolve(false) },
        },
        default: 'save',
      }, { width: 380 }).render(true);
    });
  },

  /** Player characters, for the membership picker. */
  characters() {
    return game.actors
      .filter(a => a.type === 'character' && a.hasPlayerOwner)
      .map(a => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** "Syren, Azreal" -- who is in this group, for the tab's tooltip. */
  membersLabel(group) {
    if (!group?.members?.length) return 'Nobody assigned';
    return group.members
      .map(id => game.actors.get(id)?.name)
      .filter(Boolean)
      .join(', ') || 'Nobody assigned';
  },
};

export function registerTravelGroupSettings() {
  game.settings.register('darkest-system', SETTING_GROUPS, {
    name: 'Travel groups',
    hint: 'Internal: who is travelling together.',
    scope: 'world',
    config: false,
    type: Object,
    default: { groups: [foundry.utils.deepClone(DEFAULT_GROUP)], activeId: DEFAULT_GROUP.id },
  });
}
