/**
 * The wood folk tokens and the birdsongs the party has collected.
 *
 * Two badges stacked above the doom badge, in the same column of screen
 * furniture. Both show what the party HAS, never what it might get -- the
 * birdsong list in particular is a spoiler surface: there are seven symbols
 * and they map onto two hidden exit paths, so showing the unearned ones would
 * tell the players both how many remain and that the paths exist at all.
 *
 * Only the GM can change either. Everyone can see them: the tokens are
 * physical props the party holds, and a birdsong they have learned is theirs.
 */

const SYS = 'darkest-system';
const ART = 'modules/darkest-woods/assets/images/artwork';

/**
 * The seven birdsong symbols, in the book's own numbering.
 *
 * Kept in that order rather than in path order on purpose: the two Birdsong
 * Paths are (Pine Warbler, Mourning Dove, Marsh Owl) and (Cardinal, Grackle,
 * Nightingale), so listing them grouped by path would hand the players the
 * routes as soon as they held two symbols. Book order tells them nothing.
 *
 * `img` is served from the CONTENT MODULE, which is where the artwork ships.
 * When the module is absent the badge falls back to the name alone rather
 * than showing a broken image -- see _symbolHtml.
 */
export const BIRDSONGS = [
  { key: 'woodthrush',   name: 'Wood Thrush',   img: `${ART}/Symbol-02-Birdsong-Woodthrush-1024x1024.png` },
  { key: 'cardinal',     name: 'Cardinal',      img: `${ART}/Symbol-03-Birdsong-Cardinal-1024x1024.png` },
  { key: 'pinewarbler',  name: 'Pine Warbler',  img: `${ART}/Symbol-04-Birdsong-Pine-Warbler-1024x1024.png` },
  { key: 'mourningdove', name: 'Mourning Dove', img: `${ART}/Symbol-05-Birdsong-Mourning-Dove-1024x1024.png` },
  { key: 'nightingale',  name: 'Nightingale',   img: `${ART}/Symbol-06-Birdsong-Nightingale-1024x1024.png` },
  { key: 'grackle',      name: 'Grackle',       img: `${ART}/Symbol-07-Birdsong-Grackle-1024x1024.png` },
  { key: 'marshowl',     name: 'Marsh Owl',     img: `${ART}/Symbol-08-Birdsong-Marsh-Owl-1024x1024.png` },
];

const WOODFOLK_IMG = `${ART}/woodfolk-token.png`;

const esc = (v) => foundry.utils.escapeHTML?.(String(v ?? '')) ?? String(v ?? '');

/* ----------------------------------------
   State
---------------------------------------- */

export const PartyTokens = {
  getWoodfolk() {
    return Math.max(0, Number(game.settings.get(SYS, 'woodfolkTokens')) || 0);
  },

  /** The birdsong keys the party holds, filtered to ones that still exist. */
  getBirdsongs() {
    const raw = game.settings.get(SYS, 'birdsongsHeld');
    const held = Array.isArray(raw) ? raw : [];
    // Filtered rather than trusted: a key left behind by an older version
    // would otherwise render as an empty slot with no symbol and no name.
    return BIRDSONGS.filter(b => held.includes(b.key));
  },

  async setWoodfolk(n) {
    if (!game.user.isGM) return;
    await game.settings.set(SYS, 'woodfolkTokens', Math.max(0, Math.round(Number(n) || 0)));
    PartyTokens.refresh();
  },

  async toggleBirdsong(key, on) {
    if (!game.user.isGM) return;
    const held = new Set(PartyTokens.getBirdsongs().map(b => b.key));
    if (on) held.add(key); else held.delete(key);
    // Stored in book order, so the setting never depends on click order.
    await game.settings.set(SYS, 'birdsongsHeld',
      BIRDSONGS.filter(b => held.has(b.key)).map(b => b.key));
    PartyTokens.refresh();
  },

  /**
   * Repaint here and everywhere else.
   *
   * game.socket.emit does NOT loop back, so the local render is called
   * directly rather than relying on the message coming home.
   */
  refresh() {
    renderPartyBadges();
    game.socket.emit(`system.${SYS}`, { type: 'partyTokensUpdate' });
  },
};

/* ----------------------------------------
   The badges
---------------------------------------- */

/**
 * Stack the two badges above the doom badge.
 *
 * They anchor to the doom badge when it is on screen and to the player list
 * when it is not, so switching the doom badge off leaves these where they
 * belong instead of floating over the roster. Same measuring approach as
 * positionDoomBadge -- a fixed offset works at an empty table and is covered
 * at a full one.
 */
function positionPartyBadges() {
  const doom = document.getElementById('darkest-doom-badge');
  const players = document.getElementById('players');
  const dial = document.getElementById('darkest-travel-dial');
  const clearOf = (n) => n ? n.offsetLeft + n.offsetWidth : 0;

  // Share the doom badge's left edge so the three read as one column. Without
  // the doom badge, clear whichever of the dial and the roster is wider --
  // the roster is the one that actually gets covered at a full table.
  const left = doom
    ? doom.offsetLeft
    : Math.max(clearOf(dial), clearOf(players), 4) + 8;

  // Bottom of the stack: just above the doom badge, or on the dial's baseline.
  let bottom = doom
    ? window.innerHeight - doom.offsetTop + 6
    : (dial ? Math.max(0, window.innerHeight - (dial.offsetTop + dial.offsetHeight)) : 12);

  // Wood folk first, then birdsongs above it -- the order the GM asked for,
  // and it puts the rarer, more secret row furthest from the roster.
  for (const id of ['darkest-woodfolk-badge', 'darkest-birdsong-badge']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.left = `${left}px`;
    el.style.bottom = `${bottom}px`;
    bottom += el.offsetHeight + 6;
  }
}

/** One symbol tile. Falls back to the name when the content module is absent. */
function _symbolHtml(b) {
  return `
    <div class="party-symbol" data-tooltip="${esc(b.name)}">
      <img src="${esc(b.img)}" alt="${esc(b.name)}"
           onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'party-symbol-fallback',textContent:'${esc(b.name)}'}))">
    </div>`;
}

export function renderPartyBadges() {
  if (!game.ready) return;

  const show = game.settings.get(SYS, 'showPartyBadges');
  const isGM = game.user.isGM;

  /* ── Wood folk ─────────────────────────────────────────────────────── */
  let wf = document.getElementById('darkest-woodfolk-badge');
  const tokens = PartyTokens.getWoodfolk();

  // Hidden when switched off, and -- for players only -- when the party has
  // none. A GM always keeps it, since that is where they set the number.
  if (!show || (!isGM && tokens <= 0)) {
    wf?.remove();
    wf = null;
  } else {
    if (!wf) {
      wf = document.createElement('div');
      wf.id = 'darkest-woodfolk-badge';
      document.body.appendChild(wf);
    }
    wf.className = `darkest-party-badge${tokens > 0 ? ' has-any' : ''}`;
    wf.title = isGM
      ? 'Wood folk tokens. Click to set how many the party has.'
      : 'Wood folk tokens the party has';

    wf.innerHTML = `
      <div class="party-total">
        <img class="party-token-img" src="${esc(WOODFOLK_IMG)}" alt="Wood folk token"
             onerror="this.style.display='none'">
        <div class="party-count">
          <span class="party-number">${tokens}</span>
          <span class="party-label">Wood Folk</span>
        </div>
      </div>`;

    // Rebound every render: innerHTML above replaces the children each time.
    if (isGM) {
      wf.classList.add('is-gm');
      wf.onclick = () => promptWoodfolk();
    } else {
      wf.onclick = null;
    }
  }

  /* ── Birdsongs ─────────────────────────────────────────────────────── */
  let bs = document.getElementById('darkest-birdsong-badge');
  const held = PartyTokens.getBirdsongs();

  // The spoiler rule: players only ever see the symbols the party has
  // EARNED. No empty slots, no count of what is missing, and nothing at all
  // until the first one is learned -- an empty badge would still announce
  // that birdsongs are a thing to collect.
  if (!show || (!isGM && !held.length)) {
    bs?.remove();
    bs = null;
  } else {
    if (!bs) {
      bs = document.createElement('div');
      bs.id = 'darkest-birdsong-badge';
      document.body.appendChild(bs);
    }
    bs.className = `darkest-party-badge${held.length ? ' has-any' : ''}`;
    bs.title = isGM
      ? 'Birdsongs the party has. Click to choose which.'
      : 'Birdsongs the party has learned';

    const symbols = held.length
      ? held.map(_symbolHtml).join('')
      : `<span class="party-empty">None yet</span>`;

    bs.innerHTML = `
      <div class="party-head">
        <i class="fas fa-music party-head-icon"></i>
        <span class="party-label">Birdsong</span>
      </div>
      <div class="party-symbols">${symbols}</div>`;

    if (isGM) {
      bs.classList.add('is-gm');
      bs.onclick = () => promptBirdsongs();
    } else {
      bs.onclick = null;
    }
  }

  positionPartyBadges();
}

/* ----------------------------------------
   The GM's dialogs
---------------------------------------- */

async function promptWoodfolk() {
  if (!game.user.isGM) return;
  const current = PartyTokens.getWoodfolk();

  const content = `
    <div class="darkest-token-prompt">
      <p>How many wood folk tokens does the party have?</p>
      <input type="number" name="tokens" min="0" step="1" value="${current}" autofocus>
    </div>`;

  const result = await Dialog.prompt({
    title: 'Wood Folk Tokens',
    content,
    label: 'Set',
    callback: (html) => {
      const el = html[0] ?? html;
      return Number(el.querySelector('input[name="tokens"]')?.value ?? current);
    },
    rejectClose: false,
  });
  if (result != null) await PartyTokens.setWoodfolk(result);
}

async function promptBirdsongs() {
  if (!game.user.isGM) return;
  const held = new Set(PartyTokens.getBirdsongs().map(b => b.key));

  const rows = BIRDSONGS.map(b => `
    <label class="darkest-birdsong-row">
      <input type="checkbox" name="${esc(b.key)}" ${held.has(b.key) ? 'checked' : ''}>
      <img src="${esc(b.img)}" alt="" onerror="this.style.display='none'">
      <span>${esc(b.name)}</span>
    </label>`).join('');

  const content = `
    <div class="darkest-birdsong-prompt">
      <p>Which birdsongs does the party have? Only these are shown to players.</p>
      ${rows}
    </div>`;

  const result = await Dialog.prompt({
    title: 'Birdsongs',
    content,
    label: 'Save',
    callback: (html) => {
      const el = html[0] ?? html;
      return BIRDSONGS
        .filter(b => el.querySelector(`input[name="${b.key}"]`)?.checked)
        .map(b => b.key);
    },
    rejectClose: false,
    options: { classes: ['darkest-system', 'dialog'] },
  });

  if (result == null) return;
  await game.settings.set(SYS, 'birdsongsHeld', result);
  PartyTokens.refresh();
}

/* ----------------------------------------
   Registration
---------------------------------------- */

export function registerPartyTokenSettings() {
  game.settings.register(SYS, 'woodfolkTokens', {
    name: 'Wood folk tokens',
    hint: 'How many wood folk tokens the party is carrying.',
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.register(SYS, 'birdsongsHeld', {
    name: 'Birdsongs held',
    hint: 'Which birdsongs the party has learned.',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
  });

  // Client-scoped, like showDoomBadge: where a player wants their screen
  // furniture is not a property of the world.
  game.settings.register(SYS, 'showPartyBadges', {
    name: 'Show wood folk tokens and birdsongs on screen',
    hint: 'Keeps them stacked above the doom count. Players only ever see what the party actually has.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => renderPartyBadges(),
  });
}

export function registerPartyTokenHooks() {
  game.socket.on(`system.${SYS}`, (data) => {
    if (data?.type === 'partyTokensUpdate') renderPartyBadges();
  });

  // The stack sits on top of the doom badge, which is itself repositioned
  // whenever the player list redraws. Deferring to the end of the frame lets
  // the doom badge move first, so these measure its settled position rather
  // than where it was last tick.
  Hooks.on('renderPlayerList', () => requestAnimationFrame(() => renderPartyBadges()));

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderPartyBadges(), 150);
  });

  requestAnimationFrame(() => renderPartyBadges());
}
