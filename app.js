/* ============================================================
   Verdа — calm notes & productivity
   Vanilla JS, localStorage-backed. No build step.
   ============================================================ */

(() => {
  'use strict';

  const STORE_KEY = 'verda.notes.v1';
  const PREF_KEY = 'verda.prefs.v1';
  const COLORS = ['paper', 'sage', 'mint', 'honey', 'clay', 'blush', 'sky', 'lilac'];

  // ---------- State ----------
  let notes = [];
  let prefs = { theme: 'light', layout: 'masonry' };
  let view = 'all';        // all | favorites | tasks | trash | tag:<name>
  let query = '';
  let openId = null;       // id of note open in editor
  let undo = null;         // { type, payload } for toast undo
  let toastTimer = null;

  // ---------- Elements ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const el = {
    app: $('#app'),
    board: $('#board'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    viewTitle: $('#viewTitle'),
    viewSub: $('#viewSub'),
    search: $('#search'),
    nav: $('#nav'),
    tagList: $('#tagList'),
    overlay: $('#editorOverlay'),
    editor: $('#editor'),
    editorTitle: $('#editorTitle'),
    editorText: $('#editorText'),
    checklist: $('#checklist'),
    swatches: $('#swatches'),
    tagChips: $('#tagChips'),
    tagInput: $('#tagInput'),
    editorMeta: $('#editorMeta'),
    pinBtn: $('#pinBtn'),
    taskToggleBtn: $('#taskToggleBtn'),
    deleteBtn: $('#deleteBtn'),
    toast: $('#toast'),
    toastMsg: $('#toastMsg'),
    toastAction: $('#toastAction'),
  };

  // ---------- Persistence ----------
  function load() {
    try { notes = JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { notes = []; }
    try { prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; }
    catch {}
    if (!notes.length) notes = seed();
  }
  const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(notes));
  const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Date.now();

  // ---------- Seed (first run) ----------
  function seed() {
    const t = now();
    return [
      {
        id: uid(), title: 'Welcome to Verdа 🌿', color: 'sage',
        body: "A calm place for your thoughts and to-dos.\n\n• Click + New note to begin\n• Pick a color to keep things cozy\n• Add #tags to stay organized\n• Star the notes you love\n\nEverything saves automatically to your browser.",
        tags: ['welcome'], pinned: true, isTask: false, checks: [],
        created: t, updated: t, trashed: false,
      },
      {
        id: uid(), title: 'Today’s focus', color: 'honey', isTask: true, body: '',
        checks: [
          { id: uid(), text: 'Morning pages — 3 lines', done: true },
          { id: uid(), text: 'Deep work block (90 min)', done: false },
          { id: uid(), text: 'Walk + tea break', done: false },
          { id: uid(), text: 'Tidy the desk', done: false },
        ],
        tags: ['routine'], pinned: false, created: t - 1, updated: t - 1, trashed: false,
      },
      {
        id: uid(), title: 'Cozy reading list', color: 'clay',
        body: "Books to sink into this season:\n\n— The Midnight Library\n— Four Thousand Weeks\n— A Psalm for the Wild-Built\n— Tomorrow, and Tomorrow, and Tomorrow",
        tags: ['ideas'], pinned: false, isTask: false, checks: [],
        created: t - 2, updated: t - 2, trashed: false,
      },
      {
        id: uid(), title: 'Little gratitudes', color: 'blush',
        body: "Sunlight through the window.\nThe first sip of coffee.\nA tidy inbox.\nQuiet mornings.",
        tags: ['journal'], pinned: false, isTask: false, checks: [],
        created: t - 3, updated: t - 3, trashed: false,
      },
      {
        id: uid(), title: 'Project: garden balcony', color: 'mint', isTask: true, body: '',
        checks: [
          { id: uid(), text: 'Pick up basil & mint', done: true },
          { id: uid(), text: 'Find ceramic pots', done: true },
          { id: uid(), text: 'Water schedule', done: false },
        ],
        tags: ['ideas', 'home'], pinned: false, created: t - 4, updated: t - 4, trashed: false,
      },
      {
        id: uid(), title: 'A quote I keep close', color: 'sky',
        body: "“How we spend our days is, of course, how we spend our lives.”\n\n— Annie Dillard",
        tags: ['journal'], pinned: false, isTask: false, checks: [],
        created: t - 5, updated: t - 5, trashed: false,
      },
    ];
  }

  // ---------- Helpers ----------
  function getNote(id) { return notes.find(n => n.id === id); }

  function noteText(n) {
    return [n.title, n.body, ...(n.checks || []).map(c => c.text), ...(n.tags || [])]
      .join(' ').toLowerCase();
  }

  function allTags() {
    const map = new Map();
    notes.filter(n => !n.trashed).forEach(n =>
      (n.tags || []).forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function visibleNotes() {
    let list = notes.slice();
    if (view === 'trash') list = list.filter(n => n.trashed);
    else list = list.filter(n => !n.trashed);

    if (view === 'favorites') list = list.filter(n => n.pinned);
    if (view === 'tasks') list = list.filter(n => n.isTask);
    if (view.startsWith('tag:')) {
      const tag = view.slice(4);
      list = list.filter(n => (n.tags || []).includes(tag));
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(n => noteText(n).includes(q));
    }
    // pinned first (except trash), then most recently updated
    list.sort((a, b) => {
      if (view !== 'trash' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updated - a.updated;
    });
    return list;
  }

  function relTime(ts) {
    const d = now() - ts, m = 60000, h = 3600000, day = 86400000;
    if (d < m) return 'just now';
    if (d < h) return Math.floor(d / m) + 'm ago';
    if (d < day) return Math.floor(d / h) + 'h ago';
    if (d < day * 7) return Math.floor(d / day) + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function esc(s) {
    return (s || '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Render: board ----------
  function render() {
    el.board.dataset.layout = prefs.layout;
    $$('.seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.layout === prefs.layout));

    renderNav();
    renderTags();
    renderHeader();

    const list = visibleNotes();
    if (!list.length) {
      el.board.innerHTML = '';
      showEmpty(true);
      return;
    }
    showEmpty(false);
    el.board.innerHTML = list.map(cardHTML).join('');
  }

  function showEmpty(on) {
    el.empty.hidden = !on;
    el.board.hidden = on;
    if (on) {
      const map = {
        all: ['Nothing here yet', 'Plant your first thought. It’ll grow.'],
        favorites: ['No favorites yet', 'Star a note to keep it close. ⭐'],
        tasks: ['No tasks yet', 'Turn any note into a checklist to track progress.'],
        trash: ['Trash is empty', 'Deleted notes will rest here.'],
      };
      let m = map[view] || ['No notes found', 'Try a different search or tag.'];
      if (query) m = ['No matches', `Nothing matches “${query}”.`];
      el.emptyTitle.textContent = m[0];
      el.emptyText.textContent = m[1];
      $('#emptyNew').hidden = view === 'trash';
    }
  }

  function cardHTML(n) {
    const color = n.color && n.color !== 'paper' ? ` data-color="${n.color}"` : '';
    const pin = n.pinned ? '<span class="card-pin">⭐</span>' : '';
    const title = n.title ? `<h3 class="card-title">${esc(n.title)}</h3>` : '';

    let content = '';
    if (n.isTask) {
      const checks = n.checks || [];
      const shown = checks.slice(0, 6);
      content = '<div class="card-checks">' + shown.map(c =>
        `<div class="card-check${c.done ? ' done' : ''}"><span class="box">${c.done ? '✓' : ''}</span><span>${esc(c.text)}</span></div>`
      ).join('') + '</div>';
      if (checks.length > 6) content += `<div class="card-more">+${checks.length - 6} more</div>`;
      const done = checks.filter(c => c.done).length;
      if (checks.length) {
        const pct = Math.round(done / checks.length * 100);
        content += `<div class="card-progress" title="${done}/${checks.length} done"><i style="width:${pct}%"></i></div>`;
      }
    } else if (n.body) {
      content = `<div class="card-body">${esc(n.body)}</div>`;
    }

    const tags = (n.tags || []).slice(0, 3).map(t => `<span class="card-tag">#${esc(t)}</span>`).join('');
    const foot = `<div class="card-foot">${tags}<span class="card-date">${relTime(n.updated)}</span></div>`;

    return `<article class="card"${color} data-id="${n.id}" tabindex="0" role="button">${pin}${title}${content}${foot}</article>`;
  }

  // ---------- Render: nav / tags / header ----------
  function renderNav() {
    const active = notes.filter(n => !n.trashed);
    const counts = {
      all: active.length,
      favorites: active.filter(n => n.pinned).length,
      tasks: active.filter(n => n.isTask).length,
      trash: notes.filter(n => n.trashed).length,
    };
    $$('.nav-item').forEach(b => {
      b.classList.toggle('is-active', b.dataset.view === view);
      const c = b.querySelector('.nav-count');
      if (c) c.textContent = counts[b.dataset.view] || '';
    });
  }

  function renderTags() {
    const tags = allTags();
    if (!tags.length) {
      el.tagList.innerHTML = '<div class="tag-empty">Add #tags to your notes</div>';
      return;
    }
    el.tagList.innerHTML = tags.map(([t, c]) =>
      `<button class="tag-pill${view === 'tag:' + t ? ' is-active' : ''}" data-tag="${esc(t)}">
        <span class="tag-dot" style="background:${tagColor(t)}"></span>
        <span>${esc(t)}</span><span class="nav-count">${c}</span>
      </button>`).join('');
  }

  function tagColor(t) {
    const palette = ['#84b194', '#7fa8c4', '#e3b873', '#c98a6b', '#d98c9a', '#a596c9', '#5e9173'];
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function renderHeader() {
    const titles = {
      all: ['All notes', 'Your calm little corner of thoughts.'],
      favorites: ['Favorites', 'The notes you’ve starred.'],
      tasks: ['Tasks', 'Checklists and things to get done.'],
      trash: ['Trash', 'Restore or clear what you no longer need.'],
    };
    let m = titles[view];
    if (view.startsWith('tag:')) m = ['#' + view.slice(4), 'Everything tagged this way.'];
    el.viewTitle.textContent = m[0];
    el.viewSub.textContent = m[1];
  }

  // ---------- Editor ----------
  function openEditor(id) {
    const n = getNote(id);
    if (!n) return;
    openId = id;

    el.editorTitle.value = n.title || '';
    el.editorText.value = n.body || '';
    el.editorText.hidden = !!n.isTask;
    el.checklist.hidden = !n.isTask;
    el.pinBtn.classList.toggle('is-on', !!n.pinned);
    el.taskToggleBtn.classList.toggle('is-on', !!n.isTask);
    el.editorMeta.textContent = 'Edited ' + relTime(n.updated);

    renderSwatches(n);
    renderTagChips(n);
    if (n.isTask) renderChecklist(n);

    el.overlay.hidden = false;
    requestAnimationFrame(() => {
      autoGrow(el.editorText);
      (n.title ? el.editorText : el.editorTitle).focus();
    });
  }

  function closeEditor() {
    if (openId == null) return;
    // discard fully-empty fresh notes
    const n = getNote(openId);
    if (n && !n.title.trim() && !n.body.trim() &&
        !(n.checks || []).some(c => c.text.trim()) && !(n.tags || []).length) {
      notes = notes.filter(x => x.id !== openId);
      save();
    }
    openId = null;
    el.overlay.hidden = true;
    render();
  }

  function touch() {
    const n = getNote(openId);
    if (n) { n.updated = now(); el.editorMeta.textContent = 'Edited just now'; save(); }
  }

  function renderSwatches(n) {
    el.swatches.innerHTML = COLORS.map(c =>
      `<button class="swatch${(n.color || 'paper') === c ? ' is-active' : ''}" data-color="${c}" title="${c}"></button>`
    ).join('');
  }

  function renderTagChips(n) {
    el.tagChips.innerHTML = (n.tags || []).map(t =>
      `<span class="chip">#${esc(t)}<button data-tag="${esc(t)}" title="Remove tag">×</button></span>`).join('');
  }

  function renderChecklist(n) {
    const rows = (n.checks || []).map(c =>
      `<div class="check-row${c.done ? ' done' : ''}" data-cid="${c.id}">
        <button class="check-box${c.done ? ' done' : ''}" data-act="toggle">${c.done ? '✓' : ''}</button>
        <input class="check-text" value="${esc(c.text)}" placeholder="List item" />
        <button class="check-del" data-act="del" title="Remove">×</button>
      </div>`).join('');
    el.checklist.innerHTML = rows +
      `<div class="check-add"><span class="plus">+</span><input id="checkAdd" placeholder="Add an item…" /></div>`;
  }

  // ---------- Actions ----------
  function createNote() {
    const n = {
      id: uid(), title: '', body: '', color: 'paper',
      tags: [], pinned: false, isTask: false, checks: [],
      created: now(), updated: now(), trashed: false,
    };
    notes.unshift(n);
    save();
    if (view === 'trash') setView('all');
    openEditor(n.id);
  }

  function toDay(ts) { return ts; }

  function trashNote(id) {
    const n = getNote(id);
    if (!n) return;
    n.trashed = true; n.updated = now(); n.pinned = false;
    save();
    showToast('Moved to trash', 'Undo', () => { n.trashed = false; n.updated = now(); save(); render(); });
  }

  function restoreNote(id) {
    const n = getNote(id);
    if (n) { n.trashed = false; n.updated = now(); save(); render(); showToast('Restored'); }
  }

  function deleteForever(id) {
    notes = notes.filter(n => n.id !== id);
    save(); render(); showToast('Deleted permanently');
  }

  function setView(v) {
    view = v;
    el.app.classList.remove('sidebar-open');
    render();
    el.board.scrollTop = 0;
  }

  // ---------- Toast ----------
  function showToast(msg, actionLabel, action) {
    clearTimeout(toastTimer);
    el.toastMsg.textContent = msg;
    el.toastAction.textContent = actionLabel || '';
    el.toast.hidden = false;
    el.toastAction.onclick = () => { if (action) action(); hideToast(); };
    toastTimer = setTimeout(hideToast, 4200);
  }
  function hideToast() { el.toast.hidden = true; clearTimeout(toastTimer); }

  // ---------- Misc UI ----------
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(240, ta.scrollHeight) + 'px';
  }

  function applyTheme() {
    document.documentElement.dataset.theme = prefs.theme;
  }

  // ---------- Events ----------
  function bind() {
    // New note
    $('#newNoteBtn').onclick = createNote;
    $('#emptyNew').onclick = createNote;

    // Sidebar nav
    el.nav.addEventListener('click', e => {
      const b = e.target.closest('.nav-item');
      if (b) setView(b.dataset.view);
    });
    el.tagList.addEventListener('click', e => {
      const b = e.target.closest('.tag-pill');
      if (b) setView('tag:' + b.dataset.tag);
    });

    // Search
    el.search.addEventListener('input', e => { query = e.target.value.trim(); render(); });

    // Layout segmented control
    $('#layoutSeg').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      prefs.layout = b.dataset.layout; savePrefs(); render();
    });

    // Theme
    $('#themeToggle').onclick = () => {
      prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
      savePrefs(); applyTheme();
    };

    // Mobile menu
    $('#menuBtn').onclick = () => el.app.classList.toggle('sidebar-open');

    // Board: open / quick-toggle check
    el.board.addEventListener('click', e => {
      const card = e.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      if (view === 'trash') { openTrashActions(id); return; }
      openEditor(id);
    });
    el.board.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.card');
        if (card) { e.preventDefault(); card.click(); }
      }
    });

    // ----- Editor -----
    el.overlay.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeEditor(); });

    el.editorTitle.addEventListener('input', e => {
      const n = getNote(openId); if (n) { n.title = e.target.value; touch(); }
    });
    el.editorText.addEventListener('input', e => {
      const n = getNote(openId); if (n) { n.body = e.target.value; autoGrow(el.editorText); touch(); }
    });

    el.swatches.addEventListener('click', e => {
      const b = e.target.closest('.swatch'); if (!b) return;
      const n = getNote(openId); if (!n) return;
      n.color = b.dataset.color; touch(); renderSwatches(n);
    });

    el.pinBtn.onclick = () => {
      const n = getNote(openId); if (!n) return;
      n.pinned = !n.pinned; touch();
      el.pinBtn.classList.toggle('is-on', n.pinned);
    };

    el.taskToggleBtn.onclick = () => {
      const n = getNote(openId); if (!n) return;
      n.isTask = !n.isTask;
      if (n.isTask && !n.checks) n.checks = [];
      touch();
      el.taskToggleBtn.classList.toggle('is-on', n.isTask);
      el.editorText.hidden = n.isTask;
      el.checklist.hidden = !n.isTask;
      if (n.isTask) { renderChecklist(n); $('#checkAdd')?.focus(); }
    };

    el.deleteBtn.onclick = () => {
      const id = openId;
      if (view === 'trash') { deleteForever(id); }
      else { trashNote(id); }
      openId = null; el.overlay.hidden = true; render();
    };

    // Tags in editor
    el.tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const n = getNote(openId); if (!n) return;
        const t = el.tagInput.value.trim().replace(/^#/, '').toLowerCase();
        if (t && !n.tags.includes(t)) { n.tags.push(t); touch(); renderTagChips(n); }
        el.tagInput.value = '';
      } else if (e.key === 'Backspace' && !el.tagInput.value) {
        const n = getNote(openId);
        if (n && n.tags.length) { n.tags.pop(); touch(); renderTagChips(n); }
      }
    });
    el.tagChips.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const n = getNote(openId); if (!n) return;
      n.tags = n.tags.filter(t => t !== b.dataset.tag); touch(); renderTagChips(n);
    });

    // Checklist interactions (delegated)
    el.checklist.addEventListener('click', e => {
      const n = getNote(openId); if (!n) return;
      const row = e.target.closest('.check-row');
      const act = e.target.dataset.act;
      if (act === 'toggle' && row) {
        const c = n.checks.find(x => x.id === row.dataset.cid);
        if (c) { c.done = !c.done; touch(); renderChecklist(n); }
      } else if (act === 'del' && row) {
        n.checks = n.checks.filter(x => x.id !== row.dataset.cid); touch(); renderChecklist(n);
      }
    });
    el.checklist.addEventListener('input', e => {
      const n = getNote(openId); if (!n) return;
      const row = e.target.closest('.check-row');
      if (e.target.classList.contains('check-text') && row) {
        const c = n.checks.find(x => x.id === row.dataset.cid);
        if (c) { c.text = e.target.value; touch(); }
      }
    });
    el.checklist.addEventListener('keydown', e => {
      const n = getNote(openId); if (!n) return;
      if (e.target.id === 'checkAdd' && e.key === 'Enter') {
        const v = e.target.value.trim();
        if (v) { n.checks.push({ id: uid(), text: v, done: false }); touch(); renderChecklist(n); $('#checkAdd').focus(); }
      }
      // Enter on an item adds a new one after it
      if (e.target.classList.contains('check-text') && e.key === 'Enter') {
        e.preventDefault();
        const row = e.target.closest('.check-row');
        const idx = n.checks.findIndex(x => x.id === row.dataset.cid);
        const item = { id: uid(), text: '', done: false };
        n.checks.splice(idx + 1, 0, item); touch(); renderChecklist(n);
        el.checklist.querySelector(`[data-cid="${item.id}"] .check-text`)?.focus();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === 'Escape') {
        if (!el.overlay.hidden) closeEditor();
        else if (!el.toast.hidden) hideToast();
        return;
      }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); el.search.focus(); }
      if ((e.key === 'n' || e.key === 'N') && el.overlay.hidden) { e.preventDefault(); createNote(); }
    });
  }

  function openTrashActions(id) {
    openEditor(id);
    showToast('In trash · deleting here is permanent', 'Restore', () => {
      restoreNote(id);
      openId = null; el.overlay.hidden = true;
    });
  }

  // ---------- Init ----------
  load();
  applyTheme();
  bind();
  render();
})();
