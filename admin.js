let employee = null;

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

  loadRequests();
  loadSites();
  loadApprovedLeaveRequests();
  loadMissingRequests();
  loadEmployees();
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '-';
}

async function loadRequests() {
  const { data: requests, error } = await supabaseClient
    .from('correction_requests')
    .select('*, employees(name), time_records(date, clock_in, clock_out, site_id, sites(name)), requested_site:sites!correction_requests_requested_site_id_fkey(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }

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
      <td><button class="small" style="background:#dc2626" onclick="deleteSite(${s.id})">削除</button></td>
    </tr>
  `).join('');
}

async function addSite() {
  const name = document.getElementById('new-site-name').value.trim();
  if (!name) return;
  const { error } = await supabaseClient.from('sites').insert({ name });
  if (error) { alert('エラー: ' + error.message); return; }
  document.getElementById('new-site-name').value = '';
  loadSites();
}

async function deleteSite(id) {
  if (!confirm('削除しますか？')) return;
  const { error } = await supabaseClient.from('sites').delete().eq('id', id);
  if (error) { alert('エラー: ' + error.message); return; }
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

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('*, employees(id, name), sites(name, work_start, work_end)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('employee_id', { ascending: true })
    .order('date', { ascending: true });

  if (error) { alert('エラー: ' + error.message); return; }

  if (records.length === 0) { alert('この月のデータがありません'); return; }

  const grouped = {};
  records.forEach(r => {
    const empId = r.employees ? r.employees.id : 'unknown';
    const empName = r.employees ? r.employees.name : '不明';
    if (!grouped[empId]) grouped[empId] = { name: empName, rows: [] };

    const workStart = r.sites ? r.sites.work_start : null;
    const workEnd = r.sites ? r.sites.work_end : null;
    const metrics = computeDayMetrics(r.date, r.clock_in, r.clock_out, workStart, workEnd);

    const inTime = formatTimeJa(metrics.adjustedIn);
    const outTime = formatTimeJa(metrics.adjustedOut);
    const workTime = metrics.workMinutes != null ? formatMinutesJa(metrics.workMinutes) : '';
    const overtimeTime = metrics.workMinutes != null ? formatMinutesJa(metrics.overtimeMinutes) : '';

    grouped[empId].rows.push({
      '日付': r.date,
      '現場': r.sites ? r.sites.name : '',
      '出勤時刻': inTime,
      '退勤時刻': outTime,
      '勤務時間': workTime,
      '残業時間': overtimeTime
    });
  });

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  Object.values(grouped).forEach(group => {
    const ws = XLSX.utils.json_to_sheet(group.rows);
    ws['!cols'] = [{wch:12},{wch:14},{wch:10},{wch:10},{wch:10},{wch:10}];
    const sheetName = safeSheetName(group.name, usedNames);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `勤怠データ_${monthVal}.xlsx`);
}

const adminTypeLabel = { paid_leave: '有給休暇', business_trip: '出張' };

async function loadApprovedLeaveRequests() {
  const { data: items, error } = await supabaseClient
    .from('leave_requests')
    .select('*, employees!leave_requests_employee_id_fkey(name)')
    .eq('status', 'approved')
    .order('start_date', { ascending: false });

  if (error) { console.error(error); return; }

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
  const department = document.getElementById('new-emp-department').value;
  const msg = document.getElementById('create-emp-message');

  if (!name || !email || !password) {
    msg.style.color = 'red';
    msg.textContent = '氏名・メールアドレス・パスワードは必須です';
    return;
  }

  msg.style.color = 'black';
  msg.textContent = '登録中...';

  const { data: { session } } = await supabaseClient.auth.getSession();

  const { data, error } = await supabaseClient.functions.invoke('create-employee', {
    body: { name, email, password, department },
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
  loadEmployees();
}

const deptLabel = { civil: '土木部', accounting: '経理部' };

async function loadEmployees() {
  const { data: employees, error } = await supabaseClient
    .from('employees')
    .select('id, name, department, is_active')
    .eq('is_admin', false)
    .order('name');

  if (error) { console.error(error); return; }

  const tbody = document.getElementById('employees-body');
  tbody.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}</td>
      <td>${deptLabel[e.department] || e.department || '-'}</td>
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
