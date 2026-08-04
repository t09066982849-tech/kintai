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

  const { data: sites } = await supabaseClient.from('sites').select('*');
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

  currentDateStr = new Date().toISOString().slice(0, 10);
  const { data: record } = await supabaseClient
    .from('time_records')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('date', currentDateStr)
    .maybeSingle();
  todayRecord = record;

  updateButton();
  loadHistory();

  setInterval(refreshTodayStatus, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshTodayStatus();
  });
}

async function refreshTodayStatus() {
  if (!employee) return;
  const today = new Date().toISOString().slice(0, 10);
  if (today === currentDateStr) return;

  currentDateStr = today;
  const { data: record } = await supabaseClient
    .from('time_records')
    .select('*')
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
    status.textContent = '出勤時刻: ' + new Date(todayRecord.clock_in).toLocaleTimeString('ja-JP');
  } else {
    siteSelect.disabled = true;
    btn.style.display = 'none';
    status.textContent = '本日の勤務は完了しました\n出勤: ' + new Date(todayRecord.clock_in).toLocaleTimeString('ja-JP') + ' / 退勤: ' + new Date(todayRecord.clock_out).toLocaleTimeString('ja-JP');
  }
}

function changeMonth(diff) {
  viewMonth += diff;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  loadHistory();
}

function getAdjustedTimes(dateStr, clockIn, clockOut) {
  const lowerBound = new Date(dateStr + 'T07:00:00+09:00');
  const upperBound = new Date(dateStr + 'T18:00:00+09:00');

  let adjustedIn = clockIn ? new Date(clockIn) : null;
  let adjustedOut = clockOut ? new Date(clockOut) : null;

  if (adjustedIn && adjustedIn < lowerBound) adjustedIn = lowerBound;
  if (adjustedOut && adjustedOut > upperBound) adjustedOut = upperBound;

  return { adjustedIn, adjustedOut };
}

async function loadHistory() {
  const monthStr = String(viewMonth).padStart(2, '0');
  document.getElementById('month-label').textContent = `${viewYear}年${viewMonth}月`;

  const startDate = `${viewYear}-${monthStr}-01`;
  const lastDay = new Date(viewYear, viewMonth, 0).getDate();
  const endDate = `${viewYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('*, sites(name), correction_requests(status)')
    .eq('employee_id', employee.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) { console.error(error); return; }
  currentRecords = records;

  const tbody = document.getElementById('history-body');
  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">記録がありません</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(r => {
    const inTime = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '-';
    const outTime = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '-';

    let workTime = '-';
    if (r.clock_in && r.clock_out) {
      const { adjustedIn, adjustedOut } = getAdjustedTimes(r.date, r.clock_in, r.clock_out);
      const diffMs = adjustedOut - adjustedIn;
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.round((diffMs % 3600000) / 60000);
      workTime = hours + '時間' + mins + '分';
    }
    const siteName = r.sites ? r.sites.name : '-';

    let actionCell = `<button class="small" onclick="openModal(${r.id})">申請</button>`;
    if (r.correction_requests && r.correction_requests.length > 0) {
      const latest = r.correction_requests[r.correction_requests.length - 1];
      const labelMap = { pending: '申請中', approved: '承認済', rejected: '却下' };
      const classMap = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };
      actionCell = `<span class="${classMap[latest.status]}">${labelMap[latest.status]}</span>`;
    }

    return `<tr><td>${r.date}</td><td>${siteName}</td><td>${inTime}</td><td>${outTime}</td><td>${workTime}</td><td>${actionCell}</td></tr>`;
  }).join('');
}

function openModal(recordId) {
  modalRecord = currentRecords.find(r => r.id === recordId);
  document.getElementById('modal-date').textContent = modalRecord.date;

  const reqSiteSelect = document.getElementById('req-site-select');
  reqSiteSelect.innerHTML = allSites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  if (modalRecord.site_id) reqSiteSelect.value = modalRecord.site_id;

  document.getElementById('req-clock-in').value = modalRecord.clock_in ? new Date(modalRecord.clock_in).toTimeString().slice(0,5) : '';
  document.getElementById('req-clock-out').value = modalRecord.clock_out ? new Date(modalRecord.clock_out).toTimeString().slice(0,5) : '';
  document.getElementById('modal-bg').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-bg').style.display = 'none';
}

async function submitCorrection() {
  if (!(await ensureSession())) return;

  const inVal = document.getElementById('req-clock-in').value;
  const outVal = document.getElementById('req-clock-out').value;
  const siteId = document.getElementById('req-site-select').value;

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
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseClient.from('time_records').insert({
    employee_id: employee.id,
    date: today,
    site_id: siteId,
    clock_in: new Date().toISOString(),
    clock_in_lat: pos ? pos.lat : null,
    clock_in_lng: pos ? pos.lng : null
  }).select().single();
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
  }).eq('id', todayRecord.id).select().single();
  if (error) { alert('エラー: ' + error.message); btn.disabled = false; return; }
  todayRecord = data;
  updateButton();
  loadHistory();
}

init();
