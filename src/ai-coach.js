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
