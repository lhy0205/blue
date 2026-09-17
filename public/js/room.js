/* ============================================================================
 * 청사진 · 포리의 방 — 길 안내
 *
 * 방 안의 물건을 실제 화면으로 잇는다. 로그인·목표 확인은 room.html 의
 * 모듈 스크립트가 하고, 여기서는 '무엇을 누르면 어디로 가는가'만 맡는다.
 *   document.body.dataset.goal  'y' | 'n'
 * ========================================================================== */

const $ = (s) => document.querySelector(s);

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* need:'goal' 인 곳은 목표가 있어야 열린다 — 목표 없이 들어가면 빈 화면을
   보게 되고, 그건 고장으로 읽힌다. */
const SPOT = {
  policies: { href: './app.html#policies' },
  find:     { href: './app.html#step1' },
  credit:   { href: './app.html#credit',    need: 'goal', why: '신용 빌드업은 목표를 정한 뒤에 열려요.' },
  invest:   { href: './app.html#invest',    need: 'goal', why: '투자 비교는 목표를 정한 뒤에 열려요.' },
  history:  { href: './app.html#history',   need: 'goal', why: '히스토리는 목표를 정한 뒤에 쌓여요.' },
  goal:     { href: './index.html?new=1' },
};

function go(key) {
  const s = SPOT[key];
  if (!s) return;
  if (s.need === 'goal' && document.body.dataset.goal !== 'y') {
    toast(s.why + ' 포리를 눌러 알려주세요.');
    return;
  }
  location.href = s.href;
}

document.querySelectorAll('[data-go]').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.go)));

/* ── 책장 서랍 ─────────────────────────────────────────────── */
const burger = $('#burger');
const scrim = $('#scrim');

function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  burger.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
  if (open) {
    /* 열리자마자 첫 칸으로 초점을 옮긴다 — 키보드로도 쓸 수 있어야 한다 */
    const first = document.querySelector('.drawer a.srow');
    if (first) setTimeout(() => first.focus(), 60);
  }
}

burger.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
scrim.addEventListener('click', () => setNav(false));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
    setNav(false);
    burger.focus();
  }
});

/* 좁은 화면에서는 그림이 가로로 길다. 처음에 가운데(책상)가 보이게 둔다 —
   왼쪽 끝으로 열리면 벽만 보인다. */
const sc = document.querySelector('.scroller');
if (sc && sc.scrollWidth > sc.clientWidth) {
  sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) * 0.42;
}
