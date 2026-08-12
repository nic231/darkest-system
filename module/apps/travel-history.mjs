/**
 * What the session log MEANS, as opposed to what it stores.
 *
 * The log is a flat list of legs in the order they were recorded. Three
 * things read it as a journey rather than a list -- the backtracking check,
 * the manual-entry dialog, and (later) the route map -- and all three need
 * the same two things the log doesn't do on its own: put the legs in game
 * order, and answer questions about where the party was on a given day.
 *
 * It lives in its own file rather than in session-log.mjs so the log stays a
 * log, and so this can import from travel-clock.mjs without closing an import
 * cycle (travel-clock already imports session-log).
 */

import { SessionLog } from './session-log.mjs';
import { TransgressionTracker } from './transgression-tracker.mjs';

const SETTING_BACKTRACK = 'backtrackSensitivity';

/**
 * location slug -> encounter-area slug, supplied by the content module.
 *
 * Rides the travel-routes hook rather than getting its own: it is the same
 * kind of thing (book-derived travel data the system can work without), and
 * the system already listens for that once. Empty without the module, in
 * which case 'area' sensitivity has nothing to group by and falls back to
 * per-location rather than silently matching nothing.
 */
export let LOCATION_AREAS = {};

Hooks.once('darkestSystem.registerTravelRoutes', (data) => {
  if (data?.locationAreas) LOCATION_AREAS = data.locationAreas;
});

export const TravelHistory = {

  /**
   * Movement rows in game-world order. Delegates to the log's own sort so
   * there is exactly one definition of "game order" -- two comparators that
   * drifted apart would put the route map and the backtracking check into
   * quiet disagreement.
   */
  chronological(moves) {
    return SessionLog._chronological(moves ?? []);
  },

  /** Every movement entry the log holds, in game order. */
  moves() {
    const log = SessionLog.getLog();
    return TravelHistory.chronological((log.entries ?? []).filter(e => e.kind === 'move'));
  },

  /** 'location' | 'area' | 'off' -- how sensitive the backtracking check is. */
  sensitivity() {
    try {
      return game.settings.get('darkest-system', SETTING_BACKTRACK) || 'location';
    } catch {
      return 'location';
    }
  },

  /**
   * Did the party arrive somewhere they were the day before?
   *
   * The book: "Traversing the same path two days in a row is a
   * transgression... This must happen on consecutive days to be a
   * transgression. Retracing one's steps on the same day is fine. So is
   * doing so with a full day in between."
   *
   * So the test is day N-1 EXACTLY. Same day is fine and two days is fine;
   * only the consecutive case counts.
   *
   * Measured on the ARRIVAL day of the earlier visit, because "where were
   * they on day N-1" is a question about where they ended up, not where they
   * set out from.
   *
   * NOTE ON SENSITIVITY. The book says "encounter area"; the default here is
   * LOCATION, which is deliberately finer-grained and will fire more often.
   * That is a chosen setting, not an oversight -- don't "correct" it to areas
   * without changing the setting's default too.
   *
   * Returns null when it doesn't apply, so callers can treat any object as a
   * hit. Never guesses: an arrival with no day at all can't be compared, and
   * returns null rather than assuming.
   */
  checkBacktrack({ toSlug, arrivalDay, ignoreEntryId = null, groupId = null }) {
    if (TravelHistory.sensitivity() === 'off') return null;
    if (!toSlug || arrivalDay == null) return null;

    const previousDay = arrivalDay - 1;

    // Per-area grouping compares the AREA each location belongs to, so
    // moving between two places in the same area and back doesn't count.
    // Falls back to per-location when the module hasn't supplied the map --
    // matching nothing at all would be a silent no-op, which is worse.
    const byArea = TravelHistory.sensitivity() === 'area'
      && Object.keys(LOCATION_AREAS).length > 0;
    const key = (slug) => (byArea ? (LOCATION_AREAS[slug] ?? slug) : slug);
    const wanted = key(toSlug);

    // Scoped to the group that walked it. The woods notice a party returning
    // to a place THEY were yesterday -- another group having been there is
    // somebody else's business, and matching on it would fire constantly
    // once the party splits.
    //
    // Legs recorded before groups existed have no groupId; those are treated
    // as belonging to whichever group is asking, since at the time there was
    // only one.
    const sameGroup = (m) => !groupId || !m.groupId || m.groupId === groupId;

    const prior = TravelHistory.moves().find(m =>
      m.id !== ignoreEntryId
      && m.toSlug
      && sameGroup(m)
      && key(m.toSlug) === wanted
      && m.day === previousDay
    );
    if (!prior) return null;

    return { priorEntry: prior, lastVisitDay: previousDay, toSlug, byArea };
  },

  /**
   * Announce a backtrack.
   *
   * The players ALWAYS see the same line, whether or not the GM then applies
   * the transgression -- worded identically either way, so nobody can work
   * out the GM's decision from the wording. Same reasoning as the damping
   * code's care over tiered stir messages.
   */
  async announceBacktrack(hit, { title, region } = {}) {
    if (!hit) return;

    const place = title || hit.priorEntry?.toTitle || 'this place';

    await ChatMessage.create({
      content: `<div class="transgression-message player-ominous">
        <i class="fas fa-tree"></i>
        This place recognises you. One should not let the Woods become too
        familiar with them&hellip;
      </div>`,
      flags: { 'darkest-system': { backtrack: true } },
    });

    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    if (!gmIds.length) return;

    const regionSlug = region || TransgressionTracker.getCurrentRegion() || '';
    await ChatMessage.create({
      whisper: gmIds,
      content: `<div class="transgression-message backtrack-prompt">
        <div class="backtrack-head"><i class="fas fa-shoe-prints"></i> The same path, two days running.</div>
        <p>The party returned to <strong>${place}</strong>, where they were on
        <strong>Day ${hit.lastVisitDay}</strong>. The book counts that as a transgression.</p>
        <p class="hint">The players have already seen the woods take notice — applying this is your call.</p>
        <div class="backtrack-actions">
          <button type="button" class="backtrack-apply" data-region="${regionSlug}">
            <i class="fas fa-tree"></i> Apply transgression
          </button>
          <button type="button" class="backtrack-dismiss">
            <i class="fas fa-times"></i> Let it pass
          </button>
        </div>
      </div>`,
      flags: { 'darkest-system': { backtrackPrompt: true } },
    });
  },

  /**
   * Record a leg by hand.
   *
   * For travel that happened away from the table, or to correct the record.
   * Resolution goes through TravelTool._resolveLocation so a typed name is
   * matched exactly the way the travel tool matches it -- a second, subtly
   * different resolver would be worse than none. Imported lazily because
   * travel-clock.mjs imports this file, and a static import would close the
   * cycle at module-evaluation time.
   */
  async addMoveDialog(existing = null) {
    if (!game.user.isGM) return;

    const { TravelTool, TravelClock, TRAVEL_ROUTES } = await import('./travel-clock.mjs');
    const locations = TravelClock.allLocations();
    const editing = !!existing;
    const datalist = locations
      .map(l => `<option value="${foundry.utils.escapeHTML?.(l.title) ?? l.title}"></option>`)
      .join('');
    const clock = TravelClock.getClock();
    // Editing prefills from the entry; adding prefills from the clock, which
    // is nearly always the day the GM means.
    const pre = {
      from: existing?.fromTitle ?? '',
      to: existing?.toTitle ?? '',
      day: existing?.departDay ?? existing?.day ?? clock.day,
      departTime: existing?.departTime ?? TravelClock.formatTime(clock.minutes),
      arriveTime: existing?.time ?? TravelClock.formatTime(clock.minutes),
      label: existing?.label ?? '',
    };
    const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');

    const content = `<form class="darkest-dialog manual-move">
      <p class="notes">${editing ? 'Correcting a leg. Changing the day or times re-sorts it into place.' : 'For travel that happened away from the table, or to fix the record.'}</p>
      <div class="form-row">
        <div class="form-group">
          <label>From</label>
          <input type="text" name="from" list="manual-move-locations" autocomplete="off" placeholder="type to search…" value="${esc(pre.from)}" />
        </div>
        <div class="form-group">
          <label>To</label>
          <input type="text" name="to" list="manual-move-locations" autocomplete="off" placeholder="type to search…" value="${esc(pre.to)}" />
        </div>
      </div>
      <datalist id="manual-move-locations">${datalist}</datalist>
      <div class="form-row">
        <div class="form-group">
          <label>Day</label>
          <input type="number" name="day" value="${pre.day}" min="1" />
        </div>
        <div class="form-group">
          <label>Departed</label>
          <input type="time" name="departTime" value="${pre.departTime}" />
        </div>
        <div class="form-group">
          <label>Arrived</label>
          <input type="time" name="arriveTime" value="${pre.arriveTime}" />
        </div>
      </div>
      <div class="form-group">
        <label>Route</label>
        <input type="text" name="label" value="${esc(pre.label)}" placeholder="e.g. Trail to the North — filled in automatically if known" />
      </div>
    </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: editing ? 'Edit this leg' : 'Add a leg by hand',
        content,
        buttons: {
          add: {
            icon: `<i class="fas fa-${editing ? 'check' : 'plus'}"></i>`,
            label: editing ? 'Save' : 'Add',
            callback: async (html) => {
              const from = TravelTool._resolveLocation(html.find('[name="from"]').val());
              const to = TravelTool._resolveLocation(html.find('[name="to"]').val());
              if (!to) {
                ui.notifications.warn('Give at least a destination that matches a known location.');
                return resolve(false);
              }

              const day = Math.max(1, parseInt(html.find('[name="day"]').val()) || 1);
              const departTime = html.find('[name="departTime"]').val() || '';
              const arriveTime = html.find('[name="arriveTime"]').val() || '';

              // A negative gap means they walked through midnight, which is
              // exactly the sort of trip somebody records after the fact --
              // so roll the day over rather than rejecting it.
              const toMin = (t) => {
                const m = /^(\d{1,2}):(\d{2})$/.exec(t);
                return m ? Number(m[1]) * 60 + Number(m[2]) : null;
              };
              const d = toMin(departTime), a = toMin(arriveTime);
              let arriveDay = day;
              let minutes = null;
              if (d !== null && a !== null) {
                minutes = a - d;
                if (minutes < 0) { minutes += 1440; arriveDay = day + 1; }
              }

              const route = TRAVEL_ROUTES.find(r => r.fromSlug === from && r.toSlug === to);
              const label = html.find('[name="label"]').val()?.trim() || route?.label || '';

              const titleOf = (slug) => locations.find(l => l.slug === slug)?.title || null;

              const fields = {
                fromSlug: from || null,
                fromTitle: titleOf(from),
                toSlug: to,
                toTitle: titleOf(to),
                label,
                minutes,
                km: route?.km ?? null,
                departDay: day,
                departTime,
                day: arriveDay,
                time: arriveTime,
                manual: true,
              };

              if (editing) {
                // Region is deliberately not touched on an edit: it records
                // the ground crossed at the time, which a correction to the
                // times doesn't change.
                await SessionLog.updateEntry(existing.id, fields);
              } else {
                await SessionLog.recordMove({ ...fields, region: null });
              }

              // Correcting the record should surface the rule too -- a leg
              // added or re-dated after the fact can be exactly the one that
              // backtracks. Its own id is excluded so an edit can't match
              // itself.
              await TravelHistory.checkAndAnnounce({
                toSlug: to,
                toTitle: titleOf(to),
                arrivalDay: arriveDay,
                ignoreEntryId: existing?.id ?? null,
              });

              SessionLog.refresh();
              resolve(true);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(false),
          },
        },
        default: 'add',
      }, { width: 460 }).render(true);
    });
  },

  /**
   * Check an arrival and announce it if it counts. The single entry point --
   * called after travelling, and after a leg is added by hand.
   */
  async checkAndAnnounce({ toSlug, toTitle, arrivalDay, region, ignoreEntryId, groupId }) {
    if (!game.user.isGM) return null;
    const hit = TravelHistory.checkBacktrack({ toSlug, arrivalDay, ignoreEntryId, groupId });
    if (!hit) return null;
    await TravelHistory.announceBacktrack(hit, { title: toTitle, region });
    return hit;
  },
};

export function registerTravelHistorySettings() {
  game.settings.register('darkest-system', SETTING_BACKTRACK, {
    name: 'Backtracking transgressions',
    hint: 'The woods notice a path walked two days running. The book counts this per encounter AREA; per LOCATION is finer-grained and fires more often. The players always see the woods take notice — applying the transgression is always your call.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      location: 'Per location (more sensitive)',
      area: 'Per area (as the book has it)',
      off: 'Off',
    },
    default: 'location',
  });
}
