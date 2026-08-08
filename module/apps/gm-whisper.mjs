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
    const players = GmWhisperTool.getPlayerUsers().map(u => ({
      id: u.id,
      name: u.character?.name || u.name,
      color: u.color
    }));
    return {
      players,
      hasPlayers: players.length > 0
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[name="whisperText"]').on('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        html.find('.whisper-random-btn').trigger('click');
      }
    });

    html.find('.whisper-player-btn').click((ev) => {
      const userId = ev.currentTarget.dataset.userId;
      this._sendWhisper(userId, html);
    });

    html.find('.whisper-random-btn').click(() => {
      const players = GmWhisperTool.getPlayerUsers();
      if (!players.length) {
        ui.notifications.warn('No connected players to whisper to.');
        return;
      }
      const chosen = players[Math.floor(Math.random() * players.length)];
      this._sendWhisper(chosen.id, html);
    });
  }

  async _sendWhisper(userId, html) {
    const text = html.find('[name="whisperText"]').val()?.trim();
    if (!text) {
      ui.notifications.warn('Enter a message to whisper first.');
      return;
    }
    const targetUser = game.users.get(userId);
    if (!targetUser) return;

    await ChatMessage.create({
      content: `<div class="darkest-gm-whisper"><i class="fas fa-eye"></i> ${text}</div>`,
      whisper: [userId],
      speaker: { alias: 'GM' }
    });

    game.socket.emit('system.darkest-system', {
      type: 'gmWhisperAlert',
      userId,
      content: text
    });

    ui.notifications.info(`Whispered to ${targetUser.character?.name || targetUser.name}.`);
    html.find('[name="whisperText"]').val('').focus();
  }
}
