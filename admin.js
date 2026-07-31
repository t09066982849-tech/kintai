const supabaseUrl = 'https://clymwlhxnkpwukuoblga.supabase.co';
const supabaseKey = 'sb_publishable_npAygzNwa6ERwIRUpHabHA_Djm_BFNu';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let employee = null;

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById('login-error').textContent = 'ログインできませんでした';
    return;
  }
  init();
}

async function init() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: emp } = await supabaseClient
    .from('employees')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();

  if (!emp || !emp.is_admin) {
    document.getElementById('login-error').textContent = '管理者権限がありません';
    await supabaseClient.auth.signOut();
    return;
  }
  employee = emp;

  document.getElementById('login-box').style.display = 'none';
  document.getElementById('main-box').style.display = 'block';
  document.getElementById('welcome').textContent = employee.name + ' さん(管理者)';

  const now = new Date();
  document.getElementById('export-month').value = now.toISOString().slice(0, 7);

  loadRequests();
  loadSites();
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '-';
}

async function loadRequests() {
  const { data: requests, error } = await supabaseClient
    .from('correction_requests')
    .select('*, employees(name), time_records(date, clock_in, clock_out)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }

  const tbody = document.getElementById('requests-body');
  if (requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">申請中の項目はありません</td></tr>';
    return;
  }

  tbody.innerHTML = requests.map(r => `
    <tr>
      <td>${r.employees.name}</td>
      <td>${r.time_records.date}</td>
      <td>${fmtTime(r.time_records.clock_in)}</td>
      <td>${fmtTime(r.time_records.clock_out)}</td>
      <td>${fmtTime(r.requested_clock_in)}</td>
      <td>${fmtTime(r.requested_clock_out)}</td>
      <td>
        <button class="small" onclick="approve(${r.id}, ${r.time_record_id}, '${r.requested_clock_in || ''}', '${r.requested_clock_out || ''}')">承認</button>
        <button class="small" style="background:#9ca3af" onclick="reject(${r.id})">却下</button>
      </td>
    </tr>
  `).join('');
}

async function approve(requestId, timeRecordId, requestedIn, requestedOut) {
  const updates = {};
  if (requestedIn) updates.clock_in = requestedIn;
  if (requestedOut) updates.clock_out = requestedOut;

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

async function exportExcel() {
  const monthVal = document.getElementById('export-month').value; // "2026-07"
  if (!monthVal) { alert('月を選んでください'); return; }

  const [year, month] = monthVal.split('-').map(Number);
  const startDate = `${monthVal}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${monthVal}-${String(lastDay).padStart(2, '0')}`;

  const { data: records, error } = await supabaseClient
    .from('time_records')
    .select('*, employees(name), sites(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('employee_id', { ascending: true })
    .order('date', { ascending: true });

  if (error) { alert('エラー: ' + error.message); return; }

  const rows = records.map(r => {
    const inTime = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '';
    const outTime = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '';

    let workTime = '';
    if (r.clock_in && r.clock_out) {
      const diffMs = new Date(r.clock_out) - new Date(r.clock_in);
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.round((diffMs % 3600000) / 60000);
      workTime = hours + '時間' + mins + '分';
    }

    const inGps = (r.clock_in_lat && r.clock_in_lng) ? `${r.clock_in_lat}, ${r.clock_in_lng}` : '';
    const outGps = (r.clock_out_lat && r.clock_out_lng) ? `${r.clock_out_lat}, ${r.clock_out_lng}` : '';

    return {
      '従業員': r.employees ? r.employees.name : '',
      '日付': r.date,
      '現場': r.sites ? r.sites.name : '',
      '出勤時刻': inTime,
      '退勤時刻': outTime,
      '勤務時間': workTime,
      '出勤位置': inGps,
      '退勤位置': outGps
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:14},{wch:12},{wch:14},{wch:10},{wch:10},{wch:10},{wch:20},{wch:20}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${monthVal}`);
  XLSX.writeFile(wb, `勤怠データ_${monthVal}.xlsx`);
}
