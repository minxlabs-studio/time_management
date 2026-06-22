// ── AI COACH ─────────────────────────
// Keep these functions global because index.html still uses inline onclick handlers.
let goalTitleCache = {}; // goalId -> title, used to render AI action cards with the correct goal name
let pendingAiActions = [];

function aiPreset(question) {
  document.getElementById('ai-inp').value = question;
  askAI();
}

async function askAI() {
  const question = document.getElementById('ai-inp').value.trim();
  if (!question) return;

  const btn = document.getElementById('ai-btn');
  const res = document.getElementById('ai-resp');

  btn.disabled = true;
  btn.innerHTML = '<span class="ai-spinner"></span> Đang phân tích...';
  res.className = 'ai-response on';
  res.textContent = '';
  renderAiActionCards([]);

  try {
    const weekData = await getWeek(weekOffset);
    const goalsSnap = await col('goals').limit(10).get();
    const goals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    let ctx = 'CÔNG VIỆC TUẦN NÀY:\n';
    const qN = {
      q1: 'Ô1(Khẩn&QT)',
      q2: 'Ô2(QT chưa khẩn)',
      q3: 'Ô3(Khẩn)',
      q4: 'Ô4(Sao nhãng)'
    };

    ['q1', 'q2', 'q3', 'q4'].forEach(key => {
      const tasks = weekData[key] || [];
      if (tasks.length) {
        ctx += `${qN[key]}: ${tasks
          .map(t => `${t.text}(${t.hours || 0}h${t.done ? ',✓' : ''})`)
          .join(', ')}\n`;
      }
    });

    if (goals.length) {
      ctx += '\nGOALS:\n';
      goals.forEach(g => {
        ctx += `- ${g.title} [${g.category}] deadline:${g.deadline || 'chưa đặt'}${g.done ? ' (xong)' : ''}\n`;
      });
    }

    const goalsBrief = goals.length
      ? goals.map(g => `${g.id}="${g.title}"`).join('; ')
      : '';
    goals.forEach(g => { goalTitleCache[g.id] = g.title; });

    const r = await fetch('/api/ai-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        context: ctx,
        goalsBrief
      })
    });

    let data = {};
    try {
      data = await r.json();
    } catch (_) {
      data = {};
    }

    if (!r.ok) {
      throw new Error(data.error || `AI Coach API error ${r.status}`);
    }

    res.textContent = data.text || (data.actions?.length ? '' : 'Không có phản hồi.');
    renderAiActionCards(data.actions || []);
  } catch (e) {
    console.error('AI fetch failed:', e);
    res.textContent = 'Lỗi kết nối AI: ' + e.message;
    renderAiActionCards([]);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Hỏi ↗';
  }
}

function renderAiActionCards(actions) {
  pendingAiActions = actions;
  const wrap = document.getElementById('ai-actions-wrap');
  if (!actions.length) {
    wrap.innerHTML = '';
    wrap.classList.remove('on');
    return;
  }

  wrap.classList.add('on');
  wrap.innerHTML = actions.map((a, idx) => renderActionCard(a, idx)).join('');
}

function renderActionCard(a, idx) {
  if (a.tool === 'add_task') {
    const qLabel = Q_LABELS[a.args.quadrant] || a.args.quadrant;
    return `
      <div class="ai-action-card" id="ai-action-${idx}">
        <div class="ai-action-icon">➕</div>
        <div class="ai-action-body">
          <div class="ai-action-title">Thêm task vào ${esc(qLabel)}</div>
          <div class="ai-action-desc">${esc(a.args.text)}${a.args.hours ? ` · ${a.args.hours}h` : ''}</div>
        </div>
        <div class="ai-action-btns">
          <button class="ai-action-btn ai-action-accept" onclick="acceptAiAction(${idx})">✓ Thêm</button>
          <button class="ai-action-btn ai-action-reject" onclick="rejectAiAction(${idx})">✗</button>
        </div>
      </div>`;
  }

  if (a.tool === 'add_milestone') {
    const goalTitle = goalTitleCache[a.args.goalId] || 'Goal';
    return `
      <div class="ai-action-card" id="ai-action-${idx}">
        <div class="ai-action-icon">🎯</div>
        <div class="ai-action-body">
          <div class="ai-action-title">Thêm milestone vào "${esc(goalTitle)}"</div>
          <div class="ai-action-desc">${esc(a.args.text)}${a.args.date ? ` · ${fmtD(a.args.date)}` : ''}</div>
        </div>
        <div class="ai-action-btns">
          <button class="ai-action-btn ai-action-accept" onclick="acceptAiAction(${idx})">✓ Thêm</button>
          <button class="ai-action-btn ai-action-reject" onclick="rejectAiAction(${idx})">✗</button>
        </div>
      </div>`;
  }

  return '';
}

async function acceptAiAction(idx) {
  const a = pendingAiActions[idx];
  if (!a) return;

  try {
    if (a.tool === 'add_task') {
      const data = await getWeek(weekOffset);
      const q = a.args.quadrant;
      if (!data[q]) data[q] = [];

      data[q].push({
        text: a.args.text,
        hours: parseFloat(a.args.hours) || 0,
        date: '',
        done: false,
        gcal: false,
        goalId: a.args.goalId || null,
        created: Date.now()
      });

      await setWeek(weekOffset, data);
      invalidateWeeksCache();
      renderTasks();
      toast('✓ Đã thêm task: ' + a.args.text);
    } else if (a.tool === 'add_milestone') {
      const ref = col('goals').doc(a.args.goalId);
      const d = await ref.get();
      if (!d.exists) {
        toast('⚠️ Không tìm thấy Goal này');
        return;
      }

      const g = d.data();
      const ms = g.milestones || [];
      ms.push({ text: a.args.text, date: a.args.date || '', done: false });
      await ref.update({ milestones: ms });
      invalidateWeeksCache();
      renderGoals();
      toast('✓ Đã thêm milestone vào: ' + (g.title || 'Goal'));
    }
  } catch (e) {
    console.error('Lỗi thực thi AI action:', e);
    toast('⚠️ Có lỗi khi thêm: ' + e.message);
  }

  document.getElementById('ai-action-' + idx)?.remove();
}

function rejectAiAction(idx) {
  document.getElementById('ai-action-' + idx)?.remove();
}

// ── ALL TASKS VIEW ────────────────────
// Keep these globals because the view uses inline handlers like the rest of the app.
var allTasksState = { items: [], search: '', filter: 'all', loading: false };

function parseAllTasksWeekDocId(docId) {
  const d = new Date(`${docId}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getAllTasksWeekOffset(docId) {
  const source = parseAllTasksWeekDocId(docId);
  const current = parseAllTasksWeekDocId(weekKey(0));
  if (!source || !current) return null;
  return Math.round((source - current) / (7 * 86400000));
}

async function getAllWeeksFlatTasks(options = {}) {
  const now = Date.now();
  const includeAllTasks = options.includeAllTasks !== false;
  if (_allWeeksCache && (now - _allWeeksCacheTime) < 15000) {
    return includeAllTasks ? _allWeeksCache : _allWeeksCache.filter(t => t.goalId);
  }

  const snap = await col('weeks').get();
  const flat = [];
  snap.docs.forEach(doc => {
    const wk = doc.data() || {};
    const sourceWeek = doc.id;
    const sourceWeekOffset = getAllTasksWeekOffset(sourceWeek);
    ['q1', 'q2', 'q3', 'q4'].forEach(q => {
      (wk[q] || []).forEach((t, i) => {
        flat.push({
          ...t,
          q,
          i,
          weekId: sourceWeek,
          sourceWeek,
          sourceWeekOffset
        });
      });
    });
  });

  flat.sort((a, b) => {
    const aw = a.sourceWeek || '';
    const bw = b.sourceWeek || '';
    if (aw !== bw) return bw.localeCompare(aw);
    return (b.created || b.updated || 0) - (a.created || a.updated || 0);
  });

  _allWeeksCache = flat;
  _allWeeksCacheTime = now;
  return includeAllTasks ? flat : flat.filter(t => t.goalId);
}

function allTasksSearchText(task) {
  return `${task.text || ''} ${task.note || ''}`.toLowerCase();
}

function allTasksGCalLabel(task) {
  if (typeof hasLinkedGoogleCalendarEvent === 'function' && hasLinkedGoogleCalendarEvent(task)) return 'GCal linked';
  if (task.gcal) return 'GCal source';
  return 'Not linked';
}

function allTasksFilteredItems() {
  const q = allTasksState.search.trim().toLowerCase();
  return allTasksState.items.filter(task => {
    if (q && !allTasksSearchText(task).includes(q)) return false;
    if (allTasksState.filter === 'incomplete') return !task.done;
    if (allTasksState.filter === 'completed') return !!task.done;
    if (allTasksState.filter === 'gcal') return !!task.gcal || (typeof hasLinkedGoogleCalendarEvent === 'function' && hasLinkedGoogleCalendarEvent(task));
    if (allTasksState.filter === 'no-date') return !task.date;
    return true;
  });
}

function ensureAllTasksView() {
  if (!document.getElementById('all-tasks-style')) {
    const style = document.createElement('style');
    style.id = 'all-tasks-style';
    style.textContent = `
      .all-tasks-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:1rem;flex-wrap:wrap}
      .all-tasks-tools{display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap}
      .all-tasks-search{min-width:260px;flex:1;font-size:14px;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--r);background:var(--surface);color:var(--text);font-family:'Roboto',sans-serif}
      .all-tasks-search:focus{outline:none;border-color:var(--purple)}
      .all-tasks-filter{font-size:13px;padding:9px 10px;border:1px solid var(--border2);border-radius:var(--r);background:var(--surface);color:var(--text);font-family:'Roboto',sans-serif}
      .all-tasks-list{display:flex;flex-direction:column;gap:10px}
      .all-task-row{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}
      .all-task-title{font-size:14px;font-weight:600;color:var(--text);line-height:1.45}
      .all-task-title.done{text-decoration:line-through;color:var(--text3)}
      .all-task-note{font-size:12px;color:var(--text2);line-height:1.5;margin-top:5px;white-space:pre-wrap}
      .all-task-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:9px}
      .all-task-pill{font-size:11px;padding:3px 8px;border-radius:100px;background:var(--surface2);color:var(--text2);white-space:nowrap}
      .all-task-open{font-size:12px;padding:7px 12px;border:1px solid var(--border2);border-radius:var(--r);background:var(--surface);color:var(--text);cursor:pointer;font-family:'Roboto',sans-serif;white-space:nowrap}
      .all-task-open:hover{background:var(--surface2)}
      .all-tasks-empty{font-size:13px;color:var(--text3);padding:18px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);line-height:1.6}
      @media(max-width:640px){.all-task-row{grid-template-columns:1fr}.all-task-open{width:100%}.all-tasks-search{min-width:0}}
    `;
    document.head.appendChild(style);
  }

  const nav = document.querySelector('.sidebar-nav');
  if (nav && !document.getElementById('tab-all-tasks')) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.id = 'tab-all-tasks';
    tab.setAttribute('onclick', "showTab('all-tasks',this)");
    tab.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
      All Tasks`;
    const reviewTab = Array.from(nav.querySelectorAll('.tab')).find(t => t.getAttribute('onclick')?.includes("'review'"));
    nav.insertBefore(tab, reviewTab || null);
  }

  const content = document.querySelector('.content');
  if (content && !document.getElementById('page-all-tasks')) {
    const page = document.createElement('div');
    page.id = 'page-all-tasks';
    page.className = 'page';
    page.innerHTML = `
      <div class="all-tasks-head">
        <div>
          <h2 class="section-title" style="margin:0">All Tasks</h2>
          <div style="font-size:13px;color:var(--text2);margin-top:4px">Search across every saved week without moving or changing old tasks.</div>
        </div>
        <span class="stat-badge neutral" id="all-tasks-count">0 tasks</span>
      </div>
      <div class="all-tasks-tools">
        <input class="all-tasks-search" id="all-tasks-search" type="search" placeholder="Search title or note..." oninput="setAllTasksSearch(this.value)">
        <select class="all-tasks-filter" id="all-tasks-filter" onchange="setAllTasksFilter(this.value)">
          <option value="all">All</option>
          <option value="incomplete">Incomplete</option>
          <option value="completed">Completed</option>
          <option value="gcal">Google Calendar</option>
          <option value="no-date">Tasks without date</option>
        </select>
        <button class="wn-btn-primary" onclick="refreshAllTasks()">Refresh</button>
      </div>
      <div class="all-tasks-list" id="all-tasks-list"></div>`;
    const reviewPage = document.getElementById('page-review');
    content.insertBefore(page, reviewPage || null);
  }
}

function renderAllTasksRows() {
  const list = document.getElementById('all-tasks-list');
  if (!list || allTasksState.loading) return;
  const items = allTasksFilteredItems();
  const count = document.getElementById('all-tasks-count');
  if (count) count.textContent = `${items.length} of ${allTasksState.items.length} tasks`;
  if (!items.length) {
    list.innerHTML = '<div class="all-tasks-empty">No tasks match this search or filter.</div>';
    return;
  }

  list.innerHTML = items.map(t => {
    const safeOffset = t.sourceWeekOffset;
    const canOpen = Number.isFinite(safeOffset);
    const note = String(t.note || '').trim();
    return `
      <div class="all-task-row">
        <div>
          <div class="all-task-title ${t.done ? 'done' : ''}">${esc(t.text || '(Untitled task)')}</div>
          ${note ? `<div class="all-task-note">${esc(note)}</div>` : ''}
          <div class="all-task-meta">
            <span class="all-task-pill" style="background:${qBg(t.q)};color:${qTx(t.q)}">${Q_LABELS[t.q] || t.q}</span>
            <span class="all-task-pill">${t.date ? fmtD(t.date) : 'No date'}</span>
            <span class="all-task-pill">${t.hours ? `${t.hours}h` : '0h'}</span>
            <span class="all-task-pill">${t.done ? 'Completed' : 'Incomplete'}</span>
            <span class="all-task-pill">${allTasksGCalLabel(t)}</span>
            <span class="all-task-pill">Week ${esc(t.sourceWeek || '')}</span>
          </div>
        </div>
        <button class="all-task-open" onclick="openAllTaskWeek(${canOpen ? String(safeOffset) : 'null'},'${esc(t.sourceWeek || '')}')">${canOpen ? 'Open week' : 'Week unavailable'}</button>
      </div>`;
  }).join('');
}

async function renderAllTasks() {
  ensureAllTasksView();
  const list = document.getElementById('all-tasks-list');
  if (!list) return;
  allTasksState.loading = true;
  list.innerHTML = '<div class="all-tasks-empty">Loading tasks across weeks...</div>';
  try {
    allTasksState.items = await getAllWeeksFlatTasks({ includeAllTasks: true });
    allTasksState.loading = false;
    renderAllTasksRows();
  } catch (e) {
    allTasksState.loading = false;
    list.innerHTML = `<div class="all-tasks-empty">Could not load all tasks: ${esc(e.message || e)}</div>`;
  }
}

function setAllTasksSearch(value) {
  allTasksState.search = value || '';
  renderAllTasksRows();
}

function setAllTasksFilter(value) {
  allTasksState.filter = value || 'all';
  renderAllTasksRows();
}

async function refreshAllTasks() {
  invalidateWeeksCache();
  await renderAllTasks();
}

function openAllTaskWeek(sourceWeekOffset, sourceWeek) {
  if (!Number.isFinite(sourceWeekOffset)) {
    toast(`Cannot open week ${sourceWeek || ''}`);
    return;
  }
  weekOffset = sourceWeekOffset;
  updateWeekLabel();
  showTab('matrix', document.querySelector('.tab[onclick*="matrix"]') || document.querySelector('.tab'));
  renderTasks();
  toast(`Opened week ${sourceWeek || weekRangeLabel(weekOffset)}`);
}

const baseShowTabForAllTasks = showTab;
showTab = function(id, btn) {
  baseShowTabForAllTasks(id, btn);
  if (id === 'all-tasks') renderAllTasks();
};

const baseRenderTasksForAllTasks = renderTasks;
renderTasks = async function() {
  await baseRenderTasksForAllTasks();
  if (document.getElementById('page-all-tasks')?.classList.contains('on')) renderAllTasks();
};

ensureAllTasksView();

// Weekly Planning loader
(function loadWeeklyPlanningView() {
  if (document.getElementById('weekly-planning-script')) return;
  const script = document.createElement('script');
  script.id = 'weekly-planning-script';
  script.src = './src/weekly-planning.js';
  document.head.appendChild(script);
})();

// ── GOOGLE CALENDAR ITEM TYPES ───────────────────
let gcalCreateMode = 'event';

function getStoredItemType(task) {
  if (task?.itemType === 'event' || task?.itemType === 'task') return task.itemType;
  if (task?.gcal || task?.gcalEventId || task?.googleCalendarEventId) return 'event';
  return 'task';
}

function isAppTaskItem(task) {
  return getStoredItemType(task) === 'task';
}

function buildManualTaskRecord(payload) {
  return {
    text: payload.text,
    date: payload.date || '',
    hours: payload.hours || 0,
    note: payload.note || '',
    done: false,
    itemType: 'task',
    source: payload.source || 'manual',
    startTime: payload.startTime || '',
    gcal: false,
    goalId: payload.goalId || null,
    created: payload.created || Date.now()
  };
}

function buildSyncedTaskFromEvent(ev, existingTask = {}) {
  return {
    ...existingTask,
    text: buildSyncedTaskText(ev),
    hours: getSyncedEventHours(ev),
    date: getEventDateKey(ev),
    note: ev.description !== undefined ? ev.description : (existingTask.note || ''),
    gcal: true,
    itemType: 'event',
    source: 'gcal',
    gcalEventId: ev.id,
    googleCalendarEventId: ev.id,
    gcalCalId: ev._calId || existingTask.gcalCalId || 'primary',
    gcalEventSummary: stripQuadrantPrefix(ev.summary || existingTask.gcalEventSummary || existingTask.text || ''),
    gcalCalendarName: ev._calName || existingTask.gcalCalendarName || '',
    updated: Date.now(),
    created: existingTask.created || Date.now()
  };
}

const baseAddTaskFromMatrix = addTask;
addTask = async function(q) {
  const txt = document.getElementById('in-' + q)?.value?.trim();
  if (!txt) return;

  const note = document.getElementById('in-note-' + q)?.value?.trim() || '';
  const h = normalizeTaskHours(document.getElementById('ih-' + q)?.value);
  const dt = document.getElementById('id-' + q)?.value || '';
  const data = await getWeek(weekOffset);
  if (!data[q]) data[q] = [];
  data[q].push(buildManualTaskRecord({ text: txt, note, hours: h, date: dt }));
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  renderTasks();
  toast('Đã thêm: ' + txt);
};

function ensureGCalModeStyles() {
  if (document.getElementById('gcal-mode-style')) return;
  const style = document.createElement('style');
  style.id = 'gcal-mode-style';
  style.textContent = `
    .gcal-mode-toggle{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .gcal-mode-btn{font-size:12px;font-weight:600;padding:7px 14px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);border-radius:999px;cursor:pointer;font-family:'Roboto',sans-serif}
    .gcal-mode-btn.active{background:var(--purple-lt);color:var(--purple);border-color:#c8dafc}
    .gcal-type-badge{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 5px;border-radius:999px;margin-right:5px;vertical-align:middle}
    .gcal-type-badge.task{background:rgba(255,255,255,.7);color:inherit;border:1px solid currentColor}
    .gcal-type-badge.event{background:rgba(255,255,255,.7);color:inherit;border:1px solid currentColor}
    .ev-chip.task-chip{display:flex;align-items:center;gap:4px}
  `;
  document.head.appendChild(style);
}

function ensureGCalModeUi() {
  ensureGCalModeStyles();
  const titleInput = document.getElementById('gn-title');
  if (!titleInput) return;
  const card = titleInput.closest('.gcal-card');
  const formGrid = card?.querySelector('.gcal-form-grid');
  if (!card || !formGrid) return;

  const cardTitle = card.querySelector('.gcal-card-title');
  if (cardTitle) cardTitle.textContent = 'Tạo item mới';

  if (!document.getElementById('gcal-mode-toggle')) {
    const toggle = document.createElement('div');
    toggle.id = 'gcal-mode-toggle';
    toggle.className = 'gcal-mode-toggle';
    toggle.innerHTML = `
      <button type="button" class="gcal-mode-btn active" id="gcal-mode-event" onclick="setGCalCreateMode('event')">Event</button>
      <button type="button" class="gcal-mode-btn" id="gcal-mode-task" onclick="setGCalCreateMode('task')">Task</button>`;
    card.insertBefore(toggle, formGrid);
  }

  if (!document.getElementById('gtask-quadrant-wrap')) {
    const quadrantWrap = document.createElement('div');
    quadrantWrap.className = 'form-group';
    quadrantWrap.id = 'gtask-quadrant-wrap';
    quadrantWrap.style.display = 'none';
    quadrantWrap.innerHTML = `
      <label>Ô ưu tiên</label>
      <select id="gtask-quadrant">
        <option value="q1">Ô 1 — Khẩn & QT</option>
        <option value="q2" selected>Ô 2 — QT chưa khẩn</option>
        <option value="q3">Ô 3 — Khẩn cấp</option>
        <option value="q4">Ô 4 — Hạn chế</option>
      </select>`;
    const calendarGroup = document.getElementById('gn-cal-id')?.closest('.form-group');
    if (calendarGroup?.parentNode) calendarGroup.parentNode.insertBefore(quadrantWrap, calendarGroup.nextSibling);
  }

  syncGCalModeUi();
}

function setGCalCreateMode(mode) {
  gcalCreateMode = mode === 'task' ? 'task' : 'event';
  syncGCalModeUi();
}

function syncGCalModeUi() {
  ensureGCalModeStyles();
  const eventBtn = document.getElementById('gcal-mode-event');
  const taskBtn = document.getElementById('gcal-mode-task');
  eventBtn?.classList.toggle('active', gcalCreateMode === 'event');
  taskBtn?.classList.toggle('active', gcalCreateMode === 'task');

  const calGroup = document.getElementById('gn-cal-id')?.closest('.form-group');
  const quadGroup = document.getElementById('gtask-quadrant-wrap');
  const startGroup = document.getElementById('gn-start')?.closest('.form-group');
  const durGroup = document.getElementById('gn-dur')?.closest('.form-group');
  const descLabel = document.querySelector('label[for="gn-desc"]') || document.getElementById('gn-desc')?.closest('.form-group')?.querySelector('label');
  const titleLabel = document.getElementById('gn-title')?.closest('.form-group')?.querySelector('label');
  const dateLabel = document.getElementById('gn-date')?.closest('.form-group')?.querySelector('label');
  const startLabel = startGroup?.querySelector('label');
  const durLabel = durGroup?.querySelector('label');
  const descInput = document.getElementById('gn-desc');
  const actionBtn = document.querySelector('.gcal-card button.btn-primary[onclick="createGCalEvent()"]');
  const durInput = document.getElementById('gn-dur');
  const startInput = document.getElementById('gn-start');
  const titleInput = document.getElementById('gn-title');

  const isTask = gcalCreateMode === 'task';
  if (calGroup) calGroup.style.display = isTask ? 'none' : '';
  if (quadGroup) quadGroup.style.display = isTask ? '' : 'none';
  if (titleLabel) titleLabel.textContent = isTask ? 'Task title' : 'Tiêu đề';
  if (dateLabel) dateLabel.textContent = 'Ngày';
  if (startLabel) startLabel.textContent = isTask ? 'Giờ bắt đầu (tuỳ chọn)' : 'Giờ bắt đầu';
  if (durLabel) durLabel.textContent = isTask ? 'Giờ ước tính' : 'Thời lượng (phút)';
  if (descLabel) descLabel.textContent = isTask ? 'Ghi chú' : 'Ghi chú';
  if (actionBtn) actionBtn.textContent = isTask ? 'Tạo task' : 'Tạo event';
  if (titleInput) titleInput.placeholder = isTask ? 'Tên task...' : 'Tên event...';
  if (descInput) descInput.placeholder = isTask ? 'Ghi chú cho task...' : 'Mô tả thêm...';
  if (startInput) startInput.value = isTask ? '' : (startInput.value || '09:00');
  if (durInput) {
    if (isTask) {
      durInput.value = durInput.value === '60' ? '1' : (durInput.value || '1');
      durInput.min = '0';
      durInput.step = '0.5';
    } else {
      durInput.value = durInput.value === '1' ? '60' : (durInput.value || '60');
      durInput.min = '15';
      durInput.step = '15';
    }
  }
}

function getCalendarVisualClass(item) {
  if (item?._itemType === 'task' && item._quadrant) return `ev-${item._quadrant}`;
  return gcalEvClass(item?.summary);
}

function buildAppCalendarItems(data) {
  const items = [];
  ['q1', 'q2', 'q3', 'q4'].forEach(q => {
    (data[q] || []).forEach((task, i) => {
      if (!task?.date || !isAppTaskItem(task)) return;
      const summary = task.text || 'Task';
      const startTime = String(task.startTime || '').trim();
      const item = {
        id: `app-task-${q}-${i}-${task.created || Date.now()}`,
        summary,
        description: task.note || '',
        _itemType: 'task',
        _quadrant: q,
        _taskIndex: i,
        _taskDone: !!task.done,
        _taskHours: task.hours || 0,
        _taskSource: task.source || 'manual'
      };
      if (startTime) {
        const start = new Date(`${task.date}T${startTime}:00+07:00`);
        const end = new Date(start.getTime() + Math.max(task.hours || 1, 0.5) * 3600000);
        item.start = { dateTime: start.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' };
        item.end = { dateTime: end.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' };
      } else {
        item.start = { date: task.date };
        item.end = { date: addDaysToDateKey(task.date, 1) };
      }
      items.push(item);
    });
  });
  return items;
}

function renderCalendarChip(item) {
  const cls = getCalendarVisualClass(item);
  const isTask = item?._itemType === 'task';
  const style = cls === 'ev-gcal' && item._calColor
    ? `style="background:${item._calColor}22;border-left:2px solid ${item._calColor};color:${item._calColor};border-radius:0 3px 3px 0"`
    : '';
  const badge = `<span class="gcal-type-badge ${isTask ? 'task' : 'event'}">${isTask ? 'Task' : 'Event'}</span>`;
  const label = esc((item.summary || (isTask ? 'Task' : 'Event')).slice(0, 14));
  if (isTask) {
    return `<div class="ev-chip ${cls} task-chip" ${style} title="${esc(item.summary || '')}">${badge}${label}</div>`;
  }
  return `<div class="ev-chip ${cls}" ${style} onclick="openEventImport('${item.id}')" data-clickable="1" title="${esc(item.summary || '')} — bấm để thêm vào Ma trận">${badge}${label}</div>`;
}

async function loadGCalFromSelected() {
  ensureGCalModeUi();
  if (!gCalToken) return;
  const activeCals = allCalendars.filter(c => c.selected);
  if (!activeCals.length) {
    document.getElementById('gcal-strip').innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0">Chưa chọn lịch nào. Tick vào ô bên trên rồi bấm Áp dụng.</div>';
    return;
  }

  document.getElementById('gcal-strip').innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0">Đang tải lịch...</div>';
  const { mon, sun } = getWeekDateRange(new Date(), weekOffset);

  try {
    const [results, weekData] = await Promise.all([
      Promise.all(activeCals.map(async c => {
        const calId = encodeURIComponent(c.id);
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${mon.toISOString()}&timeMax=${sun.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=100`, {
          headers: { Authorization: `Bearer ${gCalToken}` }
        });
        if (!r.ok) return [];
        const j = await r.json();
        return (j.items || []).map(e => ({ ...e, _calColor: c.backgroundColor, _calName: c.summary, _calId: c.id, _itemType: 'event' }));
      })),
      getWeek(weekOffset)
    ]);

    const appItems = buildAppCalendarItems(weekData);
    const allItems = [...results.flat(), ...appItems].sort((a, b) => {
      const ta = a.start?.dateTime || a.start?.date || '';
      const tb = b.start?.dateTime || b.start?.date || '';
      return ta.localeCompare(tb);
    });

    _lastGcalMon = mon;
    _lastGcalEvents = allItems;
    renderGCalStrip(mon, allItems);
    if (gcalViewMode === 'grid') renderGCalGrid(mon, allItems);
  } catch (e) {
    document.getElementById('gcal-strip').innerHTML = `<div style="font-size:13px;color:var(--text3)">Lỗi: ${e.message}</div>`;
  }
}

function renderGCalStrip(mon, items) {
  const todayKey = localDateKey(new Date());
  const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  document.getElementById('gcal-strip').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon.getTime());
    d.setDate(mon.getDate() + i);
    const dateKey = localDateKey(d);
    const isToday = dateKey === todayKey;
    const dayItems = items.filter(item => getEventDateKey(item) === dateKey);
    return `<div class="day-col ${isToday ? 'today' : ''}">
      <div class="day-name">${days[i]}</div>
      <div class="day-num">${d.getDate()}</div>
      ${dayItems.slice(0, 4).map(renderCalendarChip).join('')}
      ${dayItems.length > 4 ? `<div style="font-size:10px;color:var(--text3)">+${dayItems.length - 4}</div>` : ''}
    </div>`;
  }).join('');
}

function renderGCalGrid(mon, items) {
  _lastGcalMon = mon;
  _lastGcalEvents = items;
  const wrap = document.getElementById('gcal-grid-wrap');
  const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const todayKey = localDateKey(new Date());

  const headerCells = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon.getTime());
    d.setDate(mon.getDate() + i);
    const dateKey = localDateKey(d);
    const isToday = dateKey === todayKey;
    return `<div class="cal-grid-header-cell ${isToday ? 'today' : ''}">
      <div class="cal-grid-day-name">${days[i]}</div>
      <div class="cal-grid-day-num">${d.getDate()}</div>
    </div>`;
  }).join('');

  const hourLabels = Array.from({ length: 24 }, (_, h) => `<div class="cal-grid-hour-lbl">${h === 0 ? '' : String(h).padStart(2, '0') + ':00'}</div>`).join('');

  const dayCols = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon.getTime());
    d.setDate(mon.getDate() + i);
    const dateKey = localDateKey(d);
    const dayItems = items.filter(item => getEventDateKey(item) === dateKey);

    const hourlines = Array.from({ length: 24 }, (_, h) =>
      `<div class="cal-grid-hourline" onclick="quickAddAtHour('${dateKey}',${h})" title="Thêm event lúc ${String(h).padStart(2, '0')}:00"></div>`
    ).join('');

    const blocks = dayItems.map(item => {
      const t = parseEvTime(item);
      if (t.allDay) return '';
      const top = (t.startMin / 60) * HOUR_HEIGHT;
      const height = Math.max((t.durMin / 60) * HOUR_HEIGHT, 18);
      const cls = getCalendarVisualClass(item);
      const baseColor = (cls === 'ev-gcal' && item._calColor) ? item._calColor : (qTx(cls.replace('ev-', '')) || '#1A73E8');
      const timeStr = t.startDate ? t.startDate.toTimeString().slice(0, 5) : '';
      const badge = item._itemType === 'task' ? 'Task' : 'Event';
      const clickAttr = item._itemType === 'task'
        ? ''
        : `onclick="event.stopPropagation();openEventImport('${item.id}')"`;
      const title = item._itemType === 'task'
        ? `${esc(item.summary || '')} — task trong app`
        : `${esc(item.summary || '')} — bấm để thêm vào Ma trận`;
      return `<div class="cal-event-block" style="top:${top}px;height:${height}px;background:${baseColor}1F;color:${baseColor};border-left-color:${baseColor}" ${clickAttr} title="${title}">
                <span class="ce-time">${timeStr}</span><span class="gcal-type-badge ${item._itemType === 'task' ? 'task' : 'event'}">${badge}</span>${esc((item.summary || badge).slice(0, 24))}
              </div>`;
    }).join('');

    let nowLine = '';
    if (dateKey === todayKey) {
      const now = new Date();
      const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
      nowLine = `<div class="cal-grid-now-line" style="top:${nowTop}px"></div>`;
    }

    return `<div class="cal-grid-daycol">${hourlines}${blocks}${nowLine}</div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="cal-grid-card">
      <div class="cal-grid-scroll">
        <div class="cal-grid-header"><div></div>${headerCells}</div>
        <div class="cal-grid-body" style="max-height:600px;overflow-y:auto">
          <div class="cal-grid-hours">${hourLabels}</div>
          ${dayCols}
        </div>
      </div>
    </div>`;

  const scrollBody = wrap.querySelector('.cal-grid-body');
  if (scrollBody) {
    const now = new Date();
    scrollBody.scrollTop = Math.max(0, (now.getHours() - 2) * HOUR_HEIGHT);
  }
}

async function createGCalEvent() {
  ensureGCalModeUi();
  if (gcalCreateMode === 'task') {
    return createTaskFromGCalPage();
  }
  return createCalendarEventFromGCalPage();
}

async function createCalendarEventFromGCalPage() {
  if (!gCalToken) { connectGCal(); return; }
  const title = document.getElementById('gn-title').value.trim();
  const calId = document.getElementById('gn-cal-id')?.value || 'primary';
  const date = document.getElementById('gn-date').value;
  const time = document.getElementById('gn-start').value || '09:00';
  const dur = parseInt(document.getElementById('gn-dur').value, 10) || 60;
  const desc = document.getElementById('gn-desc').value;
  if (!title || !date) { toast('Cần có tiêu đề và ngày'); return; }
  const start = new Date(`${date}T${time}:00+07:00`);
  const end = new Date(start.getTime() + dur * 60000);
  try {
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gCalToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: title,
        description: desc,
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' }
      })
    });
    if (!r.ok) throw new Error((await r.json()).error?.message);
    document.getElementById('gn-title').value = '';
    document.getElementById('gn-date').value = '';
    document.getElementById('gn-desc').value = '';
    document.getElementById('gn-start').value = '09:00';
    document.getElementById('gn-dur').value = '60';
    loadGCalFromSelected();
    toast('✓ Đã tạo event!');
  } catch (e) {
    toast('Lỗi: ' + e.message);
  }
}

async function createTaskFromGCalPage() {
  const title = document.getElementById('gn-title').value.trim();
  const quadrant = document.getElementById('gtask-quadrant')?.value || 'q2';
  const date = document.getElementById('gn-date').value;
  const startTime = document.getElementById('gn-start').value || '';
  const hours = normalizeTaskHours(document.getElementById('gn-dur').value);
  const note = document.getElementById('gn-desc').value.trim();
  if (!title || !date) { toast('Cần có tên task và ngày'); return; }

  const data = await getWeek(weekOffset);
  if (!data[quadrant]) data[quadrant] = [];
  data[quadrant].push(buildManualTaskRecord({
    text: title,
    date,
    hours,
    note,
    startTime,
    source: 'manual'
  }));
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  document.getElementById('gn-title').value = '';
  document.getElementById('gn-date').value = '';
  document.getElementById('gn-start').value = '';
  document.getElementById('gn-dur').value = '1';
  document.getElementById('gn-desc').value = '';
  renderTasks();
  if (document.getElementById('page-gcal')?.classList.contains('on')) loadGCalFromSelected();
  toast(`✓ Đã tạo task vào ${Q_LABELS[quadrant]}`);
}

const baseShowTabForGCalItems = showTab;
showTab = function(id, btn) {
  baseShowTabForGCalItems(id, btn);
  if (id === 'gcal') ensureGCalModeUi();
};

ensureGCalModeUi();
setGCalCreateMode('event');
