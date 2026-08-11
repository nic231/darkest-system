/**
 * GM Whisper Tool
 * Quick GM-only window for sending an attention-grabbing whisper to a
 * specific player, or a random one. Used for the frequent "the GM tells
 * this one player something in secret" moments the game calls for.
 *
 * The whisper is a normal Foundry ChatMessage (whisper: [userId]), plus a
 * socket ping telling that player's client to pop a dismissible dialog with
 * the same text -- a plain chat whisper is too easy to miss in a busy log.
 */

export class GmWhisperTool extends Application {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'gm-whisper-tool',
      title: 'Whisper to Player',
      template: 'systems/darkest-system/templates/apps/gm-whisper.hbs',
      classes: ['darkest-system', 'gm-whisper-tool'],
      width: 360,
      height: 'auto',
      resizable: false,
      minimizable: true,
      popOut: true
    });
  }

  /**
   * Connected, non-GM users with an owned character -- the actual pool of
   * people it makes sense to whisper secrets to.
   */
  static getPlayerUsers() {
    return game.users.filter(u => !u.isGM && u.active && u.character);
  }

  getData() {
    // Selection survives a re-render, and drops anyone who has since
    // disconnected so a stale id can't be whispered into the void.
    this._selected ??= new Set();
    const users = GmWhisperTool.getPlayerUsers();
    const live = new Set(users.map(u => u.id));
    for (const id of this._selected) if (!live.has(id)) this._selected.delete(id);

    const players = users.map(u => ({
      id: u.id,
      name: u.character?.name || u.name,
      color: u.color,
      selected: this._selected.has(u.id)
    }));
    return {
      players,
      hasPlayers: players.length > 0,
      selectedCount: this._selected.size,
      sendLabel: this._selected.size > 1
        ? `Whisper to ${this._selected.size} players`
        : 'Whisper'
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Re-render swaps the DOM out, so preserve what's being typed.
    const keepText = () => html.find('[name="whisperText"]').val();

    html.find('[name="whisperText"]').on('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        html.find('.whisper-send-btn').trigger('click');
      }
    });

    // Clicking a name selects rather than sends -- otherwise there's no way
    // to build a group without firing off a whisper per click.
    html.find('.whisper-player-btn').click((ev) => {
      const userId = ev.currentTarget.dataset.userId;
      if (this._selected.has(userId)) this._selected.delete(userId);
      else this._selected.add(userId);
      this._draft = keepText();
      this.render();
    });

    html.find('.whisper-select-all').click(() => {
      for (const u of GmWhisperTool.getPlayerUsers()) this._selected.add(u.id);
      this._draft = keepText();
      this.render();
    });

    html.find('.whisper-select-none').click(() => {
      this._selected.clear();
      this._draft = keepText();
      this.render();
    });

    html.find('.whisper-send-btn').click(() => {
      this._sendWhispers([...this._selected], html);
    });

    html.find('.whisper-random-btn').click(() => {
      const players = GmWhisperTool.getPlayerUsers();
      if (!players.length) {
        ui.notifications.warn('No connected players to whisper to.');
        return;
      }
      const chosen = players[Math.floor(Math.random() * players.length)];
      this._sendWhispers([chosen.id], html);
    });

    // Restore a draft that survived a selection re-render.
    if (this._draft) {
      html.find('[name="whisperText"]').val(this._draft);
      this._draft = null;
    }
  }

  /**
   * One private whisper per recipient.
   *
   * Deliberately NOT a single message addressed to several people: separate
   * copies mean nobody learns who else was told, which is the right default
   * when the party is each noticing something independently.
   */
  async _sendWhispers(userIds, html) {
    const text = html.find('[name="whisperText"]').val()?.trim();
    if (!text) {
      ui.notifications.warn('Enter a message to whisper first.');
      return;
    }
    const targets = userIds.map(id => game.users.get(id)).filter(Boolean);
    if (!targets.length) {
      ui.notifications.warn('Select at least one player to whisper to.');
      return;
    }

    for (const user of targets) {
      await ChatMessage.create({
        content: `<div class="darkest-gm-whisper"><i class="fas fa-eye"></i> ${text}</div>`,
        whisper: [user.id],
        speaker: { alias: 'GM' }
      });

      // The socket handler filters on userId, so one emit per recipient
      // pops the dialog only on that player's client.
      game.socket.emit('system.darkest-system', {
        type: 'gmWhisperAlert',
        userId: user.id,
        content: text
      });
    }

    const names = targets.map(u => u.character?.name || u.name);
    ui.notifications.info(
      names.length === 1
        ? `Whispered to ${names[0]}.`
        : `Whispered to ${names.length} players: ${names.join(', ')}.`
    );

    this._selected.clear();
    this._draft = null;
    this.render();
  }
}
