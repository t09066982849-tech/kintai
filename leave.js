const supabaseUrl = 'https://clymwlhxnkpwukuoblga.supabase.co';
const supabaseKey = 'sb_publishable_npAygzNwa6ERwIRUpHabHA_Djm_BFNu';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let employee = null;

const typeLabel = { paid_leave: '有給休暇', business_trip: '出張' };
const stageLabel = { manager: '部長承認待ち', director: '常務承認待ち', president: '社長承認待ち', done: '承認完了' };

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

  const { error } = await supabaseClient.from('leave_requests').insert({
    employee_id: employee.id,
    type: type,
    start_date: start,
    end_date: end,
    days: Number(days),
    reason: reason,
    contact_phone: contact || null
  });

  if (error) { alert('エラー: ' + error.message); return; }

  document.getElementById('new-start').value = '';
  document.getElementById('new-end').value = '';
  document.getElementById('new-days').value = '';
  document.getElementById('new-reason').value = '';
  document.getElementById('new-contact').value = '';

  loadMyRequests();
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
