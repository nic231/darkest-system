/**
 * Restore travel from a session log markdown export.
 *
 * WHY THIS HAS TO EXIST
 *
 * The chat history in the content module can rebuild rolls, transgressions and
 * wounds, because each of those posts a chat card carrying its own numbers.
 * Travel cannot: the public travel message deliberately never names the
 * destination ("The party takes the north trail"), because the players do not
 * know where they are going until they arrive. That is right for chat and
 * means the chat export holds no movement at all.
 *
 * So the session log is the ONLY record of the route -- and clearing the log
 * destroys it with no way back, which is exactly what happened. The markdown
 * export is the other copy, and it has everything needed: from, to, route
 * label, duration, and both ends of the game clock.
 *
 * This parses that table back into move entries. It is a recovery tool, not
 * part of the normal flow.
 */

import { SessionLog, ROUTE_HISTORY } from './session-log.mjs';
import { MAP_DATA } from './route-map.mjs';

/** Marks what this wrote, so a re-run replaces rather than duplicates. */
const TAG = 'movement-import';

/**
 * "Day 1, 11:57 → 11:58" or "Day 1, 19:15 → Day 2, 03:15".
 *
 * The second day is optional and only appears when the leg crosses midnight,
 * which is why it cannot simply be split on the arrow.
 */
function parseGameTime(cell) {
  const s = String(cell || '').replace(/→/g, '->').trim();
  const m = /^Day\s+(\d+),\s*(\d{1,2}:\d{2})\s*->\s*(?:Day\s+(\d+),\s*)?(\d{1,2}:\d{2})$/.exec(s);
  if (!m) return null;
  const departDay = Number(m[1]);
  return {
    departDay,
    departTime: m[2],
    day: m[3] ? Number(m[3]) : departDay,
    time: m[4],
  };
}

/** "1m", "2h", "2h 30m", "8h", "3h 15m" -> minutes. */
function parseTook(cell) {
  const s = String(cell || '').trim();
  if (!s || s === '—' || s === '-') return 0;
  let total = 0;
  const h = /(\d+)\s*h/.exec(s);
  const mm = /(\d+)\s*m/.exec(s);
  if (h) total += Number(h[1]) * 60;
  if (mm) total += Number(mm[1]);
  return total;
}

/**
 * Turn a printed title back into its slug.
 *
 * Pins carry coordinates only -- no title -- so there is nothing to match
 * against and the title has to be transformed. Two wrinkles make a naive
 * slugify insufficient:
 *
 *   - Typographic apostrophes. "Glory’s Cabin" -> glorys-cabin.
 *   - A leading "The" that the slug keeps and the printed title drops:
 *     "Glade of the Taken" is the-glade-of-the-taken, "Cave Mouth" is
 *     the-cave-mouth. Four of the twenty-four rows in a real export hit this.
 *
 * So both forms are tried, and the result is checked against the real slug
 * set rather than trusted -- an unknown place is reported, never guessed.
 */
function slugFor(title, mapData) {
  if (!title) return null;
  const known = new Set();
  for (const map of Object.values(mapData?.maps || {})) {
    for (const slug of Object.keys(map.pins || {})) known.add(slug);
  }

  const slugify = (t) => String(t).toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // "Glory's Cabin Map" is how a stay on a location's own sub-map is printed.
  const candidates = [];
  const push = (t) => {
    const base = slugify(t);
    if (!base) return;
    candidates.push(base);
    if (!base.startsWith('the-')) candidates.push('the-' + base);
    else candidates.push(base.replace(/^the-/, ''));
  };
  push(title);
  push(String(title).replace(/\s+Map$/i, ''));

  for (const c of candidates) if (known.has(c)) return c;
  return null;
}

export const MovementImport = {
  /**
   * Parse the Movements table out of an exported log.
   *
   * Returns rows in table order. Anything unparseable is reported rather than
   * silently dropped -- a half-restored route is worse than a refusal, because
   * it looks complete.
   */
  parse(markdown, mapData) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const rows = [];
    const problems = [];

    let inTable = false;
    for (const line of lines) {
      const t = line.trim();
      if (/^\|\s*#\s*\|\s*From\s*\|/i.test(t)) { inTable = true; continue; }
      if (inTable && !t.startsWith('|')) break;          // table ended
      if (!inTable) continue;
      if (/^\|[\s|:-]+\|$/.test(t)) continue;            // the ---|--- rule

      const cells = t.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 6) continue;
      const [num, from, to, route, took, when] = cells;
      if (!/^\d+$/.test(num)) continue;

      const clock = parseGameTime(when);
      if (!clock) { problems.push(`row ${num}: cannot read "${when}"`); continue; }

      // "—" in the To column is how a stay is printed: the party did not go
      // anywhere, they waited where they were.
      const isStay = !to || to === '—' || to === '-' || /^waited$/i.test(route);
      const fromSlug = slugFor(from, mapData);
      const toSlug = isStay ? fromSlug : slugFor(to, mapData);

      if (!fromSlug) { problems.push(`row ${num}: unknown place "${from}"`); continue; }
      if (!toSlug) { problems.push(`row ${num}: unknown place "${to}"`); continue; }

      rows.push({
        n: Number(num),
        stay: isStay,
        fromSlug, fromTitle: from.replace(/\s+Map$/, ''),
        toSlug, toTitle: (isStay ? from : to).replace(/\s+Map$/, ''),
        label: isStay ? '' : route,
        minutes: parseTook(took),
        ...clock,
      });
    }
    return { rows, problems };
  },

  /** Is there a saved route in the content module? */
  get available() {
    return ROUTE_HISTORY.length > 0;
  },

  /**
   * Restore the route the content module carries -- no pasting.
   *
   * The module's rows are already in the shape parse() produces, except that
   * their places are titles. They go through the same slug resolution, so an
   * unknown place is reported here too rather than written as a phantom stop.
   */
  async applySaved({ mapData, dryRun = false } = {}) {
    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can restore movement.');
      return null;
    }
    if (!ROUTE_HISTORY.length) {
      ui.notifications.warn('No saved route in the content module. Export a session log and run build_route_history.py.');
      return null;
    }
    const data = mapData ?? MAP_DATA;
    const rows = [];
    const problems = [];
    for (const r of ROUTE_HISTORY) {
      const fromSlug = slugFor(r.from, data);
      const toSlug = r.stay ? fromSlug : slugFor(r.to, data);
      if (!fromSlug) { problems.push(`row ${r.n}: unknown place "${r.from}"`); continue; }
      if (!toSlug) { problems.push(`row ${r.n}: unknown place "${r.to}"`); continue; }
      rows.push({
        n: r.n, stay: !!r.stay,
        fromSlug, fromTitle: String(r.from).replace(/\s+Map$/i, ''),
        toSlug, toTitle: String(r.stay ? r.from : r.to).replace(/\s+Map$/i, ''),
        label: r.label || '',
        minutes: r.minutes || 0,
        departDay: r.departDay, departTime: r.departTime,
        day: r.day, time: r.time,
      });
    }
    if (dryRun) return { rows: rows.length, problems };
    return MovementImport._write(rows, problems);
  },

  /**
   * Write the parsed rows into the session log.
   *
   * Idempotent: anything a previous run wrote is removed first, so a corrected
   * export can simply be pasted again.
   */
  async apply(markdown, { mapData, dryRun = false } = {}) {
    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can import movements.');
      return null;
    }
    const data = mapData ?? MAP_DATA;
    const { rows, problems } = MovementImport.parse(markdown, data);

    if (!rows.length) {
      ui.notifications.error('No movements found. Paste the whole exported log, including its Movements table.');
      return { rows: 0, problems };
    }
    if (dryRun) return { rows: rows.length, problems };
    return MovementImport._write(rows, problems);
  },

  /** The shared write, used by both the pasted and the saved route. */
  async _write(rows, problems = []) {
    const removed = await SessionLog.remove(e => e.importTag === TAG);

    // Ordered `t` values a second apart, ending now. The credits bracket rolls
    // against `t`, so the legs must at least run in the right order; the game
    // clock in `day`/`time` is what actually places them.
    const base = Date.now() - rows.length * 1000;
    for (const [i, r] of rows.entries()) {
      await SessionLog.record({
        kind: 'move',
        importTag: TAG,
        t: base + i * 1000,
        stay: r.stay,
        fromSlug: r.fromSlug, fromTitle: r.fromTitle,
        toSlug: r.toSlug, toTitle: r.toTitle,
        label: r.label,
        minutes: r.minutes,
        km: 0,
        day: r.day, time: r.time,
        departDay: r.departDay, departTime: r.departTime,
        manual: true,
      });
    }

    SessionLog.refresh();
    const note = problems.length ? ` ${problems.length} row(s) skipped.` : '';
    ui.notifications.info(
      `Restored ${rows.length} movement${rows.length === 1 ? '' : 's'}` +
      `${removed ? `, replacing ${removed}` : ''}.${note}`);
    if (problems.length) console.warn('darkest-system | movement import', problems);
    return { rows: rows.length, removed, problems };
  },

  /** Remove everything this wrote. */
  async remove() {
    if (!game.user.isGM) return null;
    const removed = await SessionLog.remove(e => e.importTag === TAG);
    ui.notifications.info(`Removed ${removed} imported movement(s).`);
    return { removed };
  },
};
