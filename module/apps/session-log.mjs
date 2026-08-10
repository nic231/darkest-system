/**
 * GM-only session log: where the party went, and how the dice treated them.
 *
 * Two things the GM can't reconstruct after the fact from chat scrollback:
 *
 *   1. **Movement.** Public travel messages deliberately never name the
 *      destination ("The party takes the north trail"), because the players
 *      don't know where they're going until they arrive. That's right for
 *      chat and useless for drawing the map afterwards, so movement is
 *      recorded here with real location names.
 *
 *   2. **Dice.** Whether the party is being ground down or breezing through
 *      is invisible in the moment and obvious in aggregate.
 *
 * Everything is stored in a world setting the GM alone can read.
 */

const SETTING_LOG = 'sessionLog';
const MAX_ENTRIES = 2000;  // ~20 sessions; trims oldest first

export class SessionLog extends Application {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'darkest-session-log',
      title: 'Session Log',
      template: 'systems/darkest-system/templates/apps/session-log.hbs',
      classes: ['darkest-system', 'session-log'],
      width: 620,
      height: 640,
      resizable: true,
      tabs: [{ navSelector: '.log-tabs', contentSelector: '.log-body', initial: 'movement' }]
    });
  }

  // ── Storage ───────────────────────────────────────────────────────────

  static getLog() {
    return game.settings.get('darkest-system', SETTING_LOG) || { entries: [] };
  }

  /**
   * Append an entry. GM-authored only: players' clients must not write here
   * (they'd race each other and the setting is GM-scoped anyway), so a
   * player rolling dice delegates via the socket, same as everything else.
   */
  static async record(entry) {
    if (!game.user.isGM) return;
    const log = SessionLog.getLog();
    log.entries.push({ t: Date.now(), ...entry });
    if (log.entries.length > MAX_ENTRIES) {
      log.entries = log.entries.slice(-MAX_ENTRIES);
    }
    await game.settings.set('darkest-system', SETTING_LOG, log);
    SessionLog.refresh();
  }

  static async clear() {
    if (!game.user.isGM) return;
    await game.settings.set('darkest-system', SETTING_LOG, { entries: [] });
    SessionLog.refresh();
  }

  static refresh() {
    Object.values(ui.windows)
      .filter(w => w instanceof SessionLog)
      .forEach(w => w.render(false));
  }

  // ── Recording helpers, called from the rest of the system ─────────────

  /** The party moved. Records real names -- this is the map data. */
  static recordMove({ fromTitle, toTitle, label, minutes, region, day, time, pace }) {
    return SessionLog.record({
      kind: 'move', fromTitle, toTitle, label, minutes, region, day, time, pace
    });
  }

  /** An action roll resolved. */
  static recordRoll({ who, characterRating, taskRating, target, total, darkestDie, outcome }) {
    return SessionLog.record({
      kind: 'roll', who, characterRating, taskRating, target, total, darkestDie, outcome
    });
  }

  /** A transgression fired. */
  static recordTransgression({ region, level, witch }) {
    return SessionLog.record({ kind: 'transgression', region, level, witch });
  }

  // ── Display ───────────────────────────────────────────────────────────

  getData() {
    const entries = SessionLog.getLog().entries;
    const moves = entries.filter(e => e.kind === 'move');
    const rolls = entries.filter(e => e.kind === 'roll');
    const transgressions = entries.filter(e => e.kind === 'transgression');

    return {
      hasAny: entries.length > 0,
      moves: SessionLog._formatMoves(moves),
      moveCount: moves.length,
      route: SessionLog._routeSummary(moves),
      stats: SessionLog._rollStats(rolls),
      rollCount: rolls.length,
      transgressions: transgressions.map(t => ({
        region: t.region, level: t.level, witch: t.witch,
        when: SessionLog._clock(t)
      })).reverse(),
      transgressionCount: transgressions.length
    };
  }

  static _clock(e) {
    const d = new Date(e.t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  static _formatMoves(moves) {
    return moves.map((m, i) => ({
      index: i + 1,
      from: m.fromTitle || '—',
      to: m.toTitle || '—',
      label: m.label || '',
      duration: m.minutes ? SessionLog._dur(m.minutes) : '—',
      gameTime: m.day ? `Day ${m.day}, ${m.time}` : '',
      pace: m.pace && m.pace !== 'normal' ? m.pace : '',
      when: SessionLog._clock(m)
    })).reverse();
  }

  static _dur(mins) {
    const m = Math.round(mins);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  /**
   * The path walked, deduplicated into an ordered chain of place names --
   * the thing you'd actually trace onto a map.
   */
  static _routeSummary(moves) {
    const chain = [];
    for (const m of moves) {
      if (!chain.length && m.fromTitle) chain.push(m.fromTitle);
      if (m.toTitle && chain[chain.length - 1] !== m.toTitle) chain.push(m.toTitle);
    }
    const visits = {};
    chain.forEach(c => { visits[c] = (visits[c] || 0) + 1; });
    return {
      chain,
      chainText: chain.join('  →  '),
      distinct: Object.keys(visits).length,
      revisited: Object.entries(visits)
        .filter(([, n]) => n > 1)
        .map(([name, n]) => `${name} (${n}×)`)
    };
  }

  /** Aggregate dice stats, overall and per character. */
  static _rollStats(rolls) {
    if (!rolls.length) return null;

    const tally = (list) => {
      const out = { total: list.length, success: 0, partial: 0, failure: 0 };
      for (const r of list) {
        const o = (r.outcome || '').toLowerCase();
        if (o.includes('partial')) out.partial++;
        else if (o.includes('success')) out.success++;
        else out.failure++;
      }
      out.successPct = Math.round(100 * out.success / out.total);
      out.partialPct = Math.round(100 * out.partial / out.total);
      out.failurePct = Math.round(100 * out.failure / out.total);
      return out;
    };

    const byWho = {};
    for (const r of rolls) {
      const who = r.who || 'Unknown';
      (byWho[who] ??= []).push(r);
    }

    // Darkest Die distribution -- a 1 is what wakes the witch, so the
    // count of 1s is the number the GM actually cares about.
    const dd = Array.from({ length: 6 }, (_, i) => ({
      face: i + 1,
      count: rolls.filter(r => r.darkestDie === i + 1).length
    }));
    const ddMax = Math.max(1, ...dd.map(d => d.count));
    dd.forEach(d => { d.pct = Math.round(100 * d.count / ddMax); });

    const ratings = {};
    for (const r of rolls) {
      if (r.taskRating == null) continue;
      const k = r.taskRating;
      (ratings[k] ??= { taskRating: k, count: 0, success: 0 });
      ratings[k].count++;
      if ((r.outcome || '').toLowerCase().includes('success')
          && !(r.outcome || '').toLowerCase().includes('partial')) {
        ratings[k].success++;
      }
    }

    return {
      overall: tally(rolls),
      byCharacter: Object.entries(byWho)
        .map(([who, list]) => ({ who, ...tally(list) }))
        .sort((a, b) => b.total - a.total),
      darkestDie: dd,
      onesRolled: dd[0].count,
      byTaskRating: Object.values(ratings)
        .sort((a, b) => a.taskRating - b.taskRating)
        .map(r => ({ ...r, successPct: Math.round(100 * r.success / r.count) }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('.log-clear').click(async () => {
      const ok = await Dialog.confirm({
        title: 'Clear session log',
        content: '<p>Delete every recorded movement and roll? This cannot be undone.</p>',
        defaultYes: false
      });
      if (ok) await SessionLog.clear();
    });

    html.find('.log-export').click(() => this._export());
  }

  /** Dump the log as Markdown, for pasting into notes or a map tool. */
  _export() {
    const { moves, route, stats, transgressions } = this.getData();
    const lines = ['# Darkest Woods — session log', ''];

    if (route.chain.length) {
      lines.push('## Path walked', '', route.chainText, '');
      if (route.revisited.length) {
        lines.push(`**Revisited:** ${route.revisited.join(', ')}`, '');
        lines.push('_Retracing the same path on consecutive days is a transgression._', '');
      }
    }

    if (moves.length) {
      lines.push('## Movements', '', '| # | From | To | Route | Took | Game time |', '|---|---|---|---|---|---|');
      // moves arrives newest-first for display; export reads better forwards
      [...moves].reverse().forEach(m => {
        lines.push(`| ${m.index} | ${m.from} | ${m.to} | ${m.label} | ${m.duration} | ${m.gameTime} |`);
      });
      lines.push('');
    }

    if (stats) {
      lines.push('## Dice', '');
      lines.push(`Rolls: **${stats.overall.total}** — `
        + `${stats.overall.success} success (${stats.overall.successPct}%), `
        + `${stats.overall.partial} partial, `
        + `${stats.overall.failure} failure (${stats.overall.failurePct}%)`, '');
      lines.push('| Character | Rolls | Success | Partial | Failure |', '|---|---|---|---|---|');
      stats.byCharacter.forEach(c => {
        lines.push(`| ${c.who} | ${c.total} | ${c.success} (${c.successPct}%) | ${c.partial} | ${c.failure} |`);
      });
      lines.push('', `Darkest Die 1s rolled: **${stats.onesRolled}**`, '');
    }

    if (transgressions.length) {
      lines.push('## Transgressions', '');
      [...transgressions].reverse().forEach(t => {
        lines.push(`- ${t.region} → level ${t.level}${t.witch ? ` (${t.witch})` : ''}`);
      });
    }

    const text = lines.join('\n');
    // A dialog with the text selectable beats a file download: the GM is
    // usually pasting this straight into their own notes.
    new Dialog({
      title: 'Session log — copy this',
      content: `<textarea class="log-export-text" rows="20" style="width:100%;font-family:monospace;font-size:11px;">${foundry.utils.escapeHTML(text)}</textarea>`,
      buttons: {
        copy: {
          icon: '<i class="fas fa-copy"></i>',
          label: 'Copy to clipboard',
          callback: () => {
            game.clipboard.copyPlainText(text);
            ui.notifications.info('Session log copied.');
          }
        },
        close: { icon: '<i class="fas fa-times"></i>', label: 'Close' }
      },
      default: 'copy'
    }, { width: 640 }).render(true);
  }
}

export function registerSessionLog() {
  game.settings.register('darkest-system', SETTING_LOG, {
    name: 'Session Log',
    scope: 'world',
    config: false,
    type: Object,
    default: { entries: [] }
  });
}
