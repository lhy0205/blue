/* ============================================================================
 * 청사진 · 포리의 숲 — 메인 장면 제어
 *
 * 숲 그림 위의 핫스팟을 실제 화면으로 연결한다.
 * 목표 파싱·로그인·목표 생성은 index.html 의 모듈 스크립트가 그대로 갖고 있고,
 * 이 파일은 '어디를 누르면 어디로 가는가'만 맡는다.
 *
 * 로그인/목표 상태는 그쪽 스크립트가 body 에 적어둔다.
 *   document.body.dataset.auth  'in' | 'out'
 *   document.body.dataset.goal  'y'  | 'n'
 * ========================================================================== */

const $ = (s) => document.querySelector(s);

/* ============================== 토스트 ==================================== */
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============================== 목표 입력 ================================
   그림에는 입력란이 없다. 포리(또는 카피 영역)를 누르면 열린다. */
function openGoal() {
  const d = $('#goalDlg');
  if (!d) return;
  d.hidden = false;
  setTimeout(() => $('#q') && $('#q').focus(), 60);
}
function closeGoal() {
  const d = $('#goalDlg');
  if (d) d.hidden = true;
}

/* ============================== 길 안내 ==================================
   need:'goal'  — 목표가 있어야 열리는 곳
   say          — 이동 없이 한마디만 하는 곳 (장식이 아니라 반응이 있어야 한다)  */
const NEED_GOAL = '목표를 먼저 정해야 열려요. 포리를 눌러 알려주세요.';

/* 갈 곳이 있는 것만 누를 수 있다.
   비버·강아지·랜턴·장작처럼 갈 곳 없는 물건은 핫스팟을 아예 두지 않는다 —
   눌러지는 것처럼 보이는데 아무 일도 안 일어나면 고장으로 읽힌다. */
const SPOT = {
  login:  { href: './auth.html?mode=login' },
  signup: { href: './auth.html?mode=signup' },

  /* 내 목표 — 목표가 없으면 입력창을 열고, 있으면 대시보드로 */
  copy:   { goal: true,  say: '이루고 싶은 목표를 적어주세요.' },
  pori:   { goal: true,  href: './app.html#dashboard', need: 'goal' },

  /* 실행 로드맵 */
  dam:    { href: './app.html#step5', need: 'goal', why: '실행 로드맵은 ' + NEED_GOAL },

  /* 마이페이지 — 집 전체와 문이 같은 곳으로 간다. 집 안이 곧 포리의 방이다. */
  house:  { href: './room.html', need: 'goal', why: '내 정보는 ' + NEED_GOAL },
  door:   { href: './room.html', need: 'goal', why: '문을 열려면 ' + NEED_GOAL },

  /* 기능 설명 */
  puddle: { href: './features.html' },
};



function go(key) {
  const s = SPOT[key];
  if (!s) return;

  const authed = document.body.dataset.auth === 'in';
  const hasGoal = document.body.dataset.goal === 'y';

  /* 목표 입력을 여는 자리 — 이미 목표가 있으면 대시보드로 보낸다 */
  if (s.goal && !(authed && hasGoal)) { openGoal(); if (s.say) toast(s.say); return; }

  if (s.need === 'goal') {
    if (!authed) {
      /* 로그인 후 원래 누른 곳으로 돌아오게 기억해둔다 */
      try { sessionStorage.setItem('csj.afterAuth', s.href); } catch (e) { /* 사생활 모드 */ }
      toast('먼저 로그인이 필요해요.');
      setTimeout(() => { location.href = './auth.html?mode=login'; }, 700);
      return;
    }
    if (!hasGoal) { toast(s.why); openGoal(); return; }
  }

  if (s.href) { location.href = s.href; return; }
  if (s.say) toast(s.say);
}

document.querySelectorAll('.hotspot[data-key]').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.key)));

/* 좁은 화면용 목록도 같은 길을 쓴다 — 두 벌로 갈라지면 한쪽이 먼저 썩는다 */
document.querySelectorAll('[data-spot]').forEach((b) =>
  b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.spot); }));

/* ============================== 도구 ====================================== */
$('#toggleMap') && $('#toggleMap').addEventListener('click', () => {
  const on = document.body.classList.toggle('show-map');
  $('#toggleMap').textContent = on ? '클릭할 수 있는 곳 숨기기' : '클릭할 수 있는 곳 보기';
});

$('#goalOpen') && $('#goalOpen').addEventListener('click', openGoal);
$('#goalClose') && $('#goalClose').addEventListener('click', closeGoal);
$('#goalDlg') && $('#goalDlg').addEventListener('click', (e) => {
  if (e.target.id === 'goalDlg') closeGoal();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGoal(); });
