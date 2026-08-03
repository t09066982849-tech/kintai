const supabaseUrl = 'https://clymwlhxnkpwukuoblga.supabase.co';
const supabaseKey = 'sb_publishable_npAygzNwa6ERwIRUpHabHA_Djm_BFNu';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let employee = null;

const typeLabel = { paid_leave: '有給休暇', business_trip: '出張' };
const stageLabel = { manager: '部長承認待ち', director: '常務承認待ち', president: '社長承認待ち', done: '承認完了' };

// 承認者の役職名
const PRESIDENT_NAME = '伊豆倉 寿信';
const DIRECTOR_NAME = '伊豆倉 米郎';
const MANAGER_NAME_BY_DEPT = { civil: '山本 英嗣', accounting: '佐藤 秀樹' };

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

async function logout() {
  await supabaseClient.auth.signOut();
  location.reload();
}

async function init() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: emp } = await supabaseClient
    .from('employees')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();
  employee = emp;

  document.getElementById('login-box').style.display = 'none';
  document.getElementById('main-box').style.display = 'block';
  document.getElementById('welcome').textContent = employee.name + ' さん';

  if ([PRESIDENT_NAME, DIRECTOR_NAME, '山本 英嗣', '佐藤 秀樹'].includes(employee.name)) {
    document.getElementById('approval-section').style.display = 'block';
    loadApprovalList();
  }

  loadMyRequests();
}

async function submitRequest() {
  const type = document.getElementById('new-type').value;
  const start = document.getElementById('new-start').value;
  const end = document.getElementById('new-end').value;
  const days = document.getElementById('new-days').value;
  const reason = document.getElementById('new-reason').value.trim();
  const contact = document.getElementById('new-contact').value.trim();

  if (!start || !end || !days || !reason) { alert('必須項目を入力してください'); return; }

  const { data, error } = await supabaseClient.from('leave_requests').insert({
    employee_id: employee.id,
    type: type,
    start_date: start,
    end_date: end,
    days: Number(days),
    reason: reason,
    contact_phone: contact || null
  }).select().single();

  if (error) { alert('エラー: ' + error.message); return; }

  document.getElementById('new-start').value = '';
  document.getElementById('new-end').value = '';
  document.getElementById('new-days').value = '';
  document.getElementById('new-reason').value = '';
  document.getElementById('new-contact').value = '';

  // 申請者自身が最初の承認者(部長など)と同一人物なら自動スキップ
  await autoSkipIfSelf(data);

  loadMyRequests();
  if (document.getElementById('approval-section').style.display === 'block') loadApprovalList();
}

// 承認者が申請者自身の場合、その段階を自動的に承認済みにして次へ進める
async function autoSkipIfSelf(request) {
  let current = request;
  let guard = 0;
  while (current.status === 'pending' && guard < 5) {
    guard++;
    const approverName = getApproverNameForStage(current);
    if (approverName !== employee.name) break;
    current = await advanceStage(current, employee.id, true);
  }
}

function getApproverNameForStage(request) {
  if (request.current_stage === 'manager') return null; // 部長は申請者の部署によるので呼び出し側で個別対応
  if (request.current_stage === 'director') return DIRECTOR_NAME;
  if (request.current_stage === 'president') return PRESIDENT_NAME;
  return null;
}

async function loadApprovalList() {
  const { data: items, error } = await supabaseClient
    .from('leave_requests')
    .select('*, employees!leave_requests_employee_id_fkey(name, department)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }

  const myApprovals = items.filter(i => isApproverForStage(i));

  const tbody = document.getElementById('approval-body');
  if (myApprovals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">承認待ちの申請はありません</td></tr>';
    return;
  }

  tbody.innerHTML = myApprovals.map(i => `
    <tr>
      <td>${i.employees.name}</td>
      <td>${typeLabel[i.type] || i.type}</td>
      <td>${i.start_date} 〜 ${i.end_date}</td>
      <td>${i.days}</td>
      <td>${i.reason || ''}</td>
      <td>
        <button class="small" onclick="approveRequest(${i.id})">承認</button>
        <button class="small" style="background:#dc2626" onclick="rejectRequest(${i.id})">却下</button>
      </td>
    </tr>
  `).join('');
}

function isApproverForStage(item) {
  if (item.current_stage === 'manager') {
    const managerName = MANAGER_NAME_BY_DEPT[item.employees.department];
    return managerName === employee.name;
  }
  if (item.current_stage === 'director') return employee.name === DIRECTOR_NAME;
  if (item.current_stage === 'president') return employee.name === PRESIDENT_NAME;
  return false;
}

async function advanceStage(request, approverId, isSkip) {
  const updates = {};
  const now = new Date().toISOString();

  if (request.current_stage === 'manager') {
    updates.manager_approved_by = approverId;
    updates.manager_approved_at = now;
    updates.current_stage = 'director';
  } else if (request.current_stage === 'director') {
    updates.director_approved_by = approverId;
    updates.director_approved_at = now;
    updates.current_stage = 'president';
  } else if (request.current_stage === 'president') {
    updates.president_approved_by = approverId;
    updates.president_approved_at = now;
    updates.current_stage = 'done';
    updates.status = 'approved';
  }

  const { data, error } = await supabaseClient
    .from('leave_requests')
    .update(updates)
    .eq('id', request.id)
    .select()
    .single();

  if (error) { if (!isSkip) alert('エラー: ' + error.message); return request; }

  if (data.status === 'approved') {
    await reflectToSchedule(data);
  }

  return data;
}

async function reflectToSchedule(request) {
  const scheduleType = request.type === 'paid_leave' ? 'paid_leave' : 'business_trip';
  const title = request.type === 'paid_leave' ? '有給休暇' : '出張';

  await supabaseClient.from('schedules').insert({
    employee_id: request.employee_id,
    date: request.start_date,
    end_date: request.end_date !== request.start_date ? request.end_date : null,
    type: scheduleType,
    title: title
  });
}

async function approveRequest(id) {
  const { data: request, error } = await supabaseClient
    .from('leave_requests')
    .select('*, employees!leave_requests_employee_id_fkey(name, department)')
    .eq('id', id)
    .single();
  if (error) { alert('エラー: ' + error.message); return; }

  let current = await advanceStage(request, employee.id, false);

  // 次の承認者が申請者本人と同じ場合は自動スキップ
  let guard = 0;
  while (current.status === 'pending' && guard < 5) {
    guard++;
    let nextApproverName;
    if (current.current_stage === 'manager') nextApproverName = MANAGER_NAME_BY_DEPT[request.employees.department];
    else if (current.current_stage === 'director') nextApproverName = DIRECTOR_NAME;
    else if (current.current_stage === 'president') nextApproverName = PRESIDENT_NAME;

    if (nextApproverName !== request.employees.name) break;
    current = await advanceStage(current, request.employee_id, true);
  }

  loadApprovalList();
}

async function rejectRequest(id) {
  if (!confirm('却下しますか？')) return;
  const { error } = await supabaseClient.from('leave_requests').update({
    status: 'rejected',
    rejected_by: employee.id,
    rejected_at: new Date().toISOString()
  }).eq('id', id);

  if (error) { alert('エラー: ' + error.message); return; }
  loadApprovalList();
}

async function loadMyRequests() {
  const { data: items, error } = await supabaseClient
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employee.id)
    .order('created_at', { ascending: false });

  if (error) { console.error(error); return; }

  const tbody = document.getElementById('my-requests-body');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">申請はまだありません</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(i => {
    let statusText;
    if (i.status === 'rejected') statusText = '却下';
    else if (i.status === 'approved') statusText = '承認完了';
    else statusText = stageLabel[i.current_stage] || i.current_stage;

    return `<tr>
      <td>${typeLabel[i.type] || i.type}</td>
      <td>${i.start_date} 〜 ${i.end_date}</td>
      <td>${i.days}</td>
      <td>${statusText}</td>
    </tr>`;
  }).join('');
}

init();
