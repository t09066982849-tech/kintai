let employee = null;
let todayRecord = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;
let currentRecords = [];
let modalRecord = null;
let currentDateStr = null;
let allSites = [];

async function init() {
  employee = await requireEmployee();
  if (!employee) return;

  document.getElementById('paid-leave-balance').innerHTML = `残り有給:<span style="color:#dc2626">${employee.paid_leave_balance}</span>日`;

  const { data: sites } = await supabaseClient.from('sites').select('*').eq('is_active', true);
  allSites = sites;
  const select = document.getElementById('site-select');
  select.innerHTML = sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  const { data: lastRecord } = await supabaseClient
    .from('time_records')
    .select('site_id')
    .eq('employee_id', employee.id)
    .not('site_id', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRecord && lastRecord.site_id) {
    select.value = lastRecord.site_id;
  }

  currentDateStr = getJSTDateStr();
  const { data: record } = await supabaseClient
    .from('time_records')
    .select('*, sites(work_start, work_end, break_minutes)')
    .eq('employee_id', employee.id)
    .eq('date', currentDateStr)
    .maybeSingle();
  todayRecord = record;

  updateButton();
  loadHistory();

  updateClock();
  setInterval(updateClock, 1000);

  setInterval(refreshTodayStatus, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshTodayStatus();
  });
}

function updateClock() {
  const el = document.getElementById('current-time');
  if (!el) return;
  el.textContent = new Date().toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

async function refreshTodayStatus() {
  if (!employee) return;
  const today = getJSTDateStr();
  if (today === currentDateStr) return;

  currentDateStr = today;
  const { data: record } = await supabaseClient
    .from('time_records')
    .select('*, sites(work_start, work_end, break_minutes)')
    .eq('employee_id', employee.id)
    .eq('date', today)
    .maybeSingle();
  todayRecord = record;
  updateButton();
  loadHistory();
}

function updateButton() {
  const btn = document.getElementById('action-btn');
  const status = document.getElementById('status');
  const siteSelect = document.getElementById('site-select');
  btn.disabled = false;
  btn.style.display = 'block';
  if (!todayRecord) {
    siteSelect.disabled = false;
    btn.textContent = '出勤';
    btn.onclick = clockIn;
    status.textContent = '本日はまだ打刻していません';
  } else if (!todayRecord.clock_out) {
    siteSelect.disabled = true;
    btn.textContent = '退勤';
    btn.onclick = clockOut;
    const workStart = todayRecord.sites ? todayRecord.sites.work_start : null;
    const workEnd = todayRecord.sites ? todayRecord.sites.work_end : null;
    const workBreak = todayRecord.sites ? todayRecord.sites.break_minutes : null;
    const metrics = computeDayMetrics(todayRecord.date, todayRecord.clock_in, null, workStart, workEnd, workBreak);
    status.textContent = '出勤時刻: ' + formatTimeJa(metrics.adjustedIn);
  } else {
    siteSelect.disabled = true;
    btn.style.display = 'none';
    const workStart = todayRecord.sites ? todayRecord.sites.work_start : null;
    const workEnd = todayRecord.sites ? todayRecord.sites.work_end : null;
    const workBreak = todayRecord.sites ? todayRecord.sites.break_minutes : null;
    const metrics = computeDayMetrics(todayRecord.date, todayRecord.clock_in, todayRecord.clock_out, workStart, workEnd, workBreak);
    status.textContent = '本日の勤務は完了しました\n出勤: ' + formatTimeJa(metrics.adjustedIn) + ' / 退勤: ' + formatTimeJa(metrics.adjustedOut);
  }
}

function changeMonth(diff) {
  viewMonth += diff;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  loadHistory();
}

async function loadHistory() {
  const monthStr = String(viewMonth).padStart(2, '0');
  document.getElementById('month-label').textContent = `${viewYear}年${viewMonth}月`;

  const startDate = `${viewYear}-${monthStr}-01`;
  const lastDay = new Date(viewYear, viewMonth, 0).getDate();
  const endDate = `${viewYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('*, sites(name, work_start, work_end, break_minutes), correction_requests(id, status)')
    .eq('employee_id', employee.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) { console.error(error); return; }
  currentRecords = records;

  const { data: schedules } = await supabaseClient
    .from('schedules')
    .select('date, end_date, type')
    .eq('employee_id', employee.id)
    .lte('date', endDate)
    .or(`end_date.gte.${startDate},end_date.is.null`)
    .in('type', ['paid_leave', 'business_trip']);

  const isAccounting = employee.department === 'accounting';
  let holidaySet = new Set();
  let companyHolidayRanges = [];
  if (isAccounting) {
    const { data: holidays } = await supabaseClient
      .from('holidays')
      .select('date')
      .gte('date', startDate)
      .lte('date', endDate);
    holidaySet = new Set((holidays || []).map(h => h.date));
  } else {
    const { data: companyHolidays } = await supabaseClient
      .from('company_holidays')
      .select('start_date, end_date')
      .lte('start_date', endDate)
      .gte('end_date', startDate);
    companyHolidayRanges = companyHolidays || [];
  }

  const { data: missingRequests } = await supabaseClient
    .from('missing_record_requests')
    .select('date, status')
    .eq('employee_id', employee.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('created_at', { ascending: true });
  const missingStatusByDate = {};
  (missingRequests || []).forEach(m => { missingStatusByDate[m.date] = m.status; });

  const existingDates = new Set(records.map(r => r.date));
  const todayStr = getJSTDateStr();
  const cutoff = endDate < todayStr ? endDate : todayStr;

  const missingDates = [];
  if (startDate <= cutoff) {
    for (let d = new Date(startDate + 'T00:00:00Z'); d.toISOString().slice(0,10) <= cutoff; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const weekday = d.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      if (isAccounting) {
        if (holidaySet.has(dateStr)) continue;
      } else {
        const inCompanyHoliday = companyHolidayRanges.some(ch => ch.start_date <= dateStr && ch.end_date >= dateStr);
        if (inCompanyHoliday) continue;
      }
      if (existingDates.has(dateStr)) continue;
      const excludedBySchedule = (schedules || []).some(s => {
        const sEnd = s.end_date || s.date;
        return s.date <= dateStr && sEnd >= dateStr;
      });
      if (excludedBySchedule) continue;
      missingDates.push(dateStr);
    }
  }

  const tbody = document.getElementById('history-body');
  if (records.length === 0 && missingDates.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">記録がありません</td></tr>';
    document.getElementById('overtime-summary').innerHTML = '';
    return;
  }

  let totalOvertimeMinutes = 0;

  const existingRows = records.map(r => {
    const workStart = r.sites ? r.sites.work_start : null;
    const workEnd = r.sites ? r.sites.work_end : null;
    const workBreak = r.sites ? r.sites.break_minutes : null;
    const metrics = computeDayMetrics(r.date, r.clock_in, r.clock_out, workStart, workEnd, workBreak);

    const inTime = formatTimeJa(metrics.adjustedIn);
    const outTime = formatTimeJa(metrics.adjustedOut);
    const workTime = metrics.workMinutes != null ? formatMinutesJa(metrics.workMinutes) : '-';

    if (metrics.workMinutes != null) totalOvertimeMinutes += metrics.overtimeMinutes;

    const siteName = r.sites ? r.sites.name : '-';

    let actionCell = `<button class="small" onclick="openModal(${r.id})">申請</button>`;
    if (r.correction_requests && r.correction_requests.length > 0) {
      const latest = r.correction_requests[r.correction_requests.length - 1];
      const labelMap = { pending: '申請中', approved: '承認済', rejected: '却下' };
      const classMap = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };
      actionCell = `<span class="${classMap[latest.status]}">${labelMap[latest.status]}</span>`;
      if (latest.status === 'rejected') {
        actionCell += ` <button class="small" onclick="openModal(${r.id})">再申請</button>`;
      } else if (latest.status === 'pending') {
        actionCell += ` <button class="small" style="background:#dc2626" onclick="cancelCorrectionRequest(${latest.id})">取り消し</button>`;
      }
    }

    return { date: r.date, html: `<tr><td>${r.date}</td><td>${siteName}</td><td>${inTime}</td><td>${outTime}</td><td>${workTime}</td><td>${actionCell}</td></tr>` };
  });

  const missingRows = missingDates.map(dateStr => {
    const status = missingStatusByDate[dateStr];
    let actionCell;
    if (status === 'pending') {
      actionCell = `<span class="status-pending">申請中</span>`;
    } else if (status === 'rejected') {
      actionCell = `<span class="status-rejected">却下</span> <button class="small" onclick="openMissingModal('${dateStr}')">再申請</button>`;
    } else {
      actionCell = `<button class="small" onclick="openMissingModal('${dateStr}')">記録を追加申請</button>`;
    }
    return { date: dateStr, html: `<tr><td>${dateStr}</td><td>-</td><td>-</td><td>-</td><td>記録なし</td><td>${actionCell}</td></tr>` };
  });

  const allRows = existingRows.concat(missingRows).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  tbody.innerHTML = allRows.map(r => r.html).join('');

  const overtimeHours = Math.floor(totalOvertimeMinutes / 60);
  const overtimeMins = totalOvertimeMinutes % 60;
  document.getElementById('overtime-summary').innerHTML = `今月の残業:<span style="color:#dc2626">${overtimeHours}</span>時間<span style="color:#dc2626">${overtimeMins}</span>分`;
}

function openMissingModal(dateStr) {
  document.getElementById('missing-modal-date').textContent = dateStr;
  document.getElementById('missing-modal-bg').dataset.date = dateStr;

  const select = document.getElementById('missing-site-select');
  select.innerHTML = allSites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  document.getElementById('missing-clock-in').value = '';
  document.getElementById('missing-clock-out').value = '';
  document.getElementById('missing-modal-bg').style.display = 'flex';
}

function closeMissingModal() {
  document.getElementById('missing-modal-bg').style.display = 'none';
}

async function submitMissingRequest() {
  if (!(await ensureSession())) return;

  const dateStr = document.getElementById('missing-modal-bg').dataset.date;
  const siteId = document.getElementById('missing-site-select').value;
  const clockIn = document.getElementById('missing-clock-in').value;
  const clockOut = document.getElementById('missing-clock-out').value;

  if (!clockIn) { alert('出勤時刻を入力してください'); return; }

  const { error } = await supabaseClient.from('missing_record_requests').insert({
    employee_id: employee.id,
    date: dateStr,
    site_id: siteId,
    requested_clock_in: clockIn + ':00',
    requested_clock_out: clockOut ? clockOut + ':00' : null
  });

  if (error) { alert('エラー: ' + error.message); return; }
  closeMissingModal();
  loadHistory();
}

function openModal(recordId) {
  modalRecord = currentRecords.find(r => r.id === recordId);
  document.getElementById('modal-date').textContent = modalRecord.date;

  const reqSiteSelect = document.getElementById('req-site-select');
  reqSiteSelect.innerHTML = allSites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  if (modalRecord.site_id) reqSiteSelect.value = modalRecord.site_id;

  const originalIn = modalRecord.clock_in ? new Date(modalRecord.clock_in).toTimeString().slice(0,5) : '';
  const originalOut = modalRecord.clock_out ? new Date(modalRecord.clock_out).toTimeString().slice(0,5) : '';

  document.getElementById('req-clock-in').value = originalIn;
  document.getElementById('req-clock-out').value = originalOut;
  document.getElementById('req-clock-out-label').textContent = modalRecord.clock_out
    ? '退勤時刻'
    : '退勤時刻(まだ退勤前なら空欄でも申請できます)';

  const modalBg = document.getElementById('modal-bg');
  modalBg.dataset.originalIn = originalIn;
  modalBg.dataset.originalOut = originalOut;

  modalBg.style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-bg').style.display = 'none';
}

async function submitCorrection() {
  if (!(await ensureSession())) return;

  const inVal = document.getElementById('req-clock-in').value;
  const outVal = document.getElementById('req-clock-out').value;
  const siteId = document.getElementById('req-site-select').value;

  const isOngoing = !modalRecord.clock_out; // まだ退勤していない(出勤中)日か

  if (!inVal) {
    alert('出勤時刻を入力してください');
    return;
  }
  if (!isOngoing && !outVal) {
    alert('出勤時刻・退勤時刻の両方を入力してください');
    return;
  }

  const requestedIn = inVal ? `${modalRecord.date}T${inVal}:00+09:00` : null;
  const requestedOut = outVal ? `${modalRecord.date}T${outVal}:00+09:00` : null;

  const { error } = await supabaseClient.from('correction_requests').insert({
    time_record_id: modalRecord.id,
    employee_id: employee.id,
    requested_clock_in: requestedIn,
    requested_clock_out: requestedOut,
    requested_site_id: siteId
  });

  if (error) { alert('エラー: ' + error.message); return; }
  closeModal();
  loadHistory();
}

async function cancelCorrectionRequest(id) {
  if (!(await ensureSession())) return;
  if (!confirm('この申請を取り消しますか？')) return;

  const { error } = await supabaseClient.from('correction_requests').delete().eq('id', id);
  if (error) { alert('エラー: ' + error.message); return; }
  loadHistory();
}

async function submitDeletionRequest() {
  if (!(await ensureSession())) return;

  if (!confirm('この日の打刻記録を削除してほしいと申請します。よろしいですか？')) return;

  const { error } = await supabaseClient.from('correction_requests').insert({
    time_record_id: modalRecord.id,
    employee_id: employee.id,
    is_deletion: true
  });

  if (error) { alert('エラー: ' + error.message); return; }
  closeModal();
  loadHistory();
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null)
    );
  });
}

async function clockIn() {
  if (!(await ensureSession())) return;

  const btn = document.getElementById('action-btn');
  btn.disabled = true;

  const pos = await getPosition();
  const siteId = document.getElementById('site-select').value;
  const today = getJSTDateStr();
  const { data, error } = await supabaseClient.from('time_records').insert({
    employee_id: employee.id,
    date: today,
    site_id: siteId,
    clock_in: new Date().toISOString(),
    clock_in_lat: pos ? pos.lat : null,
    clock_in_lng: pos ? pos.lng : null
  }).select('*, sites(work_start, work_end, break_minutes)').single();
  if (error) { alert('エラー: ' + error.message); btn.disabled = false; return; }
  todayRecord = data;
  updateButton();
  loadHistory();
}

async function clockOut() {
  if (!(await ensureSession())) return;

  const btn = document.getElementById('action-btn');
  btn.disabled = true;

  const pos = await getPosition();
  const { data, error } = await supabaseClient.from('time_records').update({
    clock_out: new Date().toISOString(),
    clock_out_lat: pos ? pos.lat : null,
    clock_out_lng: pos ? pos.lng : null
  }).eq('id', todayRecord.id).select('*, sites(work_start, work_end, break_minutes)').single();
  if (error) { alert('エラー: ' + error.message); btn.disabled = false; return; }
  todayRecord = data;
  updateButton();
  loadHistory();
}

async function changePassword() {
  const pw = document.getElementById('new-password').value;
  const pwConfirm = document.getElementById('new-password-confirm').value;
  const msg = document.getElementById('password-message');

  if (pw.length < 6) {
    msg.style.color = 'red';
    msg.textContent = 'パスワードは6文字以上で入力してください';
    return;
  }
  if (pw !== pwConfirm) {
    msg.style.color = 'red';
    msg.textContent = '確認用パスワードが一致しません';
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: pw });
  if (error) {
    msg.style.color = 'red';
    msg.textContent = 'エラー: ' + error.message;
    return;
  }

  msg.style.color = 'green';
  msg.textContent = 'パスワードを変更しました';
  document.getElementById('new-password').value = '';
  document.getElementById('new-password-confirm').value = '';
}

init();
