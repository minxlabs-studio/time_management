// Weekly Planning view
// Stores only planning metadata on the selected week document; tasks stay in place.
var weeklyPlanningState = { data: null, plan: null, loading: false };

function weeklyTaskKey(task) {
  if (task.created) return `${task.q}:created:${task.created}`;
  return `${task.q}:index:${task.i}:text:${task.text || ''}`;
}

function weeklyTaskRows(data) {
  return ['q1', 'q2', 'q3', 'q4'].flatMap(q =>
    (data[q] || []).map((task, i) => ({ ...task, q, i, key: weeklyTaskKey({ ...task, q, i }) }))
  );
}

function weeklyTaskTitle(task) {
  return esc(task.text || '(Untitled task)');
}

function weeklyTaskMeta(task) {
  const bits = [
    Q_LABELS[task.q] || task.q,
    task.date ? fmtD(task.date) : '',
    task.hours ? `${task.hours}h` : '',
    task.gcal || (typeof hasLinkedGoogleCalendarEvent === 'function' && hasLinkedGoogleCalendarEvent(task)) ? 'Google Calendar' : '',
    task.goalId ? 'Goal' : ''
  ].filter(Boolean);
  return bits.join(' | ');
}

function weeklyPlanFromData(data) {
  const plan = data.weeklyPlanning || {};
  return {
    intention: plan.intention || '',
    priorityKeys: Array.isArray(plan.priorityKeys) ? plan.priorityKeys : [],
    priorityRefs: Array.isArray(plan.priorityRefs) ? plan.priorityRefs : [],
    updated: plan.updated || null
  };
}

function ensureWeeklyPlanningView() {
  if (!document.getElementById('weekly-planning-style')) {
    const style = document.createElement('style');
    style.id = 'weekly-planning-style';
    style.textContent = `
      .weekly-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:1rem;flex-wrap:wrap}
      .weekly-nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .weekly-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .weekly-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px}
      .weekly-card.full{grid-column:1/-1}
      .weekly-card-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px}
      .weekly-overview{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
      .weekly-metric{background:var(--surface2);border-radius:var(--r);padding:10px}
      .weekly-metric strong{display:block;font-size:20px;color:var(--purple)}
      .weekly-metric span{font-size:11px;color:var(--text2)}
      .weekly-list{display:flex;flex-direction:column;gap:8px}
      .weekly-row{border:1px solid var(--border);border-radius:var(--r);padding:10px;background:var(--surface)}
      .weekly-row-title{font-size:13px;font-weight:600;color:var(--text);line-height:1.45}
      .weekly-row-title.done{text-decoration:line-through;color:var(--text3)}
      .weekly-row-note{font-size:12px;color:var(--text2);line-height:1.45;margin-top:4px;white-space:pre-wrap}
      .weekly-row-meta{font-size:11px;color:var(--text3);margin-top:5px}
      .weekly-empty{font-size:13px;color:var(--text3);line-height:1.6}
      .weekly-priority-row{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:var(--r);padding:10px;background:var(--surface)}
      .weekly-priority-row input{margin-top:2px;flex-shrink:0}
      .weekly-note{width:100%;min-height:92px;resize:vertical;font-size:14px;padding:10px 12px;border:1px solid var(--border2);border-radius:var(--r);background:var(--surface2);color:var(--text);font-family:'Roboto',sans-serif;line-height:1.5}
      .weekly-note:focus{outline:none;border-color:var(--purple);background:var(--surface)}
      .weekly-actions{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
      @media(max-width:760px){.weekly-grid{grid-template-columns:1fr}.weekly-overview{grid-template-columns:1fr 1fr}.weekly-nav{width:100%}.weekly-nav .week-label{text-align:left;min-width:0;flex:1}}
    `;
    document.head.appendChild(style);
  }

  const nav = document.querySelector('.sidebar-nav');
  if (nav && !document.getElementById('tab-weekly-planning')) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.id = 'tab-weekly-planning';
    tab.setAttribute('onclick', "showTab('weekly-planning',this)");
    tab.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/></svg>
      Weekly Planning`;
    const allTasksTab = document.getElementById('tab-all-tasks');
    nav.insertBefore(tab, allTasksTab || nav.querySelector('.tab[onclick*="review"]') || null);
  }

  const content = document.querySelector('.content');
  if (content && !document.getElementById('page-weekly-planning')) {
    const page = document.createElement('div');
    page.id = 'page-weekly-planning';
    page.className = 'page';
    page.innerHTML = `
      <div class="weekly-head">
        <div>
          <h2 class="section-title" style="margin:0">Weekly Planning</h2>
          <div style="font-size:13px;color:var(--text2);margin-top:4px">Choose what matters this week without moving tasks.</div>
        </div>
        <div class="weekly-nav">
          <button class="wn-btn" onclick="changeWeeklyPlanningWeek(-1)">&lt;</button>
          <span class="week-label" id="weekly-plan-label"></span>
          <button class="wn-btn" onclick="changeWeeklyPlanningWeek(1)">&gt;</button>
          <button class="wn-btn-primary" onclick="goWeeklyPlanningToday()">Today</button>
        </div>
      </div>
      <div id="weekly-planning-body" class="weekly-grid"></div>`;
    const allTasksPage = document.getElementById('page-all-tasks');
    content.insertBefore(page, allTasksPage || document.getElementById('page-review') || null);
  }
}

function renderWeeklyTaskList(tasks, emptyText) {
  if (!tasks.length) return `<div class="weekly-empty">${emptyText}</div>`;
  return `<div class="weekly-list">${tasks.map(t => `
    <div class="weekly-row">
      <div class="weekly-row-title ${t.done ? 'done' : ''}">${weeklyTaskTitle(t)}</div>
      ${t.note ? `<div class="weekly-row-note">${esc(t.note)}</div>` : ''}
      <div class="weekly-row-meta">${esc(weeklyTaskMeta(t))}</div>
    </div>`).join('')}</div>`;
}

function renderWeeklyPriorityPicker(tasks, plan) {
  if (!tasks.length) return '<div class="weekly-empty">No unfinished tasks available for priorities.</div>';
  const picked = new Set(plan.priorityKeys || []);
  return `<div class="weekly-list">${tasks.map(t => `
    <label class="weekly-priority-row">
      <input type="checkbox" class="weekly-priority-check" value="${esc(t.key)}" ${picked.has(t.key) ? 'checked' : ''}>
      <span>
        <span class="weekly-row-title">${weeklyTaskTitle(t)}</span>
        <span class="weekly-row-meta" style="display:block">${esc(weeklyTaskMeta(t))}</span>
      </span>
    </label>`).join('')}</div>`;
}

async function renderWeeklyPlanning() {
  ensureWeeklyPlanningView();
  const body = document.getElementById('weekly-planning-body');
  const label = document.getElementById('weekly-plan-label');
  if (!body) return;
  if (label) label.textContent = weekRangeLabel(weekOffset);
  weeklyPlanningState.loading = true;
  body.innerHTML = '<div class="weekly-card full"><div class="weekly-empty">Loading weekly planning...</div></div>';

  try {
    const data = await getWeek(weekOffset);
    const tasks = weeklyTaskRows(data);
    const unfinished = tasks.filter(t => !t.done);
    const important = tasks.filter(t => ['q1', 'q2'].includes(t.q));
    const gcal = tasks.filter(t => t.gcal || (typeof hasLinkedGoogleCalendarEvent === 'function' && hasLinkedGoogleCalendarEvent(t)));
    const goalLinked = tasks.filter(t => t.goalId);
    const priorityCandidates = unfinished.slice().sort((a, b) => {
      const rank = { q1: 0, q2: 1, q3: 2, q4: 3 };
      return (rank[a.q] ?? 9) - (rank[b.q] ?? 9);
    });
    const plan = weeklyPlanFromData(data);
    weeklyPlanningState = { data, plan, loading: false };

    body.innerHTML = `
      <section class="weekly-card full">
        <div class="weekly-card-title">This Week Overview</div>
        <div class="weekly-overview">
          <div class="weekly-metric"><strong>${unfinished.length}</strong><span>unfinished</span></div>
          <div class="weekly-metric"><strong>${important.length}</strong><span>q1 / q2</span></div>
          <div class="weekly-metric"><strong>${gcal.length}</strong><span>Google Calendar</span></div>
          <div class="weekly-metric"><strong>${goalLinked.length}</strong><span>goal-linked</span></div>
        </div>
      </section>
      <section class="weekly-card">
        <div class="weekly-card-title">Unfinished Tasks</div>
        ${renderWeeklyTaskList(unfinished, 'No unfinished tasks in this week.')}
      </section>
      <section class="weekly-card">
        <div class="weekly-card-title">Important Tasks, q1 and q2</div>
        ${renderWeeklyTaskList(important, 'No q1 or q2 tasks in this week.')}
      </section>
      <section class="weekly-card">
        <div class="weekly-card-title">Google Calendar Linked</div>
        ${renderWeeklyTaskList(gcal, 'No Google Calendar-linked tasks synced into this week.')}
      </section>
      <section class="weekly-card">
        <div class="weekly-card-title">Goal-linked Tasks</div>
        ${renderWeeklyTaskList(goalLinked, 'No goal-linked tasks in this week.')}
      </section>
      <section class="weekly-card full">
        <div class="weekly-card-title">Top Priorities This Week</div>
        ${renderWeeklyPriorityPicker(priorityCandidates, plan)}
      </section>
      <section class="weekly-card full">
        <div class="weekly-card-title">Weekly Intention / Notes</div>
        <textarea class="weekly-note" id="weekly-intention" maxlength="1200" placeholder="What matters most this week?">${esc(plan.intention)}</textarea>
        <div class="weekly-actions">
          <button class="btn-primary" onclick="saveWeeklyPlanning()">Save weekly plan</button>
          <span class="weekly-empty" id="weekly-plan-saved">${plan.updated ? `Last saved ${new Date(plan.updated).toLocaleString()}` : ''}</span>
        </div>
      </section>`;
  } catch (e) {
    weeklyPlanningState.loading = false;
    body.innerHTML = `<div class="weekly-card full"><div class="weekly-empty">Could not load weekly planning: ${esc(e.message || e)}</div></div>`;
  }
}

async function saveWeeklyPlanning() {
  const data = await getWeek(weekOffset);
  const tasks = weeklyTaskRows(data);
  const byKey = new Map(tasks.map(t => [t.key, t]));
  const priorityKeys = Array.from(document.querySelectorAll('.weekly-priority-check:checked')).map(el => el.value);
  const priorityRefs = priorityKeys.map(key => {
    const t = byKey.get(key) || {};
    return { key, q: t.q || '', i: Number.isFinite(t.i) ? t.i : null, text: t.text || '', created: t.created || null };
  });

  data.weeklyPlanning = {
    intention: document.getElementById('weekly-intention')?.value.trim() || '',
    priorityKeys,
    priorityRefs,
    updated: Date.now()
  };

  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  weeklyPlanningState.data = data;
  weeklyPlanningState.plan = weeklyPlanFromData(data);
  const saved = document.getElementById('weekly-plan-saved');
  if (saved) saved.textContent = `Last saved ${new Date(data.weeklyPlanning.updated).toLocaleString()}`;
  toast('Weekly plan saved');
}

function changeWeeklyPlanningWeek(delta) {
  weekOffset += delta;
  updateWeekLabel();
  renderTasks();
  renderWeeklyPlanning();
}

function goWeeklyPlanningToday() {
  weekOffset = 0;
  updateWeekLabel();
  renderTasks();
  renderWeeklyPlanning();
}

const showTabBeforeWeeklyPlanning = showTab;
showTab = function(id, btn) {
  showTabBeforeWeeklyPlanning(id, btn);
  if (id === 'weekly-planning') renderWeeklyPlanning();
};

const renderTasksBeforeWeeklyPlanning = renderTasks;
renderTasks = async function() {
  await renderTasksBeforeWeeklyPlanning();
  if (document.getElementById('page-weekly-planning')?.classList.contains('on')) renderWeeklyPlanning();
};

ensureWeeklyPlanningView();

// Multi-week Google Calendar storage helpers and overrides.
function ensureWeekShape(data = {}) {
  return {
    ...data,
    q1: Array.isArray(data.q1) ? data.q1 : [],
    q2: Array.isArray(data.q2) ? data.q2 : [],
    q3: Array.isArray(data.q3) ? data.q3 : [],
    q4: Array.isArray(data.q4) ? data.q4 : []
  };
}

function weekKeyForDate(dateInput) {
  return localDateKey(getMondayOfWeek(dateInput));
}

async function getWeekByKey(weekKeyValue) {
  if (!weekKeyValue) return ensureWeekShape({});
  const doc = await col('weeks').doc(weekKeyValue).get();
  return ensureWeekShape(doc.exists ? doc.data() : {});
}

async function setWeekByKey(weekKeyValue, data) {
  await col('weeks').doc(weekKeyValue).set(ensureWeekShape(data));
}

function getWeekKeysInRange(startInput, endInput) {
  const start = getMondayOfWeek(startInput);
  const end = getMondayOfWeek(endInput);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const keys = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    keys.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return keys;
}

async function getWeekMapByKeys(weekKeys) {
  const unique = [...new Set((weekKeys || []).filter(Boolean))];
  const entries = await Promise.all(unique.map(async key => [key, await getWeekByKey(key)]));
  return Object.fromEntries(entries);
}

function isDateKeyWithinRange(dateKey, startKey, endKey) {
  return Boolean(dateKey && startKey && endKey && dateKey >= startKey && dateKey <= endKey);
}

function buildAppCalendarItem(task, q, i, meta = {}) {
  const summary = task.text || 'Task';
  const startTime = String(task.startTime || '').trim();
  const item = {
    id: `app-task-${meta.weekKey || 'week'}-${q}-${i}-${task.created || Date.now()}`,
    summary,
    description: task.note || '',
    _itemType: 'task',
    _quadrant: q,
    _taskIndex: i,
    _taskDone: !!task.done,
    _taskHours: task.hours || 0,
    _taskSource: task.source || 'manual',
    _weekKey: meta.weekKey || ''
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

  return item;
}

function buildAppCalendarItemsForWeeks(weekMap, startKey, endKey) {
  const items = [];
  Object.keys(weekMap || {}).sort().forEach(weekKeyValue => {
    const data = ensureWeekShape(weekMap[weekKeyValue]);
    ['q1', 'q2', 'q3', 'q4'].forEach(q => {
      (data[q] || []).forEach((task, i) => {
        if (!task?.date || !isAppTaskItem(task)) return;
        if (!isDateKeyWithinRange(task.date, startKey, endKey)) return;
        items.push(buildAppCalendarItem(task, q, i, { weekKey: weekKeyValue }));
      });
    });
  });
  return items;
}

function findSyncedTaskLocationInWeekMap(weekMap, eventId, ev, dateStr) {
  for (const [weekKeyValue, data] of Object.entries(weekMap || {})) {
    const existing = findTaskLocationByGoogleEventId(data, eventId) || findLegacySyncedTaskLocation(data, ev, dateStr);
    if (existing) return { ...existing, weekKey: weekKeyValue };
  }
  return null;
}

function formatWeekOfDateLabel(dateKey) {
  const d = parseCalendarDateInput(dateKey);
  if (Number.isNaN(d.getTime())) return dateKey || '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentWeekKey() {
  return weekKey(typeof weekOffset === 'number' ? weekOffset : 0);
}

renderCalendarChip = function(item) {
  const cls = getCalendarVisualClass(item);
  const isTask = item?._itemType === 'task';
  const style = cls === 'ev-gcal' && item._calColor
    ? `style="background:${item._calColor}22;border-left:2px solid ${item._calColor};color:${item._calColor};border-radius:0 3px 3px 0"`
    : '';
  const badge = `<span class="gcal-type-badge ${isTask ? 'task' : 'event'}">${isTask ? 'Task' : 'Event'}</span>`;
  const label = esc((item.summary || (isTask ? 'Task' : 'Event')).slice(0, 14));
  if (isTask) {
    return `<div class="ev-chip ${cls} task-chip" ${style} onclick="openTaskEdit('${item._quadrant}',${item._taskIndex},'${item._weekKey || ''}')" data-clickable="1" title="${esc(item.summary || '')} — bấm để sửa task">${badge}${label}</div>`;
  }
  return `<div class="ev-chip ${cls}" ${style} onclick="openEventImport('${item.id}')" data-clickable="1" title="${esc(item.summary || '')} — bấm để thêm vào Ma trận">${badge}${label}</div>`;
};

loadGCalFromSelected = async function() {
  ensureGCalModeUi();
  if (!gCalToken) return;
  const activeCals = allCalendars.filter(c => c.selected);
  if (!activeCals.length) {
    document.getElementById('gcal-strip').innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0">Chưa chọn lịch nào. Tick vào ô bên trên rồi bấm Áp dụng.</div>';
    return;
  }

  document.getElementById('gcal-strip').innerHTML = '<div style="font-size:13px;color:var(--text3);padding:8px 0">Đang tải lịch...</div>';
  const { mon, sun } = getSelectedGCalDateRange();
  const startKey = localDateKey(mon);
  const endKey = localDateKey(sun);

  try {
    const weekKeys = getWeekKeysInRange(mon, sun);
    const [results, weekMap] = await Promise.all([
      Promise.all(activeCals.map(async c => {
        const calId = encodeURIComponent(c.id);
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${mon.toISOString()}&timeMax=${sun.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=100`, {
          headers: { Authorization: `Bearer ${gCalToken}` }
        });
        if (!r.ok) return [];
        const j = await r.json();
        return (j.items || []).map(e => ({ ...e, _calColor: c.backgroundColor, _calName: c.summary, _calId: c.id, _itemType: 'event' }));
      })),
      getWeekMapByKeys(weekKeys)
    ]);

    const appItems = buildAppCalendarItemsForWeeks(weekMap, startKey, endKey);
    const allItems = [...results.flat(), ...appItems].sort((a, b) => {
      const ta = a.start?.dateTime || a.start?.date || '';
      const tb = b.start?.dateTime || b.start?.date || '';
      return ta.localeCompare(tb);
    });

    _lastGcalMon = mon;
    _lastGcalEvents = allItems;
    renderGCalViewsFromCache();
  } catch (e) {
    document.getElementById('gcal-strip').innerHTML = `<div style="font-size:13px;color:var(--text3)">Lỗi: ${e.message}</div>`;
  }
};

renderGCalGrid = function(mon, items) {
  _lastGcalMon = mon;
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
        ? `onclick="event.stopPropagation();openTaskEdit('${item._quadrant}',${item._taskIndex},'${item._weekKey || ''}')" data-clickable-task="1"`
        : `onclick="event.stopPropagation();openEventImport('${item.id}')"`;
      const title = item._itemType === 'task'
        ? `${esc(item.summary || '')} — bấm để sửa task`
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
};

const baseOpenTaskEditWithWeekKey = openTaskEdit;
openTaskEdit = async function(q, i, sourceWeekKey = '') {
  if (!sourceWeekKey) return baseOpenTaskEditWithWeekKey(q, i);
  const data = await getWeekByKey(sourceWeekKey);
  const task = data[q]?.[i];
  if (!task) {
    toast('Không tìm thấy task để sửa');
    return;
  }

  const editSeed = await getTaskEditSeed(task);
  ensureTaskEditModal();
  ensureTaskTimeField();
  taskEditState = { q, i, weekKey: sourceWeekKey };
  document.getElementById('te-title').value = editSeed.title;
  document.getElementById('te-hours').value = task.hours || '';
  document.getElementById('te-date').value = task.date || '';
  document.getElementById('te-start-time').value = editSeed.startTime || task.startTime || '';
  document.getElementById('te-note').value = editSeed.note;
  document.getElementById('task-edit-hint').textContent = hasLinkedGoogleCalendarEvent(task)
    ? 'Task này đang liên kết Google Calendar. Khi lưu, app sẽ cập nhật cả ngày và giờ event hiện có.'
    : 'Chỉnh sửa sẽ chỉ cập nhật task trong app.';
  document.getElementById('task-edit-modal-bg').classList.add('on');
  document.getElementById('te-title').focus();
  document.getElementById('te-title').select();
};

saveTaskEdit = async function() {
  const state = taskEditState;
  if (!state) return;

  const title = document.getElementById('te-title').value.trim();
  if (!title) {
    toast('Cần có tiêu đề task');
    return;
  }

  const note = document.getElementById('te-note').value.trim();
  const hours = normalizeTaskHours(document.getElementById('te-hours').value);
  const date = document.getElementById('te-date').value || '';
  const startTime = document.getElementById('te-start-time')?.value || '';
  const stateWeekOff = state.weekOff ?? 0;
  const sourceWeekKey = state.weekKey || weekKey(stateWeekOff);
  const sourceData = state.weekKey ? await getWeekByKey(sourceWeekKey) : await getWeek(stateWeekOff);
  const currentTask = sourceData[state.q]?.[state.i];

  if (!currentTask) {
    closeTaskEditModal();
    toast('Task không còn tồn tại');
    return;
  }

  const updatedTask = {
    ...currentTask,
    text: title,
    note,
    hours,
    date,
    startTime,
    updated: Date.now()
  };

  if (currentTask.gcalEventSummary || hasLinkedGoogleCalendarEvent(currentTask)) {
    updatedTask.gcalEventSummary = title;
  }

  const targetWeekKey = date ? weekKeyForDate(date) : sourceWeekKey;
  const shouldMoveWeek = Boolean(date && targetWeekKey && targetWeekKey !== sourceWeekKey);

  if (shouldMoveWeek) {
    sourceData[state.q].splice(state.i, 1);
    await setWeekByKey(sourceWeekKey, sourceData);

    const targetData = await getWeekByKey(targetWeekKey);
    targetData[state.q] = targetData[state.q] || [];
    targetData[state.q].push(updatedTask);
    await setWeekByKey(targetWeekKey, targetData);
  } else if (state.weekKey) {
    sourceData[state.q][state.i] = updatedTask;
    await setWeekByKey(sourceWeekKey, sourceData);
  } else {
    sourceData[state.q][state.i] = updatedTask;
    await setWeek(stateWeekOff, sourceData);
  }

  invalidateWeeksCache();
  closeTaskEditModal();

  const visibleWeekKey = getCurrentWeekKey();
  if (visibleWeekKey === sourceWeekKey || visibleWeekKey === targetWeekKey) {
    renderTasks();
    if (document.getElementById('page-goals')?.classList.contains('on')) renderGoals();
  }

  let message = shouldMoveWeek
    ? `✓ Đã lưu task và chuyển sang tuần ${formatWeekOfDateLabel(date)}`
    : '✓ Đã lưu task';

  if (hasLinkedGoogleCalendarEvent(updatedTask)) {
    const result = await syncEditedTaskToGoogleCalendar(stateWeekOff, state.q, state.i, currentTask, updatedTask);
    if (result.ok) {
      if (document.getElementById('page-gcal')?.classList.contains('on')) loadGCalFromSelected();
      message = shouldMoveWeek
        ? `✓ Đã cập nhật task, Google Calendar và chuyển sang tuần ${formatWeekOfDateLabel(date)}`
        : '✓ Đã cập nhật task và Google Calendar';
    } else {
      message = `⚠️ Đã lưu task nhưng chưa cập nhật Google Calendar: ${result.message}`;
    }
  }

  toast(message);
};

createTaskFromGCalPage = async function() {
  const title = document.getElementById('gn-title').value.trim();
  const quadrant = document.getElementById('gtask-quadrant')?.value || 'q2';
  const date = document.getElementById('gn-date').value;
  const startTime = document.getElementById('gn-start').value || '';
  const hours = normalizeTaskHours(document.getElementById('gn-dur').value);
  const note = document.getElementById('gn-desc').value.trim();
  if (!title || !date) { toast('Cần có tên task và ngày'); return; }

  const targetWeekKey = weekKeyForDate(date);
  const data = await getWeekByKey(targetWeekKey);
  data[quadrant] = data[quadrant] || [];
  data[quadrant].push(buildManualTaskRecord({
    text: title,
    date,
    hours,
    note,
    startTime,
    source: 'manual'
  }));
  await setWeekByKey(targetWeekKey, data);
  invalidateWeeksCache();

  document.getElementById('gn-title').value = '';
  document.getElementById('gn-date').value = '';
  document.getElementById('gn-start').value = '';
  document.getElementById('gn-dur').value = '1';
  document.getElementById('gn-desc').value = '';

  if (targetWeekKey === getCurrentWeekKey()) renderTasks();
  if (document.getElementById('page-gcal')?.classList.contains('on')) loadGCalFromSelected();

  const weekHint = targetWeekKey === getCurrentWeekKey() ? '' : ` · tuần ${formatWeekOfDateLabel(date)}`;
  toast(`✓ Đã tạo task vào ${Q_LABELS[quadrant]}${weekHint}`);
};

importEventAsTask = async function(destQ) {
  const ev = _pendingImportEvent;
  if (!ev) return;

  const dateStr = getEventDateKey(ev);
  if (!dateStr) {
    toast('Event này chưa có ngày hợp lệ');
    closeEventImport();
    return;
  }

  const targetWeekKey = weekKeyForDate(dateStr);
  const data = await getWeekByKey(targetWeekKey);
  const existing = findTaskLocationByGoogleEventId(data, ev.id) || findLegacySyncedTaskLocation(data, ev, dateStr);
  if (existing) {
    toast('Event này đã được thêm vào Ma trận rồi');
    closeEventImport();
    return;
  }

  data[destQ] = data[destQ] || [];
  const importedTask = buildSyncedTaskFromEvent(ev, {
    done: false,
    goalId: null,
    created: Date.now()
  });
  importedTask.text = ev.summary || importedTask.text;
  data[destQ].push(importedTask);
  await setWeekByKey(targetWeekKey, data);
  invalidateWeeksCache();
  closeEventImport();

  if (targetWeekKey === getCurrentWeekKey()) renderTasks();
  if (document.getElementById('page-gcal')?.classList.contains('on')) loadGCalFromSelected();

  toast(`✓ Đã thêm "${ev.summary || 'Event'}" vào ${Q_LABELS[destQ]} · tuần ${formatWeekOfDateLabel(dateStr)}`);
};

syncFromGCal = async function() {
  if (!gCalToken) {
    connectGCal();
    return;
  }

  if (!allCalendars.length) await fetchCalendarList();
  const activeCals = allCalendars.filter(c => c.selected);
  if (!activeCals.length) {
    toast('Hãy chọn ít nhất 1 lịch để đồng bộ');
    return;
  }

  toast('Đang đồng bộ...');
  const { mon, sun } = getSelectedGCalDateRange();

  try {
    const results = await Promise.all(activeCals.map(async c => {
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?timeMin=${mon.toISOString()}&timeMax=${sun.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=100`, {
        headers: { Authorization: `Bearer ${gCalToken}` }
      });
      if (r.status === 401) {
        clearStoredGCalToken();
        throw new Error('Google Calendar token đã hết hạn. Hãy cấp quyền lại.');
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `Không tải được lịch ${c.summary || c.id}`);
      }
      const j = await r.json();
      return (j.items || []).map(e => ({ ...e, _calName: c.summary, _calId: c.id, _itemType: 'event' }));
    }));

    const flatEvents = results.flat();
    const rangeWeekKeys = getWeekKeysInRange(mon, sun);
    const targetWeekKeys = flatEvents.map(ev => weekKeyForDate(getEventDateKey(ev))).filter(Boolean);
    const weekMap = await getWeekMapByKeys([...rangeWeekKeys, ...targetWeekKeys]);
    const touchedWeekKeys = new Set();
    let added = 0;
    let updated = 0;

    flatEvents.forEach(ev => {
      if (isAppCreatedGCalEvent(ev) || !ev.id) return;
      const dateStr = getEventDateKey(ev);
      if (!dateStr) return;

      const targetWeekKey = weekKeyForDate(dateStr);
      weekMap[targetWeekKey] = ensureWeekShape(weekMap[targetWeekKey] || {});
      const existing = findSyncedTaskLocationInWeekMap(weekMap, ev.id, ev, dateStr);

      if (existing) {
        const currentTask = weekMap[existing.weekKey][existing.q][existing.i];
        const nextTask = buildSyncedTaskFromEvent(ev, currentTask);
        if (existing.weekKey === targetWeekKey) {
          weekMap[targetWeekKey][existing.q][existing.i] = nextTask;
        } else {
          weekMap[existing.weekKey][existing.q].splice(existing.i, 1);
          weekMap[targetWeekKey][existing.q] = weekMap[targetWeekKey][existing.q] || [];
          weekMap[targetWeekKey][existing.q].push(nextTask);
          touchedWeekKeys.add(existing.weekKey);
        }
        touchedWeekKeys.add(targetWeekKey);
        updated++;
        return;
      }

      weekMap[targetWeekKey].q3 = weekMap[targetWeekKey].q3 || [];
      weekMap[targetWeekKey].q3.push(buildSyncedTaskFromEvent(ev, {}));
      touchedWeekKeys.add(targetWeekKey);
      added++;
    });

    const syncedAt = Date.now();
    await Promise.all([...touchedWeekKeys].map(async weekKeyValue => {
      weekMap[weekKeyValue].lastGoogleCalendarSyncAt = syncedAt;
      await setWeekByKey(weekKeyValue, weekMap[weekKeyValue]);
    }));

    invalidateWeeksCache();
    if (touchedWeekKeys.has(getCurrentWeekKey())) renderTasks();
    if (document.getElementById('page-gcal')?.classList.contains('on')) {
      renderGCalPush();
      loadGCalFromSelected();
    }

    if (!added && !updated) toast('Không có event mới để đồng bộ');
    else if (added && updated) toast(`✓ Đồng bộ GCal: thêm ${added}, cập nhật ${updated}`);
    else if (added) toast(`✓ Đồng bộ GCal: thêm ${added} event`);
    else toast(`✓ Đồng bộ GCal: cập nhật ${updated} event`);
  } catch (e) {
    toast('Lỗi đồng bộ: ' + e.message);
  }
};