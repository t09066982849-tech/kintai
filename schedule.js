const supabaseUrl = 'https://clymwlhxnkpwukuoblga.supabase.co';
const supabaseKey = 'sb_publishable_npAygzNwa6ERwIRUpHabHA_Djm_BFNu';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let employee = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;

const typeLabel = {
  paid_leave: '有給',
  business_trip: '出張',
  event: '予定'
};

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

  loadSchedule();
}

function changeMonth(diff) {
  viewMonth += diff;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  loadSchedule();
}

async function loadSchedule() {
  const monthStr = String(viewMonth).padStart(2, '0');
  document.getElementById('month-label').textContent = `${viewYear}年${viewMonth}月`;

  const startDate = `${viewYear}-${monthStr}-01`;
  const lastDay = new Date(viewYear, viewMonth, 0).getDate();
  const endDate = `${viewYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data: items, error } = await supabaseClient
    .from('schedules')
    .select('*, employees(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) { console.error(error); return; }

  const tbody = document.getElementById('schedule-body');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">予定がありません</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(i => {
    const timeStr = (i.start_time && i.end_time) ? `${i.start_time.slice(0,5)}〜${i.end_time.slice(0,5)}` : '-';
    return `<tr>
      <td>${i.date}</td>
      <td>${i.employees ? i.employees.name : '-'}</td>
      <td>${typeLabel[i.type] || i.type}</td>
      <td>${i.title || '-'}</td>
      <td>${timeStr}</td>
    </tr>`;
  }).join('');
}
