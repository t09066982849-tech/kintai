let employee = null;

function setSummaryHighlight(id, hasItems) {
  const el = document.getElementById(id);
  if (el) el.style.color = hasItems ? '#dc2626' : '';
}

// 役員(社長・常務・伊豆倉鈴雄・大角賢一)は個人別の有給管理簿も無く、集計系の対象外
const EXCLUDED_EXECUTIVE_IDS = [6, 7, 8, 9];

async function init() {
  employee = await requireEmployee();
  if (!employee) return;

  if (!employee.is_admin) {
    document.getElementById('main-box').style.display = 'none';
    document.getElementById('login-box').style.display = 'block';
    document.getElementById('login-error').textContent = '管理者権限がありません';
    await supabaseClient.auth.signOut();
    return;
  }

  const now = new Date();
  document.getElementById('export-month').value = now.toISOString().slice(0, 7);
  // 年度は6月始まりなので、6月以降なら今年が開始年、5月以前なら去年が開始年
  const currentMonth = now.getMonth() + 1;
  document.getElementById('annual-start-year').value = currentMonth >= 6 ? now.getFullYear() : now.getFullYear() - 1;

  loadRequests();
  loadSites();
  loadApprovedLeaveRequests();
  loadMissingRequests();
  loadEmployees();
  loadTodayStatus();
  loadPendingLeaveRequests();
}

const deptLabelStatus = { civil: '土木部', accounting: '経理部' };
const statusLabel = { none: '未出勤', working: '出勤中', done: '退勤済み' };
const statusClass = { none: 'status-rejected', working: 'status-pending', done: 'status-approved' };

async function loadTodayStatus() {
  const today = getJSTDateStr();

  const { data: rawEmployees, error: empError } = await supabaseClient
    .from('employees')
    .select('id, name, department')
    .eq('is_admin', false)
    .eq('is_active', true)
    .order('name');
  if (empError) { console.error(empError); return; }
  const allEmployees = (rawEmployees || []).filter(e => !EXCLUDED_EXECUTIVE_IDS.includes(e.id));

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('employee_id, clock_in, clock_out, sites(name)')
    .eq('date', today);
  if (error) { console.error(error); return; }

  const recordByEmployee = {};
  (records || []).forEach(r => { recordByEmployee[r.employee_id] = r; });

  const tbody = document.getElementById('today-status-body');
  tbody.innerHTML = allEmployees.map(emp => {
    const r = recordByEmployee[emp.id];
    let status = 'none';
    if (r && r.clock_in && !r.clock_out) status = 'working';
    else if (r && r.clock_in && r.clock_out) status = 'done';

    return `
      <tr>
        <td><button class="small" onclick="showEmployeeDetail(${emp.id}, '${emp.name.replace(/'/g, "\\'")}')">${emp.name}</button></td>
        <td>${deptLabelStatus[emp.department] || emp.department || ''}</td>
        <td>${r && r.sites ? r.sites.name : '-'}</td>
        <td>${formatTimeJa(r && r.clock_in ? new Date(r.clock_in) : null)}</td>
        <td>${formatTimeJa(r && r.clock_out ? new Date(r.clock_out) : null)}</td>
        <td><span class="${statusClass[status]}">${statusLabel[status]}</span></td>
      </tr>
    `;
  }).join('');
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '-';
}

async function showEmployeeDetail(employeeId, employeeName) {
  const today = getJSTDateStr();
  const [year, month] = today.split('-').map(Number);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('date, clock_in, clock_out, sites(name, work_start, work_end, break_minutes)')
    .eq('employee_id', employeeId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  document.getElementById('employee-detail-name').textContent = `${employeeName} さん`;
  document.getElementById('employee-detail-month').textContent = `${year}年${month}月`;

  const tbody = document.getElementById('employee-detail-body');
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">エラー: ${error.message}</td></tr>`;
  } else if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">今月の記録がありません</td></tr>';
  } else {
    tbody.innerHTML = records.map(r => {
      const workStart = r.sites ? r.sites.work_start : null;
      const workEnd = r.sites ? r.sites.work_end : null;
      const workBreak = r.sites ? r.sites.break_minutes : null;
      const metrics = computeDayMetrics(r.date, r.clock_in, r.clock_out, workStart, workEnd, workBreak);
      const workTime = metrics.workMinutes != null ? formatMinutesJa(metrics.workMinutes) : '-';
      const overtimeTime = metrics.workMinutes != null ? formatMinutesJa(metrics.overtimeMinutes) : '-';
      return `
        <tr>
          <td>${r.date}</td>
          <td>${r.sites ? r.sites.name : '-'}</td>
          <td>${formatTimeJa(metrics.adjustedIn)}</td>
          <td>${formatTimeJa(metrics.adjustedOut)}</td>
          <td>${workTime}</td>
          <td>${overtimeTime}</td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('employee-detail-modal-bg').style.display = 'flex';
}

function closeEmployeeDetail() {
  document.getElementById('employee-detail-modal-bg').style.display = 'none';
}

async function loadRequests() {
  const { data: requests, error } = await supabaseClient
    .from('correction_requests')
    .select('*, employees(name), time_records(date, clock_in, clock_out, site_id, sites(name)), requested_site:sites!correction_requests_requested_site_id_fkey(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }

  setSummaryHighlight('requests-summary', requests.length > 0);

  const tbody = document.getElementById('requests-body');
  if (requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">申請中の項目はありません</td></tr>';
    return;
  }

  tbody.innerHTML = requests.map(r => `
    <tr>
      <td>${r.employees.name}</td>
      <td>${r.time_records.date}</td>
      <td>${r.time_records.sites ? r.time_records.sites.name : '-'}</td>
      <td>${fmtTime(r.time_records.clock_in)}</td>
      <td>${fmtTime(r.time_records.clock_out)}</td>
      ${r.is_deletion ? `
      <td colspan="3" style="color:#dc2626">削除希望</td>
      ` : `
      <td>${r.requested_site ? r.requested_site.name : '-'}</td>
      <td>${fmtTime(r.requested_clock_in)}</td>
      <td>${fmtTime(r.requested_clock_out)}</td>
      `}
      <td>
        ${r.is_deletion
          ? `<button class="small" style="background:#dc2626" onclick="approveDeletion(${r.id}, ${r.time_record_id})">承認(削除)</button>`
          : `<button class="small" onclick="approve(${r.id}, ${r.time_record_id}, '${r.requested_clock_in || ''}', '${r.requested_clock_out || ''}', ${r.requested_site_id || 'null'})">承認</button>`
        }
        <button class="small" style="background:#9ca3af" onclick="reject(${r.id})">却下</button>
      </td>
    </tr>
  `).join('');
}

async function approveDeletion(requestId, timeRecordId) {
  if (!confirm('この打刻記録を完全に削除します。よろしいですか？')) return;

  const { error: e1 } = await supabaseClient.from('correction_requests').delete().eq('id', requestId);
  if (e1) { alert('エラー: ' + e1.message); return; }

  const { error: e2 } = await supabaseClient.from('time_records').delete().eq('id', timeRecordId);
  if (e2) { alert('エラー: ' + e2.message); return; }

  loadRequests();
}

async function approve(requestId, timeRecordId, requestedIn, requestedOut, requestedSiteId) {
  const updates = {};
  if (requestedIn) updates.clock_in = requestedIn;
  if (requestedOut) updates.clock_out = requestedOut;
  if (requestedSiteId) updates.site_id = requestedSiteId;

  const { error: e1 } = await supabaseClient.from('time_records').update(updates).eq('id', timeRecordId);
  if (e1) { alert('エラー: ' + e1.message); return; }

  const { error: e2 } = await supabaseClient.from('correction_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
  if (e2) { alert('エラー: ' + e2.message); return; }

  loadRequests();
}

async function reject(requestId) {
  const { error } = await supabaseClient.from('correction_requests')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) { alert('エラー: ' + error.message); return; }
  loadRequests();
}

async function loadSites() {
  const { data: sites, error } = await supabaseClient.from('sites').select('*').order('id');
  if (error) { console.error(error); return; }

  const tbody = document.getElementById('sites-body');
  tbody.innerHTML = sites.map(s => `
    <tr>
      <td>${s.name}</td>
      <td>${s.is_active ? '<span class="status-approved">有効</span>' : '<span class="status-rejected">無効</span>'}</td>
      <td>
        <button class="small" onclick="editSite(${s.id})">編集</button>
        ${s.is_active
          ? `<button class="small" style="background:#dc2626" onclick="toggleSiteActive(${s.id}, false)">無効化</button>`
          : `<button class="small" onclick="toggleSiteActive(${s.id}, true)">有効化</button>`
        }
        <button class="small" style="background:#9ca3af" onclick="deleteSite(${s.id})">削除</button>
      </td>
    </tr>
  `).join('');
}

async function editSite(id) {
  const { data: site, error } = await supabaseClient.from('sites').select('name').eq('id', id).single();
  if (error) { alert('エラー: ' + error.message); return; }

  const newName = prompt('新しい現場名を入力してください', site.name);
  if (!newName || !newName.trim() || newName.trim() === site.name) return;

  const { error: updateError } = await supabaseClient.from('sites').update({ name: newName.trim() }).eq('id', id);
  if (updateError) { alert('エラー: ' + updateError.message); return; }
  loadSites();
}

async function addSite() {
  const name = document.getElementById('new-site-name').value.trim();
  if (!name) return;
  const { error } = await supabaseClient.from('sites').insert({ name });
  if (error) { alert('エラー: ' + error.message); return; }
  document.getElementById('new-site-name').value = '';
  loadSites();
}

async function toggleSiteActive(id, makeActive) {
  const label = makeActive ? '有効化' : '無効化';
  if (!confirm(`この現場を${label}します。よろしいですか？`)) return;

  const { error } = await supabaseClient.from('sites').update({ is_active: makeActive }).eq('id', id);
  if (error) { alert('エラー: ' + error.message); return; }
  loadSites();
}

async function deleteSite(id) {
  if (!confirm('削除しますか？(使用履歴があると削除できません。その場合は無効化してください)')) return;
  const { error } = await supabaseClient.from('sites').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      alert('この現場は打刻記録の使用履歴があるため削除できません。代わりに「無効化」を使ってください。');
    } else {
      alert('エラー: ' + error.message);
    }
    return;
  }
  loadSites();
}

function safeSheetName(name, used) {
  let base = name.replace(/[\\/?*\[\]:]/g, '').slice(0, 28);
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${base}(${i})`;
    i++;
  }
  used.add(candidate);
  return candidate;
}

async function exportExcel() {
  const monthVal = document.getElementById('export-month').value;
  if (!monthVal) { alert('月を選んでください'); return; }

  const [year, month] = monthVal.split('-').map(Number);
  const startDate = `${monthVal}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${monthVal}-${String(lastDay).padStart(2, '0')}`;

  const { data: rawEmployees, error: empError } = await supabaseClient
    .from('employees')
    .select('id, name, department')
    .eq('is_admin', false)
    .order('name');
  const allEmployees = (rawEmployees || []).filter(e => !EXCLUDED_EXECUTIVE_IDS.includes(e.id));

  if (empError) { alert('エラー: ' + empError.message); return; }

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('*, employees(id, name, department), sites(name, work_start, work_end, break_minutes)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('employee_id', { ascending: true })
    .order('date', { ascending: true });

  if (error) { alert('エラー: ' + error.message); return; }

  const { data: holidays } = await supabaseClient
    .from('holidays')
    .select('date')
    .gte('date', startDate)
    .lte('date', endDate);
  const holidaySet = new Set((holidays || []).map(h => h.date));

  const { data: companyHolidays } = await supabaseClient
    .from('company_holidays')
    .select('start_date, end_date');

  const { data: leaveRequests } = await supabaseClient
    .from('leave_requests')
    .select('employee_id, type, days')
    .eq('status', 'approved')
    .lte('start_date', endDate)
    .gte('end_date', startDate);

  // 打刻漏れ判定と同じ基準:経理部は土日+全国の祝日、それ以外(土木部)は土日+会社休業期間のみ
  function isHolidayFor(dateStr, department) {
    const weekday = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    if (weekday === 0 || weekday === 6) return true;
    if (department === 'accounting') {
      return holidaySet.has(dateStr);
    }
    return (companyHolidays || []).some(ch => ch.start_date <= dateStr && ch.end_date >= dateStr);
  }

  const deptLabelExport = { civil: '土木部', accounting: '経理部' };
  const grouped = {};
  (allEmployees || []).forEach(emp => {
    grouped[emp.id] = {
      name: emp.name, department: emp.department, rows: [],
      weekdayDays: 0, holidayDays: 0, workMinutesTotal: 0, overtimeMinutesTotal: 0, breakMinutesTotal: 0
    };
  });

  records.forEach(r => {
    const empId = r.employees ? r.employees.id : 'unknown';
    const empName = r.employees ? r.employees.name : '不明';
    const department = r.employees ? r.employees.department : null;
    if (!grouped[empId]) {
      grouped[empId] = {
        name: empName, department, rows: [],
        weekdayDays: 0, holidayDays: 0, workMinutesTotal: 0, overtimeMinutesTotal: 0, breakMinutesTotal: 0
      };
    }
    const group = grouped[empId];

    const workStart = r.sites ? r.sites.work_start : null;
    const workEnd = r.sites ? r.sites.work_end : null;
    const workBreak = r.sites ? r.sites.break_minutes : null;
    const metrics = computeDayMetrics(r.date, r.clock_in, r.clock_out, workStart, workEnd, workBreak);

    const inTime = formatTimeJa(metrics.adjustedIn);
    const outTime = formatTimeJa(metrics.adjustedOut);
    const workTime = metrics.workMinutes != null ? formatMinutesJa(metrics.workMinutes) : '';
    const overtimeTime = metrics.workMinutes != null ? formatMinutesJa(metrics.overtimeMinutes) : '';
    const isHoliday = isHolidayFor(r.date, department);
    const holidayWork = metrics.workMinutes != null && isHoliday ? '○' : '';

    if (metrics.workMinutes != null) {
      if (isHoliday) group.holidayDays++; else group.weekdayDays++;
      group.workMinutesTotal += metrics.workMinutes;
      group.overtimeMinutesTotal += metrics.overtimeMinutes;
      group.breakMinutesTotal += (workBreak || 0);
    }

    group.rows.push({
      '日付': r.date,
      '現場': r.sites ? r.sites.name : '',
      '出勤時刻': inTime,
      '退勤時刻': outTime,
      '勤務時間': workTime,
      '残業時間': overtimeTime,
      '休日出勤': holidayWork
    });
  });

  const leaveDaysByEmployee = {};
  (leaveRequests || []).forEach(lr => {
    if (!leaveDaysByEmployee[lr.employee_id]) leaveDaysByEmployee[lr.employee_id] = { paid_leave: 0, business_trip: 0 };
    leaveDaysByEmployee[lr.employee_id][lr.type] = (leaveDaysByEmployee[lr.employee_id][lr.type] || 0) + Number(lr.days || 0);
  });

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  const summaryRows = Object.entries(grouped).map(([empId, group]) => {
    const leave = leaveDaysByEmployee[empId] || {};
    return {
      '氏名': group.name,
      '部署': deptLabelExport[group.department] || group.department || '',
      '平日出勤日数': group.weekdayDays,
      '休日出勤日数': group.holidayDays,
      '有休取得日数': leave.paid_leave || 0,
      '出張日数': leave.business_trip || 0,
      '総勤務時間': formatMinutesJa(group.workMinutesTotal),
      '総残業時間': formatMinutesJa(group.overtimeMinutesTotal),
      '休憩時間合計': formatMinutesJa(group.breakMinutesTotal)
    };
  });
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs['!cols'] = [{wch:14},{wch:10},{wch:12},{wch:12},{wch:12},{wch:10},{wch:12},{wch:12},{wch:12}];
  XLSX.utils.book_append_sheet(wb, summaryWs, '全員まとめ');

  const includeDaily = document.getElementById('export-include-daily').checked;
  if (includeDaily) {
    Object.values(grouped).forEach(group => {
      const ws = XLSX.utils.json_to_sheet(group.rows);
      ws['!cols'] = [{wch:12},{wch:14},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10}];
      const sheetName = safeSheetName(group.name, usedNames);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  }

  XLSX.writeFile(wb, `勤怠データ_${monthVal}.xlsx`);
}

// kintai運用開始前(2026年6月・7月)の残業時間は日次データが無く再現できないため、
// 旧システム(タッチオンタイム)の月合計値を参考値として保持しておく。
// 出典:R8年度時間外・有給休暇.xlsx(法定時間外集計シート)。佐々木さんは元データに無かったため含まない。
const HISTORICAL_OVERTIME_2026 = {
  1: { 6: 1.59, 7: 5.4 },     // 嶋木 正
  11: { 6: 16.17, 7: 24.39 }, // 大坂 朝夫
  12: { 6: 20.55, 7: 24.72 }, // 小山内 寛悦
  13: { 6: 0, 7: 0 },         // 山本 英嗣
  14: { 6: 3.1, 7: 1.57 },    // 森井 良浩
  15: { 6: 22.5, 7: 22.24 },  // 三島 健
  16: { 6: 0.64, 7: 15.53 },  // 三橋 徹
  17: { 6: 22.27, 7: 13.15 }, // 鈴木 智則
  18: { 6: 22.57, 7: 33.22 }, // 佐野 雅俊
  19: { 6: 11.49, 7: 48.48 }, // 高木 裕幸
  20: { 6: 0.64, 7: 2.22 },   // 田中 規善
  21: { 6: 14.12, 7: 23.15 }, // 久保 浩康
  22: { 6: 6.6, 7: 6.05 },    // 松浦 春那
  23: { 6: 9.2, 7: 0.42 },    // 薄田 紀道
  24: { 6: 0.89, 7: 0.34 },   // 岩渕 悠汰
  25: { 6: 23.32, 7: 20.35 }, // 宇野 綾悟
  26: { 6: 0.99, 7: 21.22 },  // 小中 祐
  27: { 6: 3.15, 7: 0 },      // 須田 隼士
  28: { 6: 17.82, 7: 4.74 },  // 高橋 日和
  29: { 6: 3.94, 7: 5.54 },   // 佐藤 秀樹
  30: { 6: 8.7, 7: 10.42 },   // 山崎 太一
  31: { 6: 7.2, 7: 8.2 },     // 平野 聖美
  32: { 6: 0, 7: 0 },         // 古澤 直理
  34: { 6: 10.4, 7: 5.32 },   // 勝野 美則
  35: { 6: 16.74, 7: 30.59 }, // 川股 大将
};

// 労基法の一般基準の有給付与表(grant-paid-leave Edge Functionと同じ表)
const ANNUAL_GRANT_TABLE = [10, 11, 12, 14, 16, 18]; // n=0(6ヶ月)〜5(5.5年)、n>=6は毎年20日

function addMonthsUTC(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d));
}

// hire_dateを基準に、rangeStart〜rangeEndの間に付与基準日が来ていればその日数を返す(無ければ0)
function grantedDaysInRange(hireDate, rangeStart, rangeEnd) {
  if (!hireDate) return 0;
  const baseAnniv = addMonthsUTC(hireDate, 6);
  for (let n = 0; n < 60; n++) {
    const anniv = new Date(Date.UTC(baseAnniv.getUTCFullYear() + n, baseAnniv.getUTCMonth(), baseAnniv.getUTCDate()));
    const annivStr = anniv.toISOString().slice(0, 10);
    if (annivStr > rangeEnd) break;
    if (annivStr >= rangeStart) {
      return n < ANNUAL_GRANT_TABLE.length ? ANNUAL_GRANT_TABLE[n] : 20;
    }
  }
  return 0;
}

// 6月始まり12ヶ月分、法定/所定時間外集計・有給休暇取得日数の3シートを出力する。
// 「令和X年度 時間外・有給休暇」形式の既存Excel(旧システム)に合わせた形式。
async function exportAnnualSummary() {
  const startYear = Number(document.getElementById('annual-start-year').value);
  if (!startYear) { alert('年度の開始年を入力してください'); return; }
  const startMonthNum = 6; // 年度は6月始まり固定

  const months = [];
  for (let i = 0; i < 12; i++) {
    const y = startYear + Math.floor((startMonthNum - 1 + i) / 12);
    const m = ((startMonthNum - 1 + i) % 12) + 1;
    months.push({ year: y, month: m, label: `${m}月` });
  }

  const rangeStart = `${months[0].year}-${String(months[0].month).padStart(2, '0')}-01`;
  const last = months[11];
  const lastDay = new Date(last.year, last.month, 0).getDate();
  const rangeEnd = `${last.year}-${String(last.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const reiwaYear = startYear - 2018;
  const fiscalLabel = `令和${reiwaYear}年度`;

  const { data: rawEmployees, error: empError } = await supabaseClient
    .from('employees')
    .select('id, name, hire_date')
    .eq('is_admin', false)
    .order('id');
  if (empError) { alert('エラー: ' + empError.message); return; }
  const allEmployees = (rawEmployees || []).filter(e => !EXCLUDED_EXECUTIVE_IDS.includes(e.id));

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('employee_id, date, clock_in, clock_out, sites(work_start, work_end, break_minutes)')
    .gte('date', rangeStart)
    .lte('date', rangeEnd);
  if (error) { alert('エラー: ' + error.message); return; }

  const { data: leaveRequests } = await supabaseClient
    .from('leave_requests')
    .select('employee_id, days, start_date')
    .eq('status', 'approved')
    .eq('type', 'paid_leave')
    .gte('start_date', rangeStart)
    .lte('start_date', rangeEnd);

  const monthIndex = {};
  months.forEach((m, i) => { monthIndex[`${m.year}-${String(m.month).padStart(2, '0')}`] = i; });

  const overtimeByEmployee = {};
  const leaveByEmployee = {};
  (allEmployees || []).forEach(emp => {
    overtimeByEmployee[emp.id] = new Array(12).fill(0);
    leaveByEmployee[emp.id] = new Array(12).fill(0);
  });

  (records || []).forEach(r => {
    if (!(r.employee_id in overtimeByEmployee)) return;
    const idx = monthIndex[r.date.slice(0, 7)];
    if (idx === undefined) return;

    const workStart = r.sites ? r.sites.work_start : null;
    const workEnd = r.sites ? r.sites.work_end : null;
    const workBreak = r.sites ? r.sites.break_minutes : null;
    const metrics = computeDayMetrics(r.date, r.clock_in, r.clock_out, workStart, workEnd, workBreak);
    if (metrics.workMinutes != null) {
      overtimeByEmployee[r.employee_id][idx] += metrics.overtimeMinutes / 60;
    }
  });

  (leaveRequests || []).forEach(lr => {
    if (!(lr.employee_id in leaveByEmployee)) return;
    const idx = monthIndex[lr.start_date.slice(0, 7)];
    if (idx === undefined) return;
    leaveByEmployee[lr.employee_id][idx] += Number(lr.days || 0);
  });

  // kintai運用開始前(2026年6月・7月)は日次データが無いため、旧システムの月合計値で上書きする
  months.forEach((m, idx) => {
    if (m.year !== 2026 || (m.month !== 6 && m.month !== 7)) return;
    Object.keys(overtimeByEmployee).forEach(empId => {
      const hist = HISTORICAL_OVERTIME_2026[empId];
      if (hist && hist[m.month] !== undefined) {
        overtimeByEmployee[empId][idx] = hist[m.month];
      }
    });
  });

  const monthHeaders = months.map(m => m.label);
  const round2 = n => Math.round(n * 100) / 100;

  function buildOvertimeRows() {
    return (allEmployees || []).map((emp, i) => {
      const arr = overtimeByEmployee[emp.id];
      const total = arr.reduce((a, b) => a + b, 0);
      const row = { 'No': i + 1, [fiscalLabel]: emp.name };
      monthHeaders.forEach((h, idx) => { row[h] = round2(arr[idx]) || null; });
      row['合計'] = round2(total);
      row['平均'] = round2(total / 12);
      return row;
    });
  }

  function buildLeaveRows() {
    return (allEmployees || []).map((emp, i) => {
      const arr = leaveByEmployee[emp.id];
      const total = arr.reduce((a, b) => a + b, 0);
      const granted = grantedDaysInRange(emp.hire_date, rangeStart, rangeEnd);
      const rate = granted > 0 ? round2(total / granted * 100) / 100 : 0;
      const row = { 'No': i + 1, [fiscalLabel]: emp.name };
      monthHeaders.forEach((h, idx) => { row[h] = arr[idx] || null; });
      row['合計'] = total;
      row['付与日数'] = granted;
      row['取得率'] = rate;
      return row;
    });
  }

  const wb = XLSX.utils.book_new();
  const overtimeRows = buildOvertimeRows();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overtimeRows), '法定時間外集計');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overtimeRows), '所定時間外集計');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildLeaveRows()), '有給休暇取得日数');

  XLSX.writeFile(wb, `${fiscalLabel}_時間外・有給休暇.xlsx`);
}

const adminTypeLabel = { paid_leave: '有給休暇', business_trip: '出張' };
const adminStageLabel = { manager: '部長承認待ち', director: '常務承認待ち' };

let pendingLeaveItems = [];

async function loadPendingLeaveRequests() {
  const { data: items, error } = await supabaseClient
    .from('leave_requests')
    .select('*, employees!leave_requests_employee_id_fkey(name)')
    .eq('status', 'pending')
    .order('start_date', { ascending: true });

  if (error) { console.error(error); return; }

  pendingLeaveItems = items;
  setSummaryHighlight('pending-leave-summary', items.length > 0);

  const tbody = document.getElementById('pending-leave-body');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">承認待ちの申請はありません</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(i => `
    <tr>
      <td><button class="small" onclick="showLeaveDetail(${i.id})">${i.employees ? i.employees.name : ''}</button></td>
      <td>${adminTypeLabel[i.type] || i.type}</td>
      <td>${i.start_date} 〜 ${i.end_date}</td>
      <td>${i.days != null ? i.days : '-'}</td>
      <td>${adminStageLabel[i.current_stage] || i.current_stage}</td>
    </tr>
  `).join('');
}

function showLeaveDetail(id) {
  const i = pendingLeaveItems.find(x => x.id === id);
  if (!i) return;

  document.getElementById('leave-detail-name').textContent =
    `${i.employees ? i.employees.name : ''} さんの${adminTypeLabel[i.type] || i.type}申請`;

  const rows = [
    ['期間', `${i.start_date} 〜 ${i.end_date}`],
    ['日数', i.days != null ? i.days : '-'],
    ['現在の段階', adminStageLabel[i.current_stage] || i.current_stage],
    ['事由', i.reason || '']
  ];

  if (i.type === 'business_trip') {
    rows.push(['行き先', i.destination || '']);
    rows.push(['交通機関', i.transportation || '']);
    rows.push(['区分', i.zone === 'outside' ? '道外' : '道内']);
    rows.push(['宿泊', i.hotel_needed ? '要' : '不要']);
    if (i.total_amount != null) rows.push(['概算合計', `${i.total_amount}円`]);
  }

  document.getElementById('leave-detail-body').innerHTML = rows.map(([label, value]) => `
    <tr><th>${label}</th><td>${value}</td></tr>
  `).join('');

  document.getElementById('leave-detail-modal-bg').style.display = 'flex';
}

function closeLeaveDetail() {
  document.getElementById('leave-detail-modal-bg').style.display = 'none';
}

async function loadApprovedLeaveRequests() {
  const { data: items, error } = await supabaseClient
    .from('leave_requests')
    .select('*, employees!leave_requests_employee_id_fkey(name)')
    .eq('status', 'approved')
    .order('start_date', { ascending: false });

  if (error) { console.error(error); return; }

  setSummaryHighlight('approved-leave-summary', items.length > 0);

  const tbody = document.getElementById('approved-leave-body');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">承認済みの申請はありません</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(i => `
    <tr>
      <td>${i.employees ? i.employees.name : ''}</td>
      <td>${adminTypeLabel[i.type] || i.type}</td>
      <td>${i.start_date} 〜 ${i.end_date}</td>
      <td>
        <a href="document.html?id=${i.id}" target="_blank">書類を見る</a>
        <button class="small" style="background:#dc2626" onclick="deleteLeaveRequestAdmin(${i.id})">削除</button>
        <button class="small" style="background:#9ca3af" onclick="cancelApprovedLeave(${i.id})">取り消し</button>
      </td>
    </tr>
  `).join('');
}

async function deleteLeaveRequestAdmin(id) {
  if (!confirm('この申請データを削除しますか？Fileforceへの保管が済んでいることを確認してから削除してください。')) return;
  if (!confirm('本当に削除しますか？この操作は取り消せません。')) return;

  const { error } = await supabaseClient.from('leave_requests').delete().eq('id', id);
  if (error) { alert('エラー: ' + error.message); return; }
  loadApprovedLeaveRequests();
}

// 承認済みの有給・出張を無かったことにする(申請書類自体は消さない)。
// スケジュールの予定を削除し、有給休暇だった場合は残日数を足し戻す。
async function cancelApprovedLeave(id) {
  if (!confirm('この申請を取り消しますか？(有給休暇の場合は残日数が戻ります。スケジュールの予定と申請書類自体も削除されます)')) return;

  const { data: request, error: fetchError } = await supabaseClient
    .from('leave_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) { alert('エラー: ' + fetchError.message); return; }

  const { error: scheduleError } = await supabaseClient.from('schedules').delete().eq('leave_request_id', id);
  if (scheduleError) { alert('エラー(スケジュール削除): ' + scheduleError.message); return; }

  if (request.type === 'paid_leave') {
    const { data: emp, error: empError } = await supabaseClient
      .from('employees')
      .select('paid_leave_balance')
      .eq('id', request.employee_id)
      .single();
    if (empError) { alert('エラー(従業員取得): ' + empError.message); return; }

    const newBalance = Number(emp.paid_leave_balance) + Number(request.days);
    const { error: balanceError } = await supabaseClient
      .from('employees')
      .update({ paid_leave_balance: newBalance })
      .eq('id', request.employee_id);
    if (balanceError) { alert('エラー(残日数の更新): ' + balanceError.message); return; }
  }

  const { error: deleteError } = await supabaseClient.from('leave_requests').delete().eq('id', id);
  if (deleteError) { alert('エラー(申請書類の削除): ' + deleteError.message); return; }

  alert('取り消しました(スケジュールの予定を削除' + (request.type === 'paid_leave' ? '、残日数を足し戻し' : '') + '、申請書類も削除しました)。');
  loadApprovedLeaveRequests();
}

async function loadMissingRequests() {
  const { data: items, error } = await supabaseClient
    .from('missing_record_requests')
    .select('*, employees!missing_record_requests_employee_id_fkey(name), sites(name)')
    .eq('status', 'pending')
    .order('date', { ascending: true });

  if (error) { console.error(error); return; }

  const tbody = document.getElementById('missing-requests-body');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">申請中の項目はありません</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(i => `
    <tr>
      <td>${i.employees ? i.employees.name : ''}</td>
      <td>${i.date}</td>
      <td>${i.sites ? i.sites.name : ''}</td>
      <td>${i.requested_clock_in ? i.requested_clock_in.slice(0,5) : ''}</td>
      <td>${i.requested_clock_out ? i.requested_clock_out.slice(0,5) : '-'}</td>
      <td>
        <button class="small" onclick="approveMissingRequest(${i.id})">承認</button>
        <button class="small" style="background:#9ca3af" onclick="rejectMissingRequest(${i.id})">却下</button>
      </td>
    </tr>
  `).join('');
}

async function approveMissingRequest(id) {
  const { data: req, error: fetchError } = await supabaseClient
    .from('missing_record_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) { alert('エラー: ' + fetchError.message); return; }

  const clockInIso = `${req.date}T${req.requested_clock_in}+09:00`;
  const clockOutIso = req.requested_clock_out ? `${req.date}T${req.requested_clock_out}+09:00` : null;

  const { error: insertError } = await supabaseClient.from('time_records').insert({
    employee_id: req.employee_id,
    date: req.date,
    site_id: req.site_id,
    clock_in: clockInIso,
    clock_out: clockOutIso
  });
  if (insertError) { alert('エラー: ' + insertError.message); return; }

  const { error: updateError } = await supabaseClient
    .from('missing_record_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) { alert('エラー: ' + updateError.message); return; }

  loadMissingRequests();
}

async function rejectMissingRequest(id) {
  const { error } = await supabaseClient
    .from('missing_record_requests')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { alert('エラー: ' + error.message); return; }
  loadMissingRequests();
}

async function createEmployee() {
  const name = document.getElementById('new-emp-name').value.trim();
  const email = document.getElementById('new-emp-email').value.trim();
  const password = document.getElementById('new-emp-password').value;
  const hireDate = document.getElementById('new-emp-hire-date').value;
  const department = document.getElementById('new-emp-department').value;
  const msg = document.getElementById('create-emp-message');

  if (!name || !email || !password || !hireDate) {
    msg.style.color = 'red';
    msg.textContent = '氏名・メールアドレス・パスワード・入社日は必須です';
    return;
  }

  msg.style.color = 'black';
  msg.textContent = '登録中...';

  const { data: { session } } = await supabaseClient.auth.getSession();

  const { data, error } = await supabaseClient.functions.invoke('create-employee', {
    body: { name, email, password, department, hire_date: hireDate },
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (error || (data && data.error)) {
    msg.style.color = 'red';
    msg.textContent = 'エラー: ' + (data?.error || error.message);
    return;
  }

  msg.style.color = 'green';
  msg.textContent = `${name}さんを登録しました(${email})`;
  document.getElementById('new-emp-name').value = '';
  document.getElementById('new-emp-email').value = '';
  document.getElementById('new-emp-password').value = '';
  document.getElementById('new-emp-hire-date').value = '';
  loadEmployees();
}

const deptLabel = { civil: '土木部', accounting: '経理部' };

async function loadEmployees() {
  const { data: employees, error } = await supabaseClient
    .from('employees')
    .select('id, name, department, is_active, paid_leave_balance')
    .eq('is_admin', false)
    .order('name');

  if (error) { console.error(error); return; }

  const tbody = document.getElementById('employees-body');
  tbody.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}</td>
      <td>${deptLabel[e.department] || e.department || '-'}</td>
      <td style="color:#dc2626">${e.paid_leave_balance != null ? e.paid_leave_balance : '-'}</td>
      <td>${e.is_active ? '<span class="status-approved">有効</span>' : '<span class="status-rejected">無効</span>'}</td>
      <td>
        ${e.is_active
          ? `<button class="small" style="background:#dc2626" onclick="toggleActive(${e.id}, false)">無効化</button>`
          : `<button class="small" onclick="toggleActive(${e.id}, true)">有効化</button>`
        }
      </td>
    </tr>
  `).join('');
}

async function toggleActive(id, makeActive) {
  const label = makeActive ? '有効化' : '無効化';
  if (!confirm(`この従業員を${label}します。よろしいですか？`)) return;

  const { error } = await supabaseClient.from('employees').update({ is_active: makeActive }).eq('id', id);
  if (error) { alert('エラー: ' + error.message); return; }
  loadEmployees();
}

init();
