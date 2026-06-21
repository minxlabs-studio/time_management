// ── REVIEW ────────────────────────────
// Keep these functions global because index.html still uses inline handlers.
async function renderReview() {
  const data = await getWeek(weekOffset);
  await renderDailyReview();
  document.getElementById('review-title').textContent = 'Tổng kết ' + weekRangeLabel(weekOffset);
  const qN = { q1: 'Ô 1 — Khẩn & QT', q2: 'Ô 2 — QT chưa khẩn', q3: 'Ô 3 — Khẩn cấp', q4: 'Ô 4 — Sao nhãng' };
  const clr = { q1: '#D93025', q2: '#1E8E3E', q3: '#1A73E8', q4: '#5F6368' };
  let bars = '';
  let hrs = '';

  ['q1', 'q2', 'q3', 'q4'].forEach(q => {
    const ts = data[q] || [];
    const tot = ts.length;
    const dn = ts.filter(t => t.done).length;
    const h = ts.reduce((s, t) => s + (t.hours || 0), 0);
    const pct = tot ? Math.round(dn / tot * 100) : 0;
    bars += `<div class="bar-row"><span class="bar-label" style="font-size:12px">${qN[q]}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${clr[q]}"></div></div><span class="bar-pct">${pct}%</span></div>`;
    hrs += `<div class="bar-row"><span class="bar-label" style="font-size:12px">${qN[q]}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(h / 40 * 100, 100)}%;background:${clr[q]}"></div></div><span class="bar-pct">${h}h</span></div>`;
  });

  document.getElementById('review-bars').innerHTML = `
    <div class="review-card"><div class="review-card-title">Tiến độ hoàn thành</div>${bars}</div>
    <div class="review-card"><div class="review-card-title">Phân bổ giờ</div>${hrs}</div>`;

  const q2ts = data.q2 || [];
  const q2dn = q2ts.filter(t => t.done).length;
  let ins = '';
  if (!q2ts.length) ins = '<strong>⚠ Chưa có việc Ô 2.</strong> Ô 2 là khu vực vàng quyết định tương lai — hãy thêm ít nhất 1 việc quan trọng vào lịch.';
  else if (q2dn === q2ts.length) ins = `<strong>✓ Xuất sắc!</strong> Hoàn thành toàn bộ ${q2ts.length} việc Ô 2. Đây là tuần đầu tư vào tương lai thật sự.`;
  else ins = `Ô 2: <strong>${q2dn}/${q2ts.length}</strong> việc hoàn thành. Còn ${q2ts.length - q2dn} việc quan trọng chưa xong — bảo vệ chúng ưu tiên tuần tới.`;
  document.getElementById('review-insight').innerHTML = ins;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dailyReviewLabel(score) {
  if (score >= 85) return 'Excellent day';
  if (score >= 70) return 'Good progress';
  if (score >= 50) return 'Needs focus';
  return 'Reset and simplify tomorrow';
}

function dailyReviewScore(todayTasks, blockerNote, tomorrowPlan) {
  const done = todayTasks.filter(t => t.done).length;
  const undone = todayTasks.length - done;
  const priorityTasks = todayTasks.filter(t => t.priority === true || t.priority === 'high' || t.priority === 1);
  const priorityDone = priorityTasks.filter(t => t.done).length;

  let score = 35;
  if (todayTasks.length) {
    score += Math.round((done / todayTasks.length) * 45);
    score -= Math.min(18, undone * 6);
  } else {
    score += 20;
  }
  if (priorityTasks.length) score += Math.round((priorityDone / priorityTasks.length) * 12);
  if (blockerNote.trim()) score += 8;
  if (tomorrowPlan.trim()) score += 7;
  score = Math.max(0, Math.min(100, score));

  let summary = '';
  if (!todayTasks.length) summary = 'Hôm nay chưa có task gắn ngày, nên điểm đang ưu tiên sự khởi động nhẹ nhàng.';
  else if (!undone) summary = `Bạn đã chốt ${done}/${todayTasks.length} việc hôm nay. Nhịp hoàn thành đang rất tốt.`;
  else summary = `Bạn hoàn thành ${done}/${todayTasks.length} việc hôm nay, còn ${undone} việc cần sắp lại cho ngày mai.`;

  let tomorrow = '';
  if (score >= 85) tomorrow = 'Ngày mai hãy giữ nhịp này và chọn trước 1 việc quan trọng nhất để bảo vệ.';
  else if (score >= 70) tomorrow = 'Ngày mai chỉ cần gom lại các việc dở dang và chốt 1 ưu tiên rõ ràng là đủ.';
  else if (score >= 50) tomorrow = 'Ngày mai nên rút gọn danh sách, bắt đầu từ 1 việc quan trọng và giảm bớt việc gây phân tán.';
  else tomorrow = 'Ngày mai hãy reset bằng 1-2 việc thật nhỏ, thật rõ để lấy lại đà trước.';

  return { score, label: dailyReviewLabel(score), summary, tomorrow, done, undone, total: todayTasks.length };
}

async function renderDailyReview() {
  const today = todayISO();
  const data = await getWeek(0);
  const reviewRef = col('dailyReviews').doc(today);
  const reviewSnap = await reviewRef.get();
  const review = reviewSnap.exists ? reviewSnap.data() : {};
  const todayTasks = ['q1', 'q2', 'q3', 'q4'].flatMap(q =>
    (data[q] || []).map((t, i) => ({ ...t, q, i }))
  ).filter(t => t.date === today);

  const blockerNote = review.blockerNote || '';
  const tomorrowPlan = review.tomorrowPlan || '';
  const score = dailyReviewScore(todayTasks, blockerNote, tomorrowPlan);

  document.getElementById('daily-score-value').textContent = score.score;
  document.getElementById('daily-score-label').textContent = score.label;
  document.getElementById('daily-score-copy').textContent = score.summary;
  document.getElementById('daily-review-date').textContent = `Hôm nay · ${fmtD(today)}`;
  document.getElementById('daily-review-metrics').innerHTML = [
    `<div class="daily-metric"><strong>${score.done}</strong><span>hoàn thành</span></div>`,
    `<div class="daily-metric"><strong>${score.undone}</strong><span>chưa xong</span></div>`,
    `<div class="daily-metric"><strong>${score.total}</strong><span>task hôm nay</span></div>`
  ].join('');
  document.getElementById('daily-review-next').innerHTML = `<strong>${score.label}.</strong> ${score.tomorrow}`;
  document.getElementById('daily-blocker').value = blockerNote;
  document.getElementById('daily-tomorrow').value = tomorrowPlan;
}

async function saveDailyReview() {
  const today = todayISO();
  const blockerNote = document.getElementById('daily-blocker').value.trim();
  const tomorrowPlan = document.getElementById('daily-tomorrow').value.trim();
  const data = await getWeek(0);
  const todayTasks = ['q1', 'q2', 'q3', 'q4'].flatMap(q =>
    (data[q] || []).map((t, i) => ({ ...t, q, i }))
  ).filter(t => t.date === today);
  const score = dailyReviewScore(todayTasks, blockerNote, tomorrowPlan);

  await col('dailyReviews').doc(today).set({
    date: today,
    blockerNote,
    tomorrowPlan,
    score: score.score,
    label: score.label,
    updated: Date.now()
  });

  await renderDailyReview();
  toast('✓ Đã lưu Daily Review');
}

// ── HOURS CALC ────────────────────────
async function calcHours() {
  const s = parseFloat(document.getElementById('hs')?.value) || 7;
  const e = parseFloat(document.getElementById('he')?.value) || 1.5;
  const c = parseFloat(document.getElementById('hc')?.value) || 1;
  const f = parseFloat(document.getElementById('hf')?.value) || 25;
  const r = parseFloat(document.getElementById('hr')?.value) || 10;
  const avail = Math.max(0, Math.round((168 - (s + e + c) * 7 - f - r) * 10) / 10);
  const el = document.getElementById('h-avail');
  if (el) el.textContent = avail + 'h';

  const data = await getWeek(weekOffset);
  let need = 0;
  ['q1', 'q2', 'q3', 'q4'].forEach(q => (data[q] || []).forEach(t => need += t.hours || 0));
  const vd = document.getElementById('h-verdict');
  if (!vd) return;

  if (need > 0) {
    vd.style.display = 'block';
    if (need > avail) vd.className = 'hours-verdict h-red', vd.textContent = `⚠ Cần ${need}h nhưng chỉ có ${avail}h. Cắt Ô 4 → giảm Ô 3 → bảo vệ Ô 2.`;
    else vd.className = 'hours-verdict h-grn', vd.textContent = `✓ Đủ thời gian. Còn ${Math.round((avail - need) * 10) / 10}h dự phòng.`;
  } else vd.style.display = 'none';
}