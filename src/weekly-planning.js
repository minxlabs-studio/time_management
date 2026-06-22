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
