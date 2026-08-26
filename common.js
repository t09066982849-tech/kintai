const supabaseUrl = 'https://clymwlhxnkpwukuoblga.supabase.co';
const supabaseKey = 'sb_publishable_npAygzNwa6ERwIRUpHabHA_Djm_BFNu';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

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

// セッションが有効か確認する。切れていればログイン画面に戻す。
async function ensureSession() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    alert('ログインが切れました。もう一度ログインしてください。');
    location.reload();
    return false;
  }
  return true;
}

// ログイン確認 + 自分の従業員情報を取得する共通処理。
// 未ログインならログイン画面を表示してnullを返す。
async function requireEmployee() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    document.getElementById('login-box').style.display = 'block';
    return null;
  }

  const { data: emp } = await supabaseClient
    .from('employees')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();

  if (!emp.is_active) {
    await supabaseClient.auth.signOut();
    document.getElementById('login-box').style.display = 'block';
    document.getElementById('login-error').textContent = 'アカウントが無効化されています。管理者にお問い合わせください。';
    return null;
  }

  document.getElementById('login-box').style.display = 'none';
  document.getElementById('main-box').style.display = 'block';
  document.getElementById('welcome').textContent = emp.name + ' さん';

  const adminLink = document.getElementById('nav-admin-link');
  if (adminLink) adminLink.style.display = emp.is_admin ? 'inline-block' : 'none';

  return emp;
}
// 日本時間での「今日の日付」を文字列で返す(UTCではなくJSTで計算する)
function getJSTDateStr() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 出退勤時刻を、現場の所定時間(work_start/work_end)を基準に補正する。
// 早出・残業は最大1時間まで認め、それを超える分は所定時刻+-1時間で打ち切る。
// 遅刻・早上がりはそのまま(補正しない)。
// 勤務時間は現場ごとの休憩時間(break_minutes)を差し引いた実労働時間。
function computeDayMetrics(dateStr, clockIn, clockOut, workStart, workEnd, breakMinutes) {
  const startStr = (workStart || '07:00').slice(0, 5);
  const endStr = (workEnd || '17:00').slice(0, 5);
  const scheduledStart = new Date(dateStr + 'T' + startStr + ':00+09:00');
  const scheduledEnd = new Date(dateStr + 'T' + endStr + ':00+09:00');
  const earlyCap = new Date(scheduledStart.getTime() - 60 * 60000);
  const lateCap = new Date(scheduledEnd.getTime() + 60 * 60000);

  let adjustedIn = clockIn ? new Date(clockIn) : null;
  let adjustedOut = clockOut ? new Date(clockOut) : null;

  if (adjustedIn && adjustedIn < earlyCap) adjustedIn = earlyCap;
  if (adjustedOut && adjustedOut > lateCap) adjustedOut = lateCap;

  let workMinutes = null;
  let overtimeMinutes = 0;
  if (adjustedIn && adjustedOut) {
    const rawMinutes = Math.round((adjustedOut - adjustedIn) / 60000);
    workMinutes = Math.max(0, rawMinutes - (breakMinutes || 0));
    const scheduledMinutes = Math.round((scheduledEnd - scheduledStart) / 60000);
    overtimeMinutes = Math.max(0, rawMinutes - scheduledMinutes);
  }

  return { adjustedIn, adjustedOut, workMinutes, overtimeMinutes, scheduledStart, scheduledEnd, earlyCap, lateCap };
}

function formatMinutesJa(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}時間${m}分`;
}

function formatTimeJa(date) {
  if (!date) return '-';
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}
