const supabaseUrl = 'https://clymwlhxnkpwukuoblga.supabase.co';
const supabaseKey = 'sb_publishable_npAygzNwa6ERwIRUpHabHA_Djm_BFNu';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let employee = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;
let scheduleItems = [];
let selectedDate = null;
let selectedEvent = null;

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
  document.getElementById('month-label').textContent = `${viewYear}年${viewMonth}月`;

  const monthStr = String(viewMonth).padStart(2, '0');
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
  scheduleItems = items;
  renderCalendar();
}

function renderCalendar() {
  const cal = document.getElementById('calendar');
  const lastDay = new Date(viewYear, viewMonth, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0=日
  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];

  let html = '<div class="cal-grid cal-header">';
  dowLabels.forEach((d, i) => {
    html += `<div class="cal-dow ${i === 0 ? 'cal-sun' : ''} ${i === 6 ? 'cal-sat' : ''}">${d}</div>`;
  });
  html += '</div><div class="cal-grid">';

  for (let i = 0; i < firstWeekday; i++) {
    html += '<div class="cal-cell cal-empty"></div>';
  }

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${viewYear}-${String(viewMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayItems = scheduleItems.filter(i => i.date === dateStr);
    const weekday = new Date(viewYear, viewMonth - 1, day).getDay();

    let eventsHtml = dayItems.map(i => {
      const label = i.employees ? i.employees.name : '';
      return `<div class="cal-event cal-type-${i.type}" onclick="openEventView(event, ${i.id})" title="${i.title || ''}">${label}: ${i.title || typeLabel[i.type]}</div>`;
    }).join('');

    html += `<div class="cal-cell ${weekday === 0 ? 'cal-sun' : ''} ${weekday === 6 ? 'cal-sat' : ''}" onclick="openAddModal('${dateStr}')">
      <div class="cal-daynum">${day}</div>
      ${eventsHtml}
    </div>`;
  }

  html += '</div>';
  cal.innerHTML = html;
}

function openAddModal(dateStr) {
  selectedDate = dateStr;
  selectedEvent = null;
  document.getElementById('modal-title').textContent = '予定を追加';
  document.getElementById('modal-date-label').textContent = dateStr;
  document.getElementById('event-view').style.display = 'none';
  document.getElementById('event-form').style.display = 'block';
  document.getElementById('new-title').value = '';
  document.getElementById('new-start').value = '';
  document.getElementById('new-end').value = '';
  document.getElementById('modal-bg').style.display = 'flex';
}

function openEventView(evt, id) {
  evt.stopPropagation();
  const item = scheduleItems.find(i => i.id === id);
  if (!item) return;
  selectedEvent = item;
  selectedDate = item.date;

  document.getElementById('modal-title').textContent = '予定の詳細';
  document.getElementById('modal-date-label').textContent = item.date;
  document.getElementById('event-form').style.display = 'none';
  document.getElementById('event-view').style.display = 'block';

  document.getElementById('view-title').textContent = item.title || typeLabel[item.type];
  document.getElementById('view-employee').textContent = '登録者: ' + (item.employees ? item.employees.name : '-');
  const timeStr = (item.start_time && item.end_time) ? `${item.start_time.slice(0,5)}〜${item.end_time.slice(0,5)}` : '';
  document.getElementById('view-time').textContent = timeStr;

  const canDelete = employee && (item.employee_id === employee.id || employee.is_admin);
  document.getElementById('view-delete-btn').style.display = canDelete ? 'block' : 'none';

  document.getElementById('modal-bg').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-bg').style.display = 'none';
}

async function addEvent() {
  const title = document.getElementById('new-title').value.trim();
  const start = document.getElementById('new-start').value;
  const end = document.getElementById('new-end').value;

  if (!title) { alert('件名を入力してください'); return; }

  const { error } = await supabaseClient.from('schedules').insert({
    employee_id: employee.id,
    date: selectedDate,
    type: 'event',
    title: title,
    start_time: start || null,
    end_time: end || null
  });

  if (error) { alert('エラー: ' + error.message); return; }
  closeModal();
  loadSchedule();
}

async function deleteCurrentEvent() {
  if (!selectedEvent) return;
  if (!confirm('削除しますか？')) return;
  const { error } = await supabaseClient.from('schedules').delete().eq('id', selectedEvent.id);
  if (error) { alert('エラー: ' + error.message); return; }
  closeModal();
  loadSchedule();
}
