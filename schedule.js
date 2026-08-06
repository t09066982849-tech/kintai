let employee = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;
let scheduleItems = [];
let selectedDate = null;
let selectedEvent = null;
let allEmployees = [];

const typeLabel = {
  paid_leave: '有給',
  business_trip: '出張',
  event: '予定'
};

async function init() {
  employee = await requireEmployee();
  if (!employee) return;

  const { data: emps } = await supabaseClient.from('employees').select('id, name').order('id');
  allEmployees = emps || [];

  loadSchedule();
}

function changeMonth(diff) {
  viewMonth += diff;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  loadSchedule();
}

let holidaysByDate = {};

async function loadSchedule() {
  document.getElementById('month-label').textContent = `${viewYear}年${viewMonth}月`;

  const monthStr = String(viewMonth).padStart(2, '0');
  const startDate = `${viewYear}-${monthStr}-01`;
  const lastDay = new Date(viewYear, viewMonth, 0).getDate();
  const endDate = `${viewYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data: items, error } = await supabaseClient
    .from('schedules')
    .select('*, employees!schedules_employee_id_fkey(name), schedule_members(employee_id, employees!schedule_members_employee_id_fkey(name))')
    .lte('date', endDate)
    .or(`end_date.gte.${startDate},end_date.is.null`)
    .order('date', { ascending: true });

  if (error) { console.error(error); return; }

  scheduleItems = items.filter(i => {
    const itemEnd = i.end_date || i.date;
    return itemEnd >= startDate && i.date <= endDate;
  });

  const { data: holidays } = await supabaseClient
    .from('holidays')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);

  holidaysByDate = {};
  (holidays || []).forEach(h => { holidaysByDate[h.date] = h.name; });

  renderCalendar();
}

function renderCalendar() {
  const cal = document.getElementById('calendar');
  const lastDay = new Date(viewYear, viewMonth, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];

  let html = '<div class="cal-grid cal-header">';
  dowLabels.forEach((d, i) => {
    html += `<div class="cal-dow ${i === 0 ? 'cal-sun' : ''} ${i === 6 ? 'cal-sat' : ''}">${d}</div>`;
  });
  html += '</div>';

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push(`${viewYear}-${String(viewMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  for (let i = 0; i < cells.length; i += 7) {
    html += renderWeek(cells.slice(i, i + 7));
  }

  cal.innerHTML = html;
}

function renderWeek(week) {
  const weekDates = week.filter(d => d);
  if (weekDates.length === 0) return '';
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];

  const weekEvents = scheduleItems.filter(i => {
    const itemEnd = i.end_date || i.date;
    return itemEnd >= weekStart && i.date <= weekEnd;
  });

  function priority(item) {
    const isMultiDay = item.end_date && item.end_date !== item.date;
    if (isMultiDay) return 0;      // 日をまたぐ予定
    if (!item.start_time) return 1; // 終日の予定
    return 2;                       // 時刻指定あり
  }

  const bars = weekEvents.map(i => {
    const itemEnd = i.end_date || i.date;
    let colStart = week.findIndex(d => d === i.date);
    let colEnd = week.findIndex(d => d === itemEnd);
    if (colStart === -1) colStart = 0;
    if (colEnd === -1) colEnd = 6;
    return {
      item: i,
      colStart,
      colEnd,
      continuesFromPrev: i.date < weekStart,
      continuesToNext: itemEnd > weekEnd
    };
  }).sort((a, b) => {
    const pa = priority(a.item), pb = priority(b.item);
    if (pa !== pb) return pa - pb;
    if (pa === 2) {
      return (a.item.start_time || '').localeCompare(b.item.start_time || '');
    }
    return a.colStart - b.colStart || (b.colEnd - b.colStart) - (a.colEnd - a.colStart);
  });

  const slotEnds = [];
  bars.forEach(bar => {
    let slot = slotEnds.findIndex(end => end < bar.colStart);
    if (slot === -1) { slot = slotEnds.length; slotEnds.push(bar.colEnd); }
    else { slotEnds[slot] = bar.colEnd; }
    bar.slot = slot;
  });
  const slotCount = Math.max(3, slotEnds.length);

  let html = `<div class="cal-week" style="grid-template-rows: 18px repeat(${slotCount}, 18px);">`;

  week.forEach((dateStr, col) => {
    if (!dateStr) {
      html += `<div class="cal-daycell cal-empty" style="grid-column:${col+1}; grid-row:1/-1"></div>`;
      return;
    }
    const day = Number(dateStr.slice(8, 10));
    const weekday = new Date(viewYear, viewMonth - 1, day).getDay();
    const holidayName = holidaysByDate[dateStr];
    const isHoliday = !!holidayName;
    html += `<div class="cal-daycell ${weekday===0?'cal-sun':''} ${weekday===6?'cal-sat':''} ${isHoliday?'cal-holiday':''}" style="grid-column:${col+1}; grid-row:1/-1" onclick="openAddModal('${dateStr}')">
      <div class="cal-daynum">${day}</div>
      ${isHoliday ? `<div class="cal-holiday-name">${holidayName}</div>` : ''}
    </div>`;
  });

  bars.forEach(bar => {
    const label = bar.item.employees ? bar.item.employees.name : '';
    const memberCount = bar.item.schedule_members ? bar.item.schedule_members.length : 0;
    const memberSuffix = memberCount > 0 ? ` +${memberCount}` : '';
    const timeSuffix = bar.item.start_time ? `<span class="cal-event-time">${bar.item.start_time.slice(0,5)}〜</span>` : '';
    const cls = [
      'cal-event-bar',
      `cal-type-${bar.item.type}`,
      bar.continuesFromPrev ? 'cal-bar-noleft' : '',
      bar.continuesToNext ? 'cal-bar-noright' : ''
    ].join(' ');
    html += `<div class="${cls}" style="grid-column:${bar.colStart+1} / ${bar.colEnd+2}; grid-row:${bar.slot+2};" onclick="openEventView(event, ${bar.item.id})" title="${bar.item.title || ''}"><span class="cal-event-label">${label}: ${bar.item.title || typeLabel[bar.item.type]}${memberSuffix}</span>${timeSuffix}</div>`;
  });

  html += '</div>';
  return html;
}

function toggleAllday() {
  const isAllday = document.getElementById('new-allday').checked;
  document.getElementById('time-fields').style.display = isAllday ? 'none' : 'block';
}

function renderMemberCheckboxes(checkedIds) {
  const container = document.getElementById('member-checkboxes');
  container.innerHTML = allEmployees
    .filter(e => e.id !== employee.id)
    .map(e => `
      <label style="display:flex; align-items:center; gap:8px; width:auto; margin:2px 0;">
        <input type="checkbox" value="${e.id}" style="width:auto; margin:0;" ${checkedIds.includes(e.id) ? 'checked' : ''}>
        ${e.name}
      </label>
    `).join('');
}

function getSelectedMemberIds() {
  const checkboxes = document.querySelectorAll('#member-checkboxes input[type=checkbox]:checked');
  return Array.from(checkboxes).map(cb => Number(cb.value));
}

function openAddModal(dateStr) {
  selectedDate = dateStr;
  selectedEvent = null;
  document.getElementById('modal-title').textContent = '予定を追加';
  document.getElementById('modal-date-label').textContent = dateStr;
  document.getElementById('event-view').style.display = 'none';
  document.getElementById('event-form').style.display = 'block';
  document.getElementById('new-title').value = '';
  document.getElementById('new-end-date').value = '';
  document.getElementById('new-allday').checked = true;
  document.getElementById('time-fields').style.display = 'none';
  document.getElementById('new-start').value = '';
  document.getElementById('new-end').value = '';
  renderMemberCheckboxes([]);
  document.getElementById('save-btn').textContent = '追加';
  document.getElementById('save-btn').onclick = addEvent;
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

  const memberNames = (item.schedule_members || []).map(m => m.employees ? m.employees.name : '').filter(Boolean);
  document.getElementById('view-members').textContent = memberNames.length > 0 ? 'メンバー: ' + memberNames.join('、') : '';

  const periodStr = item.end_date && item.end_date !== item.date ? `期間: ${item.date} 〜 ${item.end_date}` : '';
  document.getElementById('view-period').textContent = periodStr;

  const timeStr = (item.start_time && item.end_time) ? `時刻: ${item.start_time.slice(0,5)}〜${item.end_time.slice(0,5)}` : '終日';
  document.getElementById('view-time').textContent = timeStr;

  const canEdit = employee && (item.employee_id === employee.id || employee.is_admin);
  document.getElementById('view-edit-btn').style.display = canEdit ? 'block' : 'none';
  document.getElementById('view-delete-btn').style.display = canEdit ? 'block' : 'none';

  document.getElementById('modal-bg').style.display = 'flex';
}

function startEdit() {
  if (!selectedEvent) return;

  document.getElementById('modal-title').textContent = '予定を編集';
  document.getElementById('event-view').style.display = 'none';
  document.getElementById('event-form').style.display = 'block';

  document.getElementById('new-title').value = selectedEvent.title || '';
  document.getElementById('new-end-date').value = (selectedEvent.end_date && selectedEvent.end_date !== selectedEvent.date) ? selectedEvent.end_date : '';

  const isAllday = !(selectedEvent.start_time && selectedEvent.end_time);
  document.getElementById('new-allday').checked = isAllday;
  document.getElementById('time-fields').style.display = isAllday ? 'none' : 'block';
  document.getElementById('new-start').value = selectedEvent.start_time ? selectedEvent.start_time.slice(0,5) : '';
  document.getElementById('new-end').value = selectedEvent.end_time ? selectedEvent.end_time.slice(0,5) : '';

  const currentMemberIds = (selectedEvent.schedule_members || []).map(m => m.employee_id);
  renderMemberCheckboxes(currentMemberIds);

  document.getElementById('save-btn').textContent = '保存';
  document.getElementById('save-btn').onclick = updateEvent;
}

function closeModal() {
  document.getElementById('modal-bg').style.display = 'none';
}

function buildPayload() {
  const title = document.getElementById('new-title').value.trim();
  const endDateVal = document.getElementById('new-end-date').value;
  const isAllday = document.getElementById('new-allday').checked;
  const start = isAllday ? null : document.getElementById('new-start').value;
  const end = isAllday ? null : document.getElementById('new-end').value;

  if (!title) { alert('件名を入力してください'); return null; }

  return {
    title: title,
    end_date: endDateVal || null,
    start_time: start || null,
    end_time: end || null
  };
}

async function syncMembers(scheduleId) {
  const memberIds = getSelectedMemberIds();

  await supabaseClient.from('schedule_members').delete().eq('schedule_id', scheduleId);

  if (memberIds.length > 0) {
    const rows = memberIds.map(id => ({ schedule_id: scheduleId, employee_id: id }));
    await supabaseClient.from('schedule_members').insert(rows);
  }
}

async function addEvent() {
  const payload = buildPayload();
  if (!payload) return;

  const { data, error } = await supabaseClient.from('schedules').insert({
    employee_id: employee.id,
    date: selectedDate,
    type: 'event',
    ...payload
  }).select().single();

  if (error) { alert('エラー: ' + error.message); return; }

  await syncMembers(data.id);
  closeModal();
  loadSchedule();
}

async function updateEvent() {
  const payload = buildPayload();
  if (!payload) return;
  if (!selectedEvent) return;

  const { error } = await supabaseClient.from('schedules').update(payload).eq('id', selectedEvent.id);

  if (error) { alert('エラー: ' + error.message); return; }

  await syncMembers(selectedEvent.id);
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

init();
