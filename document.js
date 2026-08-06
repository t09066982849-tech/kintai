const deptLabel = { civil: '土木部', accounting: '経理部' };
const approverLabel = { manager: '部長', director: '常務', president: '社長' };

function sealName(fullName) {
  if (!fullName) return '';
  return fullName.startsWith('伊豆倉') ? fullName : fullName.split(' ')[0].split('　')[0];
}

function seal(fullName, small) {
  if (!fullName) return '';
  return `<div class="${small ? 'seal-sm' : 'seal'}">${sealName(fullName)}</div>`;
}

async function loadDocument() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const content = document.getElementById('content');

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { content.innerHTML = 'ログインしてください。'; return; }

  const { data: req, error } = await supabaseClient
    .from('leave_requests')
    .select('*, employees!leave_requests_employee_id_fkey(name, department)')
    .eq('id', id)
    .single();

  if (error || !req) { content.innerHTML = '申請が見つかりません。'; return; }

  if (req.status !== 'approved') {
    content.innerHTML = '<p class="note">この申請はまだ全員の承認が完了していないため、書類を表示できません。</p>';
    return;
  }

  const approverIds = [req.manager_approved_by, req.director_approved_by, req.president_approved_by].filter(Boolean);
  const { data: approvers } = await supabaseClient.from('employees').select('id, name').in('id', approverIds);
  const nameById = {};
  (approvers || []).forEach(a => { nameById[a.id] = a.name; });

  const deptText = deptLabel[req.employees.department] || '';
  const managerLabel = req.employees.department === 'accounting' ? '経理部長' : '土木部長';

  const html = req.type === 'paid_leave'
    ? renderPaidLeave(req, nameById, deptText, managerLabel)
    : renderBusinessTrip(req, nameById, deptText, managerLabel);

  content.innerHTML = html + '<button class="print-btn" onclick="window.print()">印刷 / PDFとして保存</button>';
}

function approvalTable(req, nameById, managerLabel) {
  return `
  <table class="approval-table">
    <tr><th>社長</th><th>常務</th><th>${managerLabel}</th></tr>
    <tr>
      <td>${seal(nameById[req.president_approved_by])}</td>
      <td>${seal(nameById[req.director_approved_by])}</td>
      <td>${seal(nameById[req.manager_approved_by])}</td>
    </tr>
  </table>`;
}

function renderPaidLeave(req, nameById, deptText, managerLabel) {
  return `
    <div class="doc-title">有給休暇届</div>
    <p>株式会社伊豆倉組 様</p>
    ${approvalTable(req, nameById, managerLabel)}
    <table>
      <tr><th>所属</th><td>${deptText}</td></tr>
      <tr><th>氏名</th><td>${req.employees.name}</td></tr>
      <tr><th>期間</th><td>${req.start_date} より ${req.end_date} まで(${req.days}日間)</td></tr>
      <tr><th>事由</th><td>${req.reason || ''}</td></tr>
      <tr><th>連絡先</th><td>${req.contact_phone || ''}</td></tr>
    </table>
  `;
}

function renderBusinessTrip(req, nameById, deptText, managerLabel) {
  const zoneLabel = req.zone === 'outside' ? '道外' : '道内';
  const nights = req.hotel_needed ? Math.max(0, req.days - 1) : 0;
  return `
    <div class="doc-title">出張申請書</div>
    <div class="doc-header">
      <div class="doc-header-to">株式会社伊豆倉組 様</div>
      <div class="doc-header-seals">
        <div><div class="seal-label">${managerLabel}</div>${seal(nameById[req.manager_approved_by], true)}</div>
        <div><div class="seal-label">常務</div>${seal(nameById[req.director_approved_by], true)}</div>
        <div><div class="seal-label">社長</div>${seal(nameById[req.president_approved_by], true)}</div>
      </div>
    </div>
    <table class="multi-col">
      <tr><th>氏名</th><td>${req.employees.name}</td><th>所属</th><td>${deptText}</td></tr>
      <tr><th>期間</th><td>${req.start_date} 〜 ${req.end_date}(${req.days}日間)</td><th>行き先</th><td>${req.destination || ''}</td><th>用件</th><td>${req.reason || ''}</td></tr>
      <tr><th>交通機関</th><td>${req.transportation || ''}</td><th>宿泊</th><td>${req.hotel_needed ? '要' : '不要'}</td><th>区分</th><td>${zoneLabel}</td></tr>
      <tr><th>日当</th><td>${req.daily_allowance != null ? req.daily_allowance + '円 × ' + req.days + '日' : ''}</td><th>宿泊費</th><td>${req.hotel_needed && req.hotel_fee != null ? req.hotel_fee + '円 × ' + nights + '泊' : '-'}</td><th>合計金額</th><td>${req.total_amount != null ? req.total_amount + '円(概算)' : ''}</td></tr>
      <tr><th>連絡先</th><td colspan="5">${req.contact_phone || ''}</td></tr>
    </table>
  `;
}

loadDocument();
