// ── TASKS ─────────────────────────────
// Keep these globals because index.html still uses inline handlers.
const Q_LABELS = { q1: 'Ô 1', q2: 'Ô 2', q3: 'Ô 3', q4: 'Ô 4' };
const SYNC_QUADRANTS = ['q1', 'q2', 'q3', 'q4'];

function getGoogleCalendarEventId(task) {
  return task?.googleCalendarEventId || task?.gcalEventId || null;
}

function buildSyncedTaskText(ev) {
  const summary = ev.summary || 'Event';
  return ev._calName ? `${summary} [${ev._calName}]` : summary;
}

function getSyncedEventDate(ev) {
  return (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
}

function getSyncedEventHours(ev) {
  if (!ev.start?.dateTime) return 0;
  const start = new Date(ev.start.dateTime);
  const fallbackEnd = new Date(start.getTime() + 60 * 60000);
  const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : fallbackEnd;
  const durationMs = Math.max(0, end - start);
  return Math.round(durationMs / 360000) / 10;
}

function isAppCreatedGCalEvent(ev) {
  return /^\[(Ô|Q)[1-4]\]/.test(ev.summary || '');
}

function findTaskLocationByGoogleEventId(data, eventId) {
  if (!eventId) return null;
  for (const q of SYNC_QUADRANTS) {
    const idx = (data[q] || []).findIndex(task => getGoogleCalendarEventId(task) === eventId);
    if (idx !== -1) return { q, i: idx };
  }
  return null;
}

function findLegacySyncedTaskLocation(data, ev, dateStr) {
  const legacyText = buildSyncedTaskText(ev);
  for (const q of SYNC_QUADRANTS) {
    const idx = (data[q] || []).findIndex(task => (
      task.gcal &&
      !getGoogleCalendarEventId(task) &&
      task.date === dateStr &&
      task.text === legacyText
    ));
    if (idx !== -1) return { q, i: idx };
  }
  return null;
}

function buildSyncedTaskFromEvent(ev, existingTask = {}) {
  return {
    ...existingTask,
    text: buildSyncedTaskText(ev),
    hours: getSyncedEventHours(ev),
    date: getSyncedEventDate(ev),
    gcal: true,
    gcalEventId: ev.id,
    googleCalendarEventId: ev.id,
    gcalCalId: ev._calId || existingTask.gcalCalId || 'primary',
    updated: Date.now(),
    created: existingTask.created || Date.now()
  };
}

function applyMatrixUiTouchups() {
  if (document.getElementById('matrix-ui-touchups')) return;
  const style = document.createElement('style');
  style.id = 'matrix-ui-touchups';
  style.textContent = `
    .week-nav{margin-bottom:1.5rem;gap:10px}
    .week-nav-l{gap:10px}
    .wn-btn{padding:9px 16px;font-size:15px;min-width:42px;min-height:42px}
    .wn-btn-primary,.sync-btn{padding:10px 16px;font-size:14px;min-height:42px}
    .matrix-grid{gap:20px}
    .quadrant{padding:24px}
    .quad-head{gap:14px;margin-bottom:18px}
    .quad-icon{width:44px;height:44px;border-radius:12px;font-size:20px}
    .quad-title{font-size:16px;line-height:1.35}
    .quad-sub{font-size:12px;margin-top:4px;line-height:1.5}
    .quad-badge{font-size:12px;padding:6px 12px}
    .quad-tasks{min-height:56px}
    .task-item{gap:12px;padding:14px 14px 14px 12px;border-radius:10px;margin-bottom:10px}
    .t-check{width:22px;height:22px;border-radius:6px;border-width:2px;margin-top:2px}
    .t-check.done::after{font-size:13px}
    .t-text{font-size:14px;line-height:1.5}
    .t-meta{gap:8px;margin-top:7px}
    .t-meta span{font-size:12px}
    .t-actions{gap:6px}
    .t-act-btn{font-size:13px;padding:6px 10px;min-width:36px;min-height:36px;display:inline-flex;align-items:center;justify-content:center}
    .add-form{padding-top:12px;margin-top:10px;gap:8px}
    .add-form-row{gap:8px}
    .add-form input[type=text]{font-size:14px;padding:10px 12px}
    .add-form input[type=number]{width:72px;font-size:14px;padding:10px 8px}
    .add-form input[type=date]{font-size:13px;padding:10px 10px}
    .add-form .add-btn{padding:10px 16px;font-size:14px;min-height:40px}
    @media(max-width:640px){
      .matrix-grid{gap:14px}
      .quadrant{padding:18px}
      .quad-badge{align-self:flex-start}
      .task-item{padding:12px}
      .add-form-row{flex-wrap:wrap}
      .add-form input[type=number]{width:80px}
      .add-form input[type=date]{min-width:0}
    }
  `;
  document.head.appendChild(style);
}

applyMatrixUiTouchups();

async function renderTasks() {
  const data = await getWeek(weekOffset);
  ['q1', 'q2', 'q3', 'q4'].forEach(q => {
    buildTaskList(q, data[q] || []);
    buildAddForm(q);
  });
  buildStats(data);
  renderGCalPush();
}

function buildTaskList(q, tasks) {
  const el = document.getElementById('tl-' + q);
  if (!tasks.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:10px 4px;line-height:1.6">Chưa có việc nào - kéo task vào đây hoặc thêm bên dưới</div>';
    return;
  }

  el.innerHTML = tasks.map((t, i) => `
    <div class="task-item" draggable="true" data-q="${q}" data-i="${i}"
         ondragstart="onTaskDragStart(event,'${q}',${i})" ondragend="onTaskDragEnd(event)">
      <button class="t-check ${t.done ? 'done' : ''}" onclick="toggleTask('${q}',${i})" aria-label="Đánh dấu hoàn thành"></button>
      <div class="t-body">
        <div class="t-text ${t.done ? 'done' : ''}">${esc(t.text)}</div>
        <div class="t-meta">
          ${t.hours ? `<span>⏱ ${t.hours}h</span>` : ''}
          ${t.actualMinutes ? `<span>🔥 ${fmtFocusMin(t.actualMinutes)} đã tập trung</span>` : ''}
          ${t.date ? `<span>📅 ${fmtD(t.date)}</span>` : ''}
          ${t.goalId ? `<span class="goal-tag" style="background:${goalColor(t.goalId, true)};color:${goalColor(t.goalId, false)}">🎯 Goal</span>` : ''}
          ${t.gcal ? `<span class="gcal-dot">● GCal</span>` : ''}
        </div>
      </div>
      <div class="t-actions">
        <button class="t-act-btn t-act-btn-focus" data-task-text="${esc(t.text)}" onclick='startFocus("${q}",${i},this.dataset.taskText)' title="Bắt đầu tập trung">▶</button>
        ${!t.gcal && t.date ? `<button class="t-act-btn" onclick="pushTask('${q}',${i})" title="Đẩy lên GCal">📅</button>` : ''}
        <button class="t-act-btn" onclick="deleteTask('${q}',${i})" title="Xóa">×</button>
      </div>
    </div>`).join('');
}

// ── DRAG & DROP: kéo task giữa 4 ô ─────────────────
let dragSource = null; // {q, i}

function onTaskDragStart(ev, q, i) {
  dragSource = { q, i };
  ev.currentTarget.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', `${q}:${i}`);
}

function onTaskDragEnd(ev) {
  ev.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.quadrant.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function onQuadDragOver(ev, q) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('drag-over');
}

function onQuadDragLeave(ev) {
  if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drag-over');
}

async function onQuadDrop(ev, destQ) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if (!dragSource) return;

  const { q: srcQ, i: srcI } = dragSource;
  dragSource = null;
  if (srcQ === destQ) return;

  const data = await getWeek(weekOffset);
  if (!data[srcQ] || !data[srcQ][srcI]) return;

  const [moved] = data[srcQ].splice(srcI, 1);
  if (!data[destQ]) data[destQ] = [];
  data[destQ].push(moved);
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  renderTasks();
  toast(`Đã chuyển sang ${Q_LABELS[destQ]}`);
}

function buildAddForm(q) {
  document.getElementById('af-' + q).innerHTML = `
    <input type="text" placeholder="Thêm việc..." id="in-${q}" onkeydown="if(event.key==='Enter')addTask('${q}')">
    <div class="add-form-row">
      <input type="number" placeholder="h" id="ih-${q}" min="0.5" max="24" step="0.5" title="Số giờ">
      <input type="date" id="id-${q}">
      <button class="add-btn" onclick="addTask('${q}')">+ Thêm</button>
    </div>`;
}

async function addTask(q) {
  const txt = document.getElementById('in-' + q)?.value?.trim();
  if (!txt) return;

  const h = parseFloat(document.getElementById('ih-' + q)?.value) || 0;
  const dt = document.getElementById('id-' + q)?.value || '';
  const data = await getWeek(weekOffset);
  if (!data[q]) data[q] = [];
  data[q].push({ text: txt, hours: h, date: dt, done: false, gcal: false, created: Date.now() });
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  renderTasks();
  toast('Đã thêm: ' + txt);
}

async function toggleTask(q, i) {
  const data = await getWeek(weekOffset);
  data[q][i].done = !data[q][i].done;
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  renderTasks();
}

async function deleteTask(q, i) {
  const data = await getWeek(weekOffset);
  const task = data[q] && data[q][i];
  if (!task) return;

  const googleEventId = getGoogleCalendarEventId(task);
  if (googleEventId && gCalToken) {
    const alsoDeleteGCal = confirm(`Task này liên kết với 1 event trên Google Calendar.\n\nOK = Xóa cả task và event GCal\nCancel = Chỉ xóa task trong app (giữ event GCal)`);
    if (alsoDeleteGCal) {
      try {
        const calId = encodeURIComponent(task.gcalCalId || 'primary');
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${googleEventId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${gCalToken}` }
        });
        if (r.ok || r.status === 410) toast('✓ Đã xóa event trên Google Calendar');
        else toast('⚠️ Không xóa được event GCal (status ' + r.status + '), nhưng task đã xóa khỏi app');
      } catch (e) {
        toast('⚠️ Lỗi xóa event GCal: ' + e.message + ' - task vẫn được xóa khỏi app');
      }
    }
  }

  data[q].splice(i, 1);
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  renderTasks();
}

async function importEventAsTask(destQ) {
  const ev = _pendingImportEvent;
  if (!ev) return;

  const data = await getWeek(weekOffset);
  const eventId = ev.id;
  const dateStr = getSyncedEventDate(ev);
  const existing = findTaskLocationByGoogleEventId(data, eventId) || findLegacySyncedTaskLocation(data, ev, dateStr);
  if (existing) {
    toast('Event này đã được thêm vào Ma trận rồi');
    closeEventImport();
    return;
  }

  if (!data[destQ]) data[destQ] = [];
  data[destQ].push({
    text: ev.summary || 'Event',
    hours: getSyncedEventHours(ev),
    date: dateStr,
    done: false,
    gcal: true,
    gcalEventId: ev.id,
    googleCalendarEventId: ev.id,
    gcalCalId: ev._calId || 'primary',
    goalId: null,
    created: Date.now()
  });
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  closeEventImport();
  renderTasks();
  toast(`✓ Đã thêm "${ev.summary || 'Event'}" vào ${Q_LABELS[destQ]}`);
}

async function syncFromGCal() {
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
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - now.getDay() + 1 + weekOffset * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  try {
    const results = await Promise.all(activeCals.map(async c => {
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?timeMin=${mon.toISOString()}&timeMax=${sun.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=100`, {
        headers: { Authorization: `Bearer ${gCalToken}` }
      });
      if (r.status === 401) {
        localStorage.removeItem('gct');
        localStorage.removeItem('gct_exp');
        gCalToken = null;
        throw new Error('Google Calendar token đã hết hạn. Hãy cấp quyền lại.');
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `Không tải được lịch ${c.summary || c.id}`);
      }
      const j = await r.json();
      return (j.items || []).map(e => ({ ...e, _calName: c.summary, _calId: c.id }));
    }));

    const data = await getWeek(weekOffset);
    let added = 0;
    let updated = 0;

    results.flat().forEach(ev => {
      if (isAppCreatedGCalEvent(ev)) return;
      if (!ev.id) return;
      const dateStr = getSyncedEventDate(ev);
      if (!dateStr) return;

      const existing = findTaskLocationByGoogleEventId(data, ev.id) || findLegacySyncedTaskLocation(data, ev, dateStr);
      const nextTask = buildSyncedTaskFromEvent(ev, existing ? data[existing.q][existing.i] : {});
      if (existing) {
        data[existing.q][existing.i] = nextTask;
        updated++;
      } else {
        data.q3 = data.q3 || [];
        data.q3.push(nextTask);
        added++;
      }
    });

    data.lastGoogleCalendarSyncAt = Date.now();
    await setWeek(weekOffset, data);
    invalidateWeeksCache();
    renderTasks();
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
}

// ── FOCUS BLOCK TIMER ─────────────────────────────
let focusState = null; // {q, i, text, weekOff, startedAt, elapsedMs, paused, tickHandle}

function fmtFocusMin(mins) {
  if (mins < 60) return `${mins}p`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${m}p` : `${h}h`;
}

function fmtFocusClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startFocus(q, i, text) {
  if (focusState) {
    toast('Đang có 1 phiên tập trung khác - hãy hoàn tất trước.');
    return;
  }

  focusState = { q, i, text, weekOff: weekOffset, startedAt: Date.now(), elapsedMs: 0, paused: false };
  persistFocusState();
  document.getElementById('focus-bar-task').textContent = text;
  document.getElementById('focus-bar').classList.add('on');
  document.getElementById('focus-btn-pause').textContent = '⏸ Tạm dừng';
  runFocusTick();
  toast('▶ Bắt đầu tập trung: ' + text);
}

function runFocusTick() {
  if (focusState.tickHandle) clearInterval(focusState.tickHandle);
  focusState.tickHandle = setInterval(() => {
    if (!focusState || focusState.paused) return;
    const liveMs = focusState.elapsedMs + (Date.now() - focusState.startedAt);
    document.getElementById('focus-bar-time').textContent = fmtFocusClock(liveMs);
  }, 1000);
}

function toggleFocusPause() {
  if (!focusState) return;

  if (focusState.paused) {
    focusState.startedAt = Date.now();
    focusState.paused = false;
    document.getElementById('focus-btn-pause').textContent = '⏸ Tạm dừng';
    toast('▶ Tiếp tục');
  } else {
    focusState.elapsedMs += Date.now() - focusState.startedAt;
    focusState.paused = true;
    document.getElementById('focus-btn-pause').textContent = '▶ Tiếp tục';
    toast('⏸ Đã tạm dừng');
  }

  persistFocusState();
}

async function stopFocus() {
  if (!focusState) return;

  const finalMs = focusState.paused ? focusState.elapsedMs : focusState.elapsedMs + (Date.now() - focusState.startedAt);
  const minutes = Math.max(1, Math.round(finalMs / 60000));
  const { q, i, text, weekOff } = focusState;
  clearInterval(focusState.tickHandle);

  try {
    const data = await getWeek(weekOff);
    if (data[q] && data[q][i]) {
      data[q][i].actualMinutes = (data[q][i].actualMinutes || 0) + minutes;
      await setWeek(weekOff, data);
      invalidateWeeksCache();
    }
    await col('focusSessions').add({
      taskText: text,
      minutes,
      q,
      weekOff,
      finishedAt: Date.now(),
      created: Date.now()
    });
  } catch (e) {
    console.error('Lỗi lưu focus session:', e);
    toast('⚠️ Có lỗi khi lưu, nhưng phiên tập trung vẫn được tính ' + minutes + ' phút');
  }

  focusState = null;
  localStorage.removeItem('focus_state');
  document.getElementById('focus-bar').classList.remove('on');
  toast(`✓ Hoàn tất ${minutes} phút tập trung: ${text}`);
  renderTasks();
  if (document.getElementById('page-goals')?.classList.contains('on')) renderGoals();
}

function persistFocusState() {
  if (!focusState) {
    localStorage.removeItem('focus_state');
    return;
  }

  const { tickHandle, ...toSave } = focusState;
  localStorage.setItem('focus_state', JSON.stringify(toSave));
}

function restoreFocusState() {
  const raw = localStorage.getItem('focus_state');
  if (!raw) return;

  try {
    focusState = JSON.parse(raw);
    document.getElementById('focus-bar-task').textContent = focusState.text;
    document.getElementById('focus-bar').classList.add('on');
    document.getElementById('focus-btn-pause').textContent = focusState.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
    runFocusTick();
  } catch (e) {
    localStorage.removeItem('focus_state');
  }
}

function buildStats(data) {
  let tot = 0;
  let dn = 0;
  let hq2 = 0;
  let hall = 0;

  ['q1', 'q2', 'q3', 'q4'].forEach(q => (data[q] || []).forEach(t => {
    tot++;
    if (t.done) dn++;
    hall += t.hours || 0;
    if (q === 'q2') hq2 += t.hours || 0;
  }));

  const pct = tot ? Math.round(dn / tot * 100) : 0;
  const q2r = hall ? Math.round(hq2 / hall * 100) : 0;
  const q2Badge = q2r >= 30 ? `<span class="stat-badge good">✓ Tốt</span>` : `<span class="stat-badge warn">⚠ Thấp</span>`;
  const doneBadge = pct >= 70 ? `<span class="stat-badge good">↗ Tốt</span>` : `<span class="stat-badge neutral">${dn}/${tot}</span>`;

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-head"><div class="stat-icon-box">📋</div><span class="stat-badge neutral">tuần này</span></div>
      <div class="stat-lbl">Tổng việc</div><div class="stat-val">${tot}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-head"><div class="stat-icon-box">✓</div>${doneBadge}</div>
      <div class="stat-lbl">Hoàn thành</div><div class="stat-val">${pct}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-head"><div class="stat-icon-box">⏱</div><span class="stat-badge neutral">ước tính</span></div>
      <div class="stat-lbl">Tổng giờ</div><div class="stat-val">${hall}h</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-head"><div class="stat-icon-box">🎯</div>${q2Badge}</div>
      <div class="stat-lbl">Tỉ lệ Ô 2</div><div class="stat-val">${q2r}%</div>
    </div>`;
}
