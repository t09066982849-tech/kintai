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

  document.getElementById('login-box').style.display = 'none';
  document.getElementById('main-box').style.display = 'block';
  document.getElementById('welcome').textContent = emp.name + ' さん';

  return emp;
}
// 日本時間での「今日の日付」を文字列で返す(UTCではなくJSTで計算する)
function getJSTDateStr() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
