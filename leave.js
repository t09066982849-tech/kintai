let employee = null;

const typeLabel = { paid_leave: '有給休暇', business_trip: '出張' };
const stageLabel = { manager: '部長承認待ち', director: '常務承認待ち', president: '社長承認待ち', done: '承認完了' };

const APPROVER_ROLES = ['president', 'director', 'manager_civil', 'manager_accounting'];

function requiredRoleForStage(stage, department) {
  if (stage === 'manager') return department === 'accounting' ? 'manager_accounting' : 'manager_civil';
  if (stage === 'director') return 'director';
  if (stage === 'president') return 'president';
  return null;
}

let myTravelRates = null; // { domestic: {daily_allowance, hotel_fee}, outside: {...} } または null(対象外)

async function init() {
  employee = await requireEmployee();
  if (!employee) return;

  if (APPROVER_ROLES.includes(employee.role)) {
    document.getElementById('approval-section').style.display = 'block';
    loadApprovalList();
  }

  await loadMyTravelRates();
  toggleTypeFields();
  loadMyRequests();
}

async function loadMyTravelRates() {
  if (!employee.travel_rate_group_id) { myTravelRates = null; return; }

  const { data, error } = await supabaseClient
    .from('travel_rates')
    .select('zone, daily_allowance, hotel_fee')
    .eq('group_id', employee.travel_rate_group_id);

  if (error || !data) { myTravelRates = null; return; }

  myTravelRates = {};
  data.forEach(r => { myTravelRates[r.zone] = r; });
}

function updateEstimate() {
  const box = document.getElementById('estimate-box');
  const zone = document.getElementById('new-zone').value;
  const days = Number(document.getElementById('new-days').value) || 0;
  const hotelNeeded = document.getElementById('new-hotel').checked;

  if (!myTravelRates || !myTravelRates[zone]) {
    box.textContent = 'この区分の旅費規程が設定されていません。経理にご確認ください。';
    return;
  }

  const rate = myTravelRates[zone];
  const nights = Math.max(0, days - 1); // 宿泊数 = 日数 - 1
  const allowanceTotal = rate.daily_allowance * days;
  const hotelTotal = hotelNeeded ? rate.hotel_fee * nights : 0;
  const total = allowanceTotal + hotelTotal;

  box.textContent = `概算:日当 ${rate.daily_allowance}円 × ${days}日 = ${allowanceTotal}円` +
    (hotelNeeded ? ` / 宿泊費 ${rate.hotel_fee}円 × ${nights}泊 = ${hotelTotal}円` : '') +
    ` / 合計 ${total}円(概算です。実費と異なる場合があります)`;
}

function toggleTypeFields() {
  const type = document.getElementById('new-type').value;
  const isTrip = type === 'business_trip';
  document.getElementById('trip-fields').style.display = isTrip ? 'block' : 'none';
  document.getElementById('reason-label').textContent = isTrip ? '用件' : '事由';
  document.getElementById('new-reason').placeholder = isTrip ? '例:○○現場視察の為' : '例:私用の為';
  if (isTrip) updateEstimate();
}

async function submitRequest() {
  const type = document.getElementById('new-type').value;
  const start = document.getElementById('new-start').value;
  const end = document.getElementById('new-end').value;
  const days = document.getElementById('new-days').value;
  const reason = document.getElementById('new-reason').value.trim();
  const contact = document.getElementById('new-contact').value.trim();

  if (!start || !end || !days || !reason) { alert('必須項目を入力してください'); return; }

  const payload = {
    employee_id: employee.id,
    type: type,
    start_date: start,
    end_date: end,
    days: Number(days),
    reason: reason,
    contact_phone: contact || null
  };

  if (type === 'business_trip') {
    const destination = document.getElementById('new-destination').value.trim();
    const transportation = document.getElementById('new-transportation').value.trim();
    const hotelNeeded = document.getElementById('new-hotel').checked;
    const zone = document.getElementById('new-zone').value;

    if (!destination) { alert('行き先を入力してください'); return; }

    payload.destination = destination;
    payload.transportation = transportation || null;
    payload.hotel_needed = hotelNeeded;
    payload.zone = zone;

    if (myTravelRates && myTravelRates[zone]) {
      const rate = myTravelRates[zone];
      const nights = Math.max(0, Number(days) - 1);
      payload.daily_allowance = rate.daily_allowance;
      payload.hotel_fee = hotelNeeded ? rate.hotel_fee : 0;
      payload.total_amount = (rate.daily_allowance * Number(days)) + (hotelNeeded ? rate.hotel_fee * nights : 0);
    }
  }

  const { data, error } = await supabaseClient.from('leave_requests').insert(payload).select().single();

  if (error) { alert('エラー: ' + error.message); return; }

  document.getElementById('new-start').value = '';
  document.getElementById('new-end').value = '';
  document.getElementById('new-days').value = '';
  document.getElementById('new-reason').value = '';
  document.getElementById('new-contact').value = '';
  document.getElementById('new-destination').value = '';
  document.getElementById('new-transportation').value = '';
  document.getElementById('new-hotel').checked = false;
  document.getElementById('estimate-box').textContent = '';

  await autoSkipIfSelf(data);

  loadMyRequests();
  if (document.getElementById('approval-section').style.display === 'block') loadApprovalList();
}

async function autoSkipIfSelf(request) {
  let current = request;
  let guard = 0;
  while (current.status === 'pending' && guard < 5) {
    guard++;
    const requiredRole = requiredRoleForStage(current.current_stage, employee.department);
    if (requiredRole !== employee.role) break;
    current = await advanceStage(current, employee.id, true);
  }
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

  tbody.innerHTML = myApprovals.map(i => {
    let detail = i.reason || '';
    if (i.type === 'business_trip') {
      const zoneLabel = i.zone === 'outside' ? '道外' : '道内';
      const parts = [];
      if (i.destination) parts.push('行き先:' + i.destination);
      if (i.transportation) parts.push('交通:' + i.transportation);
      parts.push('区分:' + zoneLabel);
      parts.push('ホテル:' + (i.hotel_needed ? '要' : '不要'));
      if (i.total_amount != null) parts.push('概算合計:' + i.total_amount + '円');
      parts.push('用件:' + (i.reason || ''));
      detail = parts.join(' / ');
    }
    return `
    <tr>
      <td>${i.employees.name}</td>
      <td>${typeLabel[i.type] || i.type}</td>
      <td>${i.start_date} 〜 ${i.end_date}</td>
      <td>${i.days}</td>
      <td>${detail}</td>
      <td>
        <button class="small" onclick="approveRequest(${i.id})">承認</button>
        <button class="small" style="background:#dc2626" onclick="rejectRequest(${i.id})">却下</button>
      </td>
    </tr>
  `;
  }).join('');
}

function isApproverForStage(item) {
  const requiredRole = requiredRoleForStage(item.current_stage, item.employees.department);
  return employee.role === requiredRole;
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
  let title = request.type === 'paid_leave' ? '有給休暇' : '出張';
  if (request.type === 'business_trip' && request.destination) {
    title = `出張(${request.destination})`;
  }

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
    .select('*, employees!leave_requests_employee_id_fkey(name, department, role)')
    .eq('id', id)
    .single();
  if (error) { alert('エラー: ' + error.message); return; }

  let current = await advanceStage(request, employee.id, false);

  let guard = 0;
  while (current.status === 'pending' && guard < 5) {
    guard++;
    const nextRequiredRole = requiredRoleForStage(current.current_stage, request.employees.department);
    if (nextRequiredRole !== request.employees.role) break;
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
    else if (i.status === 'approved') statusText = `承認完了 <a href="document.html?id=${i.id}" target="_blank">書類を見る</a>`;
    else statusText = stageLabel[i.current_stage] || i.current_stage;

    const canCancel = i.status === 'pending' && !i.manager_approved_by;
    const cancelCell = canCancel ? `<button class="small" style="background:#dc2626" onclick="cancelMyRequest(${i.id})">取り消し</button>` : '-';

    return `<tr>
      <td>${typeLabel[i.type] || i.type}</td>
      <td>${i.start_date} 〜 ${i.end_date}</td>
      <td>${i.days}</td>
      <td>${statusText}</td>
      <td>${cancelCell}</td>
    </tr>`;
  }).join('');
}

async function cancelMyRequest(id) {
  if (!confirm('この申請を取り消しますか？')) return;
  const { error } = await supabaseClient.from('leave_requests').delete().eq('id', id);
  if (error) { alert('エラー: ' + error.message + '(すでに承認が始まっている場合は取り消せません)'); return; }
  loadMyRequests();
}

init();
