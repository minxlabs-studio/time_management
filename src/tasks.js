// ── TASKS ─────────────────────────────
// Keep these globals because index.html still uses inline handlers.
const Q_LABELS = { q1: 'Ô 1', q2: 'Ô 2', q3: 'Ô 3', q4: 'Ô 4' };

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
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 4px">Chưa có việc nào — kéo task vào đây hoặc thêm bên dưới</div>';
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

  if (task.gcalEventId && gCalToken) {
    const alsoDeleteGCal = confirm(`Task này liên kết với 1 event trên Google Calendar.\n\nOK = Xóa cả task và event GCal\nCancel = Chỉ xóa task trong app (giữ event GCal)`);
    if (alsoDeleteGCal) {
      try {
        const calId = encodeURIComponent(task.gcalCalId || 'primary');
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${task.gcalEventId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${gCalToken}` }
        });
        if (r.ok || r.status === 410) toast('✓ Đã xóa event trên Google Calendar');
        else toast('⚠️ Không xóa được event GCal (status ' + r.status + '), nhưng task đã xóa khỏi app');
      } catch (e) {
        toast('⚠️ Lỗi xóa event GCal: ' + e.message + ' — task vẫn được xóa khỏi app');
      }
    }
  }

  data[q].splice(i, 1);
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  renderTasks();
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
    toast('Đang có 1 phiên tập trung khác — hãy hoàn tất trước.');
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