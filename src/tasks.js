// ── TASKS ─────────────────────────────
// Keep these globals because index.html still uses inline handlers.
const Q_LABELS = { q1: 'Ô 1', q2: 'Ô 2', q3: 'Ô 3', q4: 'Ô 4' };
const Q_EVENT_LABELS = { q1: 'Ô1', q2: 'Ô2', q3: 'Ô3', q4: 'Ô4' };
const SYNC_QUADRANTS = ['q1', 'q2', 'q3', 'q4'];
let taskEditState = null;

function clearStoredGCalToken() {
  localStorage.removeItem('gct');
  localStorage.removeItem('gct_exp');
  gCalToken = null;
}

function getGoogleCalendarEventId(task) {
  return task?.googleCalendarEventId || task?.gcalEventId || null;
}

function hasLinkedGoogleCalendarEvent(task) {
  return Boolean(task?.gcal && getGoogleCalendarEventId(task));
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

function getExistingEventDurationMs(ev) {
  if (ev.start?.dateTime && ev.end?.dateTime) {
    const start = new Date(ev.start.dateTime);
    const end = new Date(ev.end.dateTime);
    const duration = end - start;
    if (duration > 0) return duration;
  }
  if (ev.start?.date && ev.end?.date) {
    const start = new Date(`${ev.start.date}T00:00:00+07:00`);
    const end = new Date(`${ev.end.date}T00:00:00+07:00`);
    const duration = end - start;
    if (duration > 0) return duration;
  }
  return 60 * 60000;
}

function isAppCreatedGCalEvent(ev) {
  return /^\[(Ô|Q)[1-4]\]/.test(ev.summary || '');
}

function stripQuadrantPrefix(text) {
  return String(text || '').replace(/^\[(Ô|Q)[1-4]\]\s*/, '').trim();
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
    note: ev.description !== undefined ? ev.description : (existingTask.note || ''),
    gcal: true,
    gcalEventId: ev.id,
    googleCalendarEventId: ev.id,
    gcalCalId: ev._calId || existingTask.gcalCalId || 'primary',
    gcalEventSummary: stripQuadrantPrefix(ev.summary || existingTask.gcalEventSummary || existingTask.text || ''),
    gcalCalendarName: ev._calName || existingTask.gcalCalendarName || '',
    updated: Date.now(),
    created: existingTask.created || Date.now()
  };
}

function getTaskEditableTitle(task) {
  if (task?.gcalEventSummary) return stripQuadrantPrefix(task.gcalEventSummary);
  return task?.text || '';
}

function getTaskNotePreview(note) {
  const clean = String(note || '').trim();
  if (!clean) return '';
  return clean.length > 120 ? clean.slice(0, 117) + '...' : clean;
}

function normalizeTaskHours(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 10) / 10;
}

function getTaskGCalDescription(task, q, fallback = '') {
  const note = String(task?.note || '').trim();
  return note || fallback || `${Q_LABELS[q]}\nTạo từ Đá Trước`;
}

function buildUpdatedEventSummary(existingSummary, q, title) {
  if (/^\[(Ô|Q)[1-4]\]\s*/.test(existingSummary || '')) {
    return `[${Q_EVENT_LABELS[q]}] ${title}`;
  }
  return title;
}

function buildEditedEventPayload(existingEvent, q, task) {
  if (!task.date) return null;

  const summary = buildUpdatedEventSummary(existingEvent.summary, q, task.text);
  const description = getTaskGCalDescription(task, q, '');
  const timeZone = existingEvent.start?.timeZone || existingEvent.end?.timeZone || 'Asia/Ho_Chi_Minh';
  const shouldUseTimedEvent = Boolean(existingEvent.start?.dateTime || existingEvent.end?.dateTime || task.hours);

  if (shouldUseTimedEvent) {
    const durationMs = task.hours ? task.hours * 3600000 : getExistingEventDurationMs(existingEvent);
    const start = existingEvent.start?.dateTime
      ? new Date(existingEvent.start.dateTime)
      : new Date(`${task.date}T09:00:00+07:00`);
    if (Number.isNaN(start.getTime())) return null;

    const [year, month, day] = task.date.split('-').map(Number);
    start.setFullYear(year, month - 1, day);
    const end = new Date(start.getTime() + Math.max(durationMs, 30 * 60000));

    return {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone }
    };
  }

  const end = new Date(`${task.date}T00:00:00+07:00`);
  if (Number.isNaN(end.getTime())) return null;
  end.setDate(end.getDate() + 1);

  return {
    summary,
    description,
    start: { date: task.date },
    end: { date: end.toISOString().slice(0, 10) }
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
    .t-note{font-size:12px;color:var(--text2);line-height:1.5;margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
    .t-meta{gap:8px;margin-top:7px}
    .t-meta span{font-size:12px}
    .t-actions{gap:6px;flex-wrap:wrap}
    .t-act-btn{font-size:13px;padding:6px 10px;min-width:36px;min-height:36px;display:inline-flex;align-items:center;justify-content:center}
    .add-form{padding-top:12px;margin-top:10px;gap:8px}
    .add-form-row{gap:8px}
    .add-form input[type=text]{font-size:14px;padding:10px 12px}
    .add-form input[type=number]{width:72px;font-size:14px;padding:10px 8px}
    .add-form input[type=date]{font-size:13px;padding:10px 10px}
    .add-form .add-btn{padding:10px 16px;font-size:14px;min-height:40px}
    .task-edit-hint{font-size:12px;color:var(--text3);line-height:1.6;margin-top:2px}
    #task-edit-modal textarea{min-height:88px;resize:vertical}
    #task-edit-modal .modal{width:540px}
    @media(max-width:640px){
      .matrix-grid{gap:14px}
      .quadrant{padding:18px}
      .quad-badge{align-self:flex-start}
      .task-item{padding:12px}
      .add-form-row{flex-wrap:wrap}
      .add-form input[type=number]{width:80px}
      .add-form input[type=date]{min-width:0}
      #task-edit-modal .modal{width:95vw;padding:1.25rem}
    }
  `;
  document.head.appendChild(style);
}

function ensureTaskEditModal() {
  if (document.getElementById('task-edit-modal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'task-edit-modal';
  wrap.innerHTML = `
    <div class="modal-bg" id="task-edit-modal-bg">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">Sửa task</span>
          <button class="modal-close" onclick="closeTaskEditModal()">×</button>
        </div>
        <div class="modal-form">
          <div class="form-group">
            <label>Tiêu đề task *</label>
            <input type="text" id="te-title" placeholder="VD: Chuẩn bị tài liệu họp">
          </div>
          <div class="modal-form form-row">
            <div class="form-group">
              <label>Giờ ước tính</label>
              <input type="number" id="te-hours" min="0" max="24" step="0.5" placeholder="VD: 1.5">
            </div>
            <div class="form-group">
              <label>Ngày</label>
              <input type="date" id="te-date">
            </div>
          </div>
          <div class="form-group">
            <label>Ghi chú / mô tả</label>
            <textarea id="te-note" placeholder="Thêm ghi chú ngắn nếu cần..."></textarea>
          </div>
          <div class="task-edit-hint" id="task-edit-hint"></div>
        </div>
        <div class="modal-foot">
          <button class="btn-cancel" onclick="closeTaskEditModal()">Hủy</button>
          <button class="btn-save" onclick="saveTaskEdit()">Lưu task</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
}

applyMatrixUiTouchups();
ensureTaskEditModal();

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
        ${t.note ? `<div class="t-note" title="${esc(t.note)}">${esc(getTaskNotePreview(t.note))}</div>` : ''}
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
        <button class="t-act-btn" onclick="openTaskEdit('${q}',${i})" title="Sửa task">✎</button>
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
    <input type="text" placeholder="Ghi chú (tuỳ chọn)" id="in-note-${q}" onkeydown="if(event.key==='Enter')addTask('${q}')">
    <div class="add-form-row">
      <input type="number" placeholder="h" id="ih-${q}" min="0" max="24" step="0.5" title="Số giờ">
      <input type="date" id="id-${q}">
      <button class="add-btn" onclick="addTask('${q}')">+ Thêm</button>
    </div>`;
}

async function addTask(q) {
  const txt = document.getElementById('in-' + q)?.value?.trim();
  if (!txt) return;

  const note = document.getElementById('in-note-' + q)?.value?.trim() || '';
  const h = normalizeTaskHours(document.getElementById('ih-' + q)?.value);
  const dt = document.getElementById('id-' + q)?.value || '';
  const data = await getWeek(weekOffset);
  if (!data[q]) data[q] = [];
  data[q].push({ text: txt, note, hours: h, date: dt, done: false, gcal: false, created: Date.now() });
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

async function openTaskEdit(q, i) {
  const data = await getWeek(weekOffset);
  const task = data[q]?.[i];
  if (!task) {
    toast('Không tìm thấy task để sửa');
    return;
  }

  ensureTaskEditModal();
  taskEditState = { q, i, weekOff: weekOffset };
  document.getElementById('te-title').value = getTaskEditableTitle(task);
  document.getElementById('te-hours').value = task.hours || '';
  document.getElementById('te-date').value = task.date || '';
  document.getElementById('te-note').value = task.note || '';
  document.getElementById('task-edit-hint').textContent = hasLinkedGoogleCalendarEvent(task)
    ? 'Task này đang liên kết Google Calendar. Khi lưu, app sẽ cập nhật event hiện có. Nếu không cập nhật được, thay đổi trong app vẫn được giữ an toàn.'
    : 'Chỉnh sửa sẽ chỉ cập nhật task trong app.';
  document.getElementById('task-edit-modal-bg').classList.add('on');
  document.getElementById('te-title').focus();
  document.getElementById('te-title').select();
}

function closeTaskEditModal() {
  document.getElementById('task-edit-modal-bg')?.classList.remove('on');
  taskEditState = null;
}

async function saveTaskEdit() {
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

  const data = await getWeek(state.weekOff);
  const currentTask = data[state.q]?.[state.i];
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
    updated: Date.now()
  };

  if (currentTask.gcalEventSummary || hasLinkedGoogleCalendarEvent(currentTask)) {
    updatedTask.gcalEventSummary = title;
  }

  data[state.q][state.i] = updatedTask;
  await setWeek(state.weekOff, data);
  invalidateWeeksCache();
  closeTaskEditModal();

  if (state.weekOff === weekOffset) {
    renderTasks();
    if (document.getElementById('page-goals')?.classList.contains('on')) renderGoals();
  }

  let message = '✓ Đã lưu task';
  if (hasLinkedGoogleCalendarEvent(updatedTask)) {
    const result = await syncEditedTaskToGoogleCalendar(state.weekOff, state.q, state.i, currentTask, updatedTask);
    if (result.ok) {
      if (document.getElementById('page-gcal')?.classList.contains('on')) loadGCalFromSelected();
      message = '✓ Đã cập nhật task và Google Calendar';
    } else {
      message = `⚠️ Đã lưu task nhưng chưa cập nhật Google Calendar: ${result.message}`;
    }
  }

  toast(message);
}

async function syncEditedTaskToGoogleCalendar(weekOff, q, i, previousTask, updatedTask) {
  const googleEventId = getGoogleCalendarEventId(updatedTask);
  if (!googleEventId) return { ok: false, message: 'task này chưa có event liên kết' };
  if (!gCalToken || (typeof isGCalTokenValid === 'function' && !isGCalTokenValid())) {
    return { ok: false, message: 'hãy kết nối lại Google Calendar rồi thử lại' };
  }
  if (!updatedTask.date) {
    return { ok: false, message: 'task liên kết cần có ngày để cập nhật event' };
  }

  try {
    const calId = encodeURIComponent(updatedTask.gcalCalId || previousTask.gcalCalId || 'primary');
    const existingRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${googleEventId}`, {
      headers: { Authorization: `Bearer ${gCalToken}` }
    });
    if (existingRes.status === 401) {
      clearStoredGCalToken();
      return { ok: false, message: 'phiên Google Calendar đã hết hạn, hãy cấp quyền lại' };
    }
    if (!existingRes.ok) {
      const err = await existingRes.json().catch(() => ({}));
      return { ok: false, message: err.error?.message || 'không đọc được event hiện tại' };
    }

    const existingEvent = await existingRes.json();
    const payload = buildEditedEventPayload(existingEvent, q, updatedTask);
    if (!payload) {
      return { ok: false, message: 'không đủ dữ liệu để cập nhật event' };
    }

    const updateRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${googleEventId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${gCalToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (updateRes.status === 401) {
      clearStoredGCalToken();
      return { ok: false, message: 'phiên Google Calendar đã hết hạn, hãy cấp quyền lại' };
    }
    if (!updateRes.ok) {
      const err = await updateRes.json().catch(() => ({}));
      return { ok: false, message: err.error?.message || 'không cập nhật được event liên kết' };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message || 'đã có lỗi khi cập nhật event' };
  }
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
  const importedTask = buildSyncedTaskFromEvent(ev, {
    done: false,
    goalId: null,
    created: Date.now()
  });
  importedTask.text = ev.summary || importedTask.text;
  data[destQ].push(importedTask);
  await setWeek(weekOffset, data);
  invalidateWeeksCache();
  closeEventImport();
  renderTasks();
  toast(`✓ Đã thêm "${ev.summary || 'Event'}" vào ${Q_LABELS[destQ]}`);
}

async function confirmPushTask() {
  if (!pendingPush || !gCalToken) return;
  const { q, i } = pendingPush;
  const calId = document.getElementById('push-cal-id').value || 'primary';
  const data = await getWeek(weekOffset);
  const t = data[q]?.[i];
  if (!t?.date) {
    toast('Task cần có ngày hẹn');
    return;
  }

  const start = new Date(`${t.date}T09:00:00+07:00`);
  const end = new Date(start.getTime() + ((t.hours || 1) * 3600000));
  const calIdEncoded = encodeURIComponent(calId);

  try {
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calIdEncoded}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gCalToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: `[${Q_EVENT_LABELS[q]}] ${t.text}`,
        description: getTaskGCalDescription(t, q, `${Q_LABELS[q]}\nTạo từ Đá Trước`),
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
        colorId: q === 'q1' ? '11' : q === 'q2' ? '9' : q === 'q3' ? '7' : '8'
      })
    });
    const createdEvent = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(createdEvent.error?.message);

    data[q][i].gcal = true;
    data[q][i].gcalCalId = calId;
    data[q][i].gcalEventId = createdEvent.id;
    data[q][i].googleCalendarEventId = createdEvent.id;
    data[q][i].gcalEventSummary = t.text;
    data[q][i].gcalCalendarName = allCalendars.find(c => c.id === calId)?.summary || data[q][i].gcalCalendarName || '';
    await setWeek(weekOffset, data);
    invalidateWeeksCache();
    document.getElementById('push-cal-selector').style.display = 'none';
    pendingPush = null;
    renderTasks();
    renderGCalPush();
    loadGCalFromSelected();
    toast('✓ Đã tạo event trên Google Calendar!');
  } catch (e) {
    toast('Lỗi GCal: ' + e.message);
  }
}

// Alias dùng bởi nút 📅 trong task list (ma trận)
async function pushTask(q, i) { openPushSelector(q, i); }

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
        clearStoredGCalToken();
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
