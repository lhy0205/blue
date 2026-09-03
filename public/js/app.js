/* ============================================================================
 * 청사진 · 메인 앱 컨트롤러
 * 해시 라우팅: #dashboard #step1 #step2 #step3 #step4 #step5 #history #policies #mypage
 * ========================================================================== */
import * as S from './store.js';
import { judgeAll, resolveCombination, filterByGoal, VERDICT, CODE, koreanAge } from './rules.js';
import { buildBlueprint, feasibility, simulate, tradeoff, progress, money, monthlyPayment } from './calc.js';
import * as FT from './fintox.js';
import { GOAL_LABEL } from './goalparse.js';
import { regionName } from './regions.js';

const $ = (s) => document.querySelector(s);
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('ko-KR');

const STEPS = [
  { id: 'step1', n: 'STEP 1', title: '받을 수 있는 정책 찾기', sub: '4단계 판정 결과에서 적용할 정책을 고릅니다' },
  { id: 'step2', n: 'STEP 2', title: '필요한 돈 계산하기', sub: '목표 금액과 부족분을 확인합니다' },
  { id: 'step3', n: 'STEP 3', title: '저축 계획 시뮬레이션', sub: '정책을 비교하고 최종 하나를 확정합니다' },
  { id: 'step4', n: 'STEP 4', title: '소비 습관 진단', sub: '결제 내역으로 저축 방해 요소를 찾습니다 · 상시 이용' },
  { id: 'step5', n: 'STEP 5', title: '실행 로드맵', sub: '신청 시점까지 할 일을 관리합니다' },
];

const state = {
  user: null, profile: null, goal: null, mode: 'local',
  policies: [], groups: {}, judged: [], selected: new Set(), finalId: null,
  txs: [], checklist: [],
};

/* ============================== 부트 ====================================== */
async function boot() {
  const { mode } = await S.initStore();
  state.mode = mode;
  state.user = await S.currentUser();
  if (!state.user) { location.replace('./auth.html?mode=login'); return; }

  state.profile = await S.getProfile();
  state.goal = await S.getActiveGoal();
  if (!state.goal) { location.replace('./index.html'); return; }

  const db = await (await fetch('./data/policies.json')).json();
  state.policies = db.policies;
  state.groups = db.exclusive_groups;
  state.meta = db.meta;

  const saved = await S.getGoalPolicies(state.goal.id);
  saved.forEach((r) => state.selected.add(r.policy_id));
  const fin = saved.find((r) => r.is_final);
  state.finalId = fin ? fin.policy_id : null;

  state.txs = await S.getTransactions();
  state.checklist = await S.getChecklist(state.goal.id);

  rejudge();
  $('#avatar').textContent = (state.profile.nickname || '?').slice(0, 1);
  $('#avatar').addEventListener('click', () => (location.hash = '#mypage'));
  $('#dbInfo').innerHTML =
    `${esc(state.profile.nickname)} · ${esc(GOAL_LABEL[state.goal.goal_type] || '목표')}` +
    ` <span class="chip" style="margin-left:6px">${mode === 'supabase' ? '계정 연동' : '로컬 저장'}</span>`;

  window.addEventListener('hashchange', route);
  route();
}

function rejudge() {
  const scoped = filterByGoal(state.policies, state.goal.goal_type);
  state.judged = judgeAll(scoped, state.profile, state.goal, new Date());
}

/* 현재 선택(또는 확정)된 정책으로 청사진 계산 */
function currentPlan() {
  const ids = state.finalId ? [state.finalId] : [...state.selected];
  const chosen = state.judged.filter((r) => ids.includes(r.policy_id));
  const comb = resolveCombination(chosen, state.groups);
  const bp = buildBlueprint(state.goal, comb.applied);
  return { comb, bp, chosen };
}

/* ============================== 라우팅 ==================================== */
const done = {
  get step1() { return state.selected.size > 0; },
  get step2() { return state.selected.size > 0; },
  get step3() { return !!state.finalId; },
};

function route() {
  const hash = (location.hash || '#dashboard').slice(1);
  renderGoalbar();
  renderSteps(hash);
  document.querySelectorAll('#gnb a').forEach((a) =>
    a.classList.toggle('on', a.getAttribute('href') === '#' + hash));

  const v = $('#view');
  v.innerHTML = '';
  ({
    dashboard: viewDashboard, step1: viewStep1, step2: viewStep2, step3: viewStep3,
    step4: viewStep4, step5: viewStep5, history: viewHistory, policies: viewPolicies, mypage: viewMypage,
  }[hash] || viewDashboard)(v);
  window.scrollTo(0, 0);
}

function renderSteps(active) {
  $('#steps').innerHTML = STEPS.map((s) => {
    const locked = (s.id === 'step2' && !done.step1) || (s.id === 'step3' && !done.step2) || (s.id === 'step5' && !done.step3);
    return `<button data-go="${s.id}" class="${active === s.id ? 'on' : ''}" ${locked ? 'disabled title="이전 단계를 먼저 완료해 주세요"' : ''}>
      <span class="n">${s.n}</span>${s.title}</button>`;
  }).join('');
  $('#steps').querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => (location.hash = '#' + b.dataset.go)));
}

function renderGoalbar() {
  const g = state.goal;
  $('#goalbar').innerHTML = `<div class="goalbar">
    <span>🎯 분석 목표: “${esc(g.raw_input || `${money(g.target_amount)} ${GOAL_LABEL[g.goal_type] || ''}`)}”</span>
    <a class="edit" href="./index.html">목표 바꾸기</a>
  </div>`;
}

/* =========================== 공통 조각 ==================================== */
const trustBar = () => `<div class="trust"><span class="t-fact">FACT</span><span class="t-calc">CALCULATION</span><span class="t-ai">AI ADVICE</span></div>`;

function sourceLine(src) {
  if (!src) return '';
  return `<div class="src">출처: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>
    · 기준일 ${esc(src.based_on)}${src.verified ? '' : ' · <b style="color:#b45309">검증 전</b>'}</div>`;
}

const disclaimer = `<div class="src" style="margin-top:14px">
  ※ 표시 금액은 <b>상품상 최대한도 기준 1차 자격검토 결과</b>이며 승인·확정 금액이 아닙니다.
  실제 금액은 신청 시점의 은행·보증기관·정책 기준에 따라 달라질 수 있습니다.</div>`;

/* ======================== STEP 1 · 정책 판정 ============================== */
function viewStep1(v) {
  const rows = state.judged.map((r) => {
    const on = state.selected.has(r.policy_id);
    const pick = ['eligible', 'conditional'].includes(r.verdict);
    return `<tr data-id="${r.policy_id}" class="${on ? 'sel' : ''} ${pick ? '' : 'off'}">
      <td>${pick ? `<input type="checkbox" ${on ? 'checked' : ''} data-ck="${r.policy_id}">` : ''}</td>
      <td><span class="badge ${VERDICT[r.verdict].tone}">${r.dot} ${r.label}</span></td>
      <td class="nm">${esc(r.policy.name)}${r.policy.is_policy ? '' : ' <span class="chip">민간</span>'}</td>
      <td style="color:var(--muted)">${esc(r.reason)}</td>
      <td class="amt">${r.amount.value ? money(r.amount.value) : '—'}</td>
    </tr>
    <tr class="detail hide" data-detail="${r.policy_id}"><td colspan="5" style="background:#f8fafc;padding:0">
      <div style="padding:16px 18px">
        <div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:10px">왜 이렇게 판정했나요?</div>
        <div class="grid2" style="gap:8px">${r.checks.filter((c) => c.status !== 'na').map(checkChip).join('')}</div>
        ${r.amount.formula ? `<div class="note" style="margin-top:12px">🧮 ${esc(r.amount.formula)}</div>` : ''}
        ${sourceLine(r.source)}
      </div></td></tr>`;
  }).join('');

  v.append(el(`<section class="card">
    <div class="card-h">
      <div><div class="card-t">STEP 1 · 받을 수 있는 정책 찾기</div></div>
      <button class="btn" id="doneSel">선택 완료</button>
    </div>
    <p class="card-sub">적용하고 싶은 정책을 <b>여러 개</b> 고를 수 있습니다. 행을 누르면 판정 근거가 펼쳐집니다.
      <span class="badge blue" style="margin-left:6px">신청 가능 · 조건부만 선택할 수 있습니다</span></p>
    <table class="wf">
      <thead><tr><th style="width:44px"></th><th style="width:110px">상태</th><th>정책명</th><th>판정 의미</th><th style="width:120px">예상 활용액</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div id="conflict"></div>
    ${disclaimer}
  </section>`));

  v.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.dataset.ck) return;
    const d = v.querySelector(`[data-detail="${tr.dataset.id}"]`);
    d.classList.toggle('hide');
  }));
  v.querySelectorAll('[data-ck]').forEach((c) => c.addEventListener('change', () => {
    c.checked ? state.selected.add(c.dataset.ck) : state.selected.delete(c.dataset.ck);
    c.closest('tr').classList.toggle('sel', c.checked);
    showConflicts();
  }));
  showConflicts();

  $('#doneSel').addEventListener('click', async () => {
    if (!state.selected.size) { alert('적용할 정책을 1개 이상 선택해 주세요.'); return; }
    const rows = state.judged.filter((r) => state.selected.has(r.policy_id))
      .map((r) => ({ policy_id: r.policy_id, verdict: r.verdict, applied_amount: r.amount.value, is_final: r.policy_id === state.finalId }));
    await S.setGoalPolicies(state.goal.id, rows);
    location.hash = '#step2';
  });

  function showConflicts() {
    const { comb } = currentPlan();
    $('#conflict').innerHTML = comb.conflicts.map((c) => `
      <div class="${c.level === 'exclusive' ? 'warn' : 'note'}" style="margin-top:12px">
        <b>${c.level === 'exclusive' ? '⚠️ 중복 수혜 불가' : '❓ 중복 확인 필요'} · ${esc(c.label)}</b><br>
        ${esc(c.reason)}<br>선택: ${c.members.map(esc).join(' / ')}<br>→ ${esc(c.resolution)}
      </div>`).join('');
  }
}

function checkChip(c) {
  const icon = { pass: '✅', fail: '❌', review: '⚠️', ended: '⛔', info: 'ℹ️' }[c.status] || '·';
  const color = { pass: 'var(--green-tx)', fail: 'var(--red-tx)', review: 'var(--yellow-tx)', ended: 'var(--slate-tx)' }[c.status] || 'var(--muted)';
  return `<div style="background:#fff;border:1px solid var(--bd);border-radius:8px;padding:9px 12px;font-size:12px">
    <span style="color:${color};font-weight:700">${icon} ${esc(c.label)}</span>
    ${c.fact ? `<div style="color:var(--muted2);font-size:11px;margin-top:3px">기준: ${esc(c.fact)}</div>` : ''}
    ${c.detail ? `<div style="color:var(--muted);font-size:11px;margin-top:2px">${esc(c.detail)}</div>` : ''}
  </div>`;
}

/* ======================== STEP 2 · 청사진 ================================= */
function viewStep2(v) {
  const { bp, comb } = currentPlan();
  const g = state.goal;
  const pct = (n) => Math.min(100, Math.round((n / Math.max(1, bp.target)) * 100));

  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">STEP 2 · 필요한 돈 계산하기</div>
      <span class="tag">${comb.applied.filter((a) => a.applied).map((a) => esc(a.policy.short_name)).join(' + ') || '선택 없음'}</span></div>

    <div class="grid4">
      <div class="stat"><div class="l">목표 금액</div><div class="v">${money(bp.target)}</div></div>
      <div class="stat"><div class="l">정책금융 활용가능 예상액</div><div class="v blue">${money(bp.policyLoan)}</div><div class="f">확정 아님 · 검토 가능</div></div>
      <div class="stat"><div class="l">목표 자기자본</div><div class="v">${money(bp.requiredEquity)}</div></div>
      <div class="stat"><div class="l">현재 보유 자산</div><div class="v green">${money(bp.currentAsset)}</div></div>
    </div>

    <div style="background:var(--slate-bg);border-radius:12px;padding:18px;margin-top:16px">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">목표 자금 구조 (Goal Funding Map)</div>
      ${[
        ['보유 금융자산 (확보 완료)', bp.currentAsset, 'var(--green)'],
        ['향후 저축 (필요 자기자본)', bp.additionalNeeded, 'var(--navy)'],
        ['정책금융 활용 예상', bp.policyLoan, 'var(--blue)'],
        ...(bp.policyBenefit ? [['정책혜택 예상액', bp.policyBenefit, 'var(--blue2)']] : []),
      ].map(([l, val, c]) => `<div style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px">
          <span>${l}</span><span>${money(val)}</span></div>
        <div class="bar"><i style="width:${pct(val)}%;background:${c}"></i></div>
      </div>`).join('')}
    </div>

    <div class="card" style="margin-top:16px;box-shadow:0 4px 16px rgba(37,99,235,.05);border-color:#e0e7ff">
      ${trustBar()}
      <div style="font-size:17px;font-weight:800;color:var(--navy);margin-bottom:8px">
        핵심 결론 · ${money(bp.target)}을 전부 현금으로 모을 필요는 없습니다.</div>
      <div style="font-size:14px;color:#334155;line-height:1.6">
        정책금융을 <b>${money(bp.policyLoan)}</b>으로 가정하면 필요한 자기자본은 <b>${money(bp.requiredEquity)}</b>입니다.
        현재 ${money(bp.currentAsset)}이 있으므로 <b>추가 ${money(bp.additionalNeeded)} · 월 약 ${num(bp.recommendedMonthly)}원</b>이 핵심 실행목표입니다.
      </div>
      <div class="note" style="margin-top:12px">
        🧮 ${esc(bp.formula.requiredEquity)}<br>🧮 ${esc(bp.formula.additionalNeeded)}<br>🧮 ${esc(bp.formula.monthly)}
      </div>
    </div>
    ${disclaimer}
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn ghost" id="back1">정책 다시 고르기</button>
      <button class="btn" id="go3" style="flex:1">확인했어요 · 시뮬레이션 해보기</button>
    </div>
  </section>`));

  $('#back1').addEventListener('click', () => (location.hash = '#step1'));
  $('#go3').addEventListener('click', () => (location.hash = '#step3'));
}

/* ======================== STEP 3 · 시뮬레이션 ============================= */
function viewStep3(v) {
  const g = state.goal;
  /* 비교 대상은 '대출' 정책만. 적금·지원금은 목표 자금을 대체하는 성격이 아니라
     함께 적용되는 항목이므로 아래에 따로 표시한다. */
  const picked = state.judged.filter((r) => state.selected.has(r.policy_id));
  const candidates = picked.filter((r) => r.policy.finance.type === 'loan');
  const companions = picked.filter((r) => r.policy.finance.type !== 'loan');
  let saving = g.monthly_saving || 0;

  const compare = candidates.map((r) => {
    const comb = resolveCombination([r], state.groups);
    const bp = buildBlueprint(g, comb.applied);
    const f = r.policy.finance || {};
    return { r, bp, rate: f.rate_min != null ? `${(f.rate_min * 100).toFixed(1)}~${(f.rate_max * 100).toFixed(1)}%` : '—',
      pay: f.type === 'loan'
        ? monthlyPayment(bp.policyLoan, (f.rate_min + f.rate_max) / 2, f.term_years, f.repay_type)
        : { value: 0 } };
  });

  if (!saving) saving = compare.length ? compare[0].bp.recommendedMonthly : 500000;

  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">STEP 3 · 저축 계획 시뮬레이션</div><span class="tag">실시간 계산</span></div>
    <p class="card-sub">고른 정책을 나란히 비교하고, 월 저축액을 바꿔가며 <b>최종으로 실행할 정책 하나</b>를 확정합니다.</p>

    <div class="grid2" id="cmp">${compare.map((c) => `
      <div class="card" style="box-shadow:none;cursor:pointer" data-pick="${c.r.policy_id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-size:15px;font-weight:800;color:var(--navy)">${esc(c.r.policy.short_name)}</div>
          <span class="badge ${VERDICT[c.r.verdict].tone}">${c.r.dot} ${c.r.label}</span>
        </div>
        <div class="grid3" style="margin-top:12px;gap:8px">
          <div class="stat" style="padding:11px"><div class="l">활용액</div><div class="v" style="font-size:15px">${money(c.bp.policyLoan || c.r.amount.value)}</div></div>
          <div class="stat" style="padding:11px"><div class="l">금리</div><div class="v" style="font-size:15px">${c.rate}</div></div>
          <div class="stat" style="padding:11px"><div class="l">필요 자기자본</div><div class="v" style="font-size:15px">${money(c.bp.requiredEquity)}</div></div>
        </div>
        ${c.pay.value ? `<div class="src">참고 · ${c.pay.label} 약 ${num(c.pay.value)}원 · ${esc(c.pay.note)} (평균금리 가정)</div>` : ''}
        <button class="btn sm full ${state.finalId === c.r.policy_id ? '' : 'ghost'}" style="margin-top:12px" data-final="${c.r.policy_id}">
          ${state.finalId === c.r.policy_id ? '✓ 확정됨' : '이 정책으로 확정'}</button>
      </div>`).join('') || '<div class="empty" style="grid-column:1/-1">STEP 1에서 대출 정책을 선택하면 여기서 비교할 수 있습니다.</div>'}</div>

    ${companions.length ? `<div class="note" style="margin-top:12px">
      🧩 함께 적용되는 정책: ${companions.map((c) => `${esc(c.policy.short_name)}(${c.amount.value ? money(c.amount.value) : '혜택형'})`).join(' · ')}
      <div style="font-size:11px;font-weight:500;margin-top:4px;opacity:.85">적금·지원금·할인은 대출과 성격이 달라 목표 자금에 합산됩니다. 위 비교는 대출 정책끼리만 합니다.</div>
    </div>` : ''}

    <div class="grid2" style="margin-top:20px;align-items:start">
      <div class="card" style="box-shadow:none">
        <div class="mini">WHAT-IF SIMULATOR</div>
        <div style="font-size:21px;font-weight:800;color:var(--navy);margin:6px 0 8px">월 저축액을 바꿔보세요</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:20px">목표를 포기하는 대신 어느 변수를 바꾸면 현실성이 높아지는지 계산합니다.</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>10만 원</span><span>300만 원</span></div>
        <input type="range" id="sl" min="100000" max="3000000" step="10000" value="${saving}" style="width:100%;accent-color:var(--blue);margin:6px 0 14px">
        <div class="stat" style="text-align:left"><div class="l">월 저축액</div><div class="v" style="font-size:30px" id="slv">${num(saving)}원</div></div>
        <div id="simres" style="margin-top:14px"></div>
      </div>
      <div id="plans"></div>
    </div>
    ${disclaimer}
  </section>`));

  const redraw = () => {
    const val = Number($('#sl').value);
    $('#slv').textContent = num(val) + '원';
    const { bp } = currentPlan();
    const sim = simulate(bp, g, val);
    const tone = { ok: 'green', tight: 'yellow', hard: 'red' }[sim.level];
    $('#simres').innerHTML = `<div class="${sim.level === 'ok' ? 'note' : 'warn'}">
      <b>${sim.label} · 약 ${sim.monthsNeeded}개월 필요</b><br>${esc(sim.message)}
      <div style="font-size:11px;opacity:.8;margin-top:6px">🧮 ${esc(sim.formula)}</div></div>`;
    const t = tradeoff(bp, g, val);
    const fe = feasibility(g, bp, val);
    $('#plans').innerHTML = `
      <div class="card" style="box-shadow:none">
        <div class="mini">GOAL TRADE-OFF</div>
        <div style="font-size:17px;font-weight:800;color:var(--navy);margin:4px 0 12px">Plan A / Plan B</div>
        <div class="grid2">
          ${[['A', t.A], ['B', t.B]].map(([k, p]) => `<div style="border:${p.recommended ? '2px solid var(--blue)' : '1px solid var(--bd)'};background:${p.recommended ? 'var(--sky)' : '#fff'};border-radius:12px;padding:14px">
            <div style="font-size:11px;font-weight:800;color:var(--blue)">Plan ${k}</div>
            <div style="font-size:14px;font-weight:800;color:var(--navy);margin:6px 0 4px">${esc(p.title)}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.5">${esc(p.detail)}</div></div>`).join('')}
        </div>
      </div>
      <div class="card" style="box-shadow:none;margin-top:14px">
        <div class="mini">FEASIBILITY</div>
        <div style="font-size:15px;font-weight:800;color:var(--navy);margin:6px 0 6px">${esc(fe.label)}</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6">${esc(fe.message)}</div>
        <div class="note" style="margin-top:10px">🧮 ${esc(fe.formula)}</div>
      </div>`;
  };

  $('#sl')?.addEventListener('input', redraw);
  $('#sl')?.addEventListener('change', async () => {
    const val = Number($('#sl').value);
    const { bp } = currentPlan();
    const sim = simulate(bp, g, val);
    await S.updateGoal(g.id, { monthly_saving: val });
    g.monthly_saving = val;
    await S.addSimulation(g.id, { monthly_saving: val, months_needed: sim.monthsNeeded, gap_months: sim.gapMonths, plan: sim.gapMonths > 0 ? 'B' : 'A' });
  });
  if (compare.length) redraw();

  v.querySelectorAll('[data-final]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    state.finalId = b.dataset.final;
    await S.finalizePolicy(g.id, state.finalId);
    await S.toggleChecklist(g.id, 'eligibility', true);
    state.checklist = await S.getChecklist(g.id);
    location.hash = '#step4';
  }));
}

/* ======================== STEP 4 · FinTox ================================= */
function viewStep4(v) {
  const g = state.goal;
  const target = g.monthly_saving || 0;

  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">STEP 4 · 소비 습관 진단</div><span class="tag">언제든 이용 가능</span></div>
    <p class="card-sub">결제 문자나 카드 이용내역을 붙여넣으면, 그 소비가 <b>목표 달성 시점에 주는 영향</b>을 계산합니다.
      감정이나 심리를 추측하지 않고 명시적 규칙으로만 채점합니다.</p>

    <div class="field">
      <label>결제 문자 붙여넣기 (여러 줄 가능)</label>
      <textarea class="inp" id="paste" rows="5" placeholder="[신한체크승인] 09/01 23:40 배달의민족 34,000원
01/14 18:12 치킨에 꼬치다(외대역점) 43,400원"></textarea>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" id="ana">분석하기</button>
      <button class="btn ghost" id="sample">샘플 내역 불러오기</button>
      ${state.txs.length ? `<button class="btn ghost" id="clear">내역 비우기</button>` : ''}
    </div>
    <div id="ftres" style="margin-top:20px"></div>
  </section>`));

  $('#sample').addEventListener('click', async () => {
    const txt = await (await fetch('./data/dummy_tx.txt')).text();
    $('#paste').value = txt.split('\n').slice(0, 40).join('\n');
  });
  $('#clear')?.addEventListener('click', () => { alert('로컬 모드에서는 브라우저 저장소를 비우면 초기화됩니다.'); });

  $('#ana').addEventListener('click', async () => {
    const parsed = FT.parseBulk($('#paste').value, new Date().getFullYear());
    if (!parsed.length) { alert('인식할 수 있는 결제 내역이 없습니다. 날짜·금액이 포함된 문자를 넣어 주세요.'); return; }
    await S.addTransactions(parsed);
    state.txs = await S.getTransactions();
    $('#paste').value = '';
    renderFT();
  });

  renderFT();

  function renderFT() {
    const box = $('#ftres');
    if (!state.txs.length) { box.innerHTML = '<div class="empty">아직 등록된 결제 내역이 없습니다.</div>'; return; }
    const hist = state.txs.map((t) => ({ ...t, hour: t.hour ?? new Date(t.occurred_at).getHours() }))
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    const latest = hist[0];
    const rest = hist.slice(1);
    const sc = FT.scoreTransaction(latest, { history: rest, monthlyTarget: target, monthlyBudget: monthlyBudget() });
    const rep = FT.monthlyReport(hist, { monthlyTarget: target });
    const verdictMap = Object.fromEntries(state.judged.map((r) => [r.policy_id, r.verdict]));
    const rx = FT.prescribe(rep, state.policies, verdictMap);
    const tone = { safe: 'green', watch: 'yellow', caution: 'red' }[sc.level];

    box.innerHTML = `
      <div class="card" style="box-shadow:none;background:var(--purple-bg);border-color:var(--purple-bd)">
        <div class="mini" style="color:var(--purple)">RISK INDEX · 최근 결제</div>
        <div style="display:flex;gap:22px;align-items:center;margin-top:12px;flex-wrap:wrap">
          <div style="width:86px;height:86px;border-radius:50%;border:6px solid var(--purple);display:grid;place-items:center;background:#fff">
            <div style="font-size:21px;font-weight:800;color:#6d28d9">${sc.score}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:-4px">/100</div>
          </div>
          <div style="flex:1;min-width:220px">
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              ${sc.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
            </div>
            <div style="font-size:17px;font-weight:800;color:#5b21b6">소비위험지수: ${esc(sc.levelLabel)}</div>
            <div style="font-size:13px;color:var(--muted);margin-top:4px">
              ${esc(latest.merchant_raw)} · ${num(latest.amount)}원</div>
          </div>
        </div>
        <div style="margin-top:14px;display:grid;gap:6px">
          ${sc.breakdown.map((b) => `<div style="display:flex;align-items:center;gap:10px;font-size:12px">
            <span style="width:104px;font-weight:700;color:var(--navy)">${esc(b.label)}</span>
            <div class="bar" style="flex:1;height:8px"><i style="width:${(b.point / b.max) * 100}%;background:var(--purple)"></i></div>
            <span style="width:56px;text-align:right;color:var(--muted)">${b.point}/${b.max}</span>
            <span style="flex:1.2;color:var(--muted2)">${esc(b.fact)}</span></div>`).join('')}
        </div>
        ${target ? `<div class="warn" style="margin-top:14px">이번 <b>${num(latest.amount)}원</b> 지출은 월 목표 저축액 ${num(target)}원의
          <b>약 ${sc.goalSharePct}%</b>입니다. 감정을 추정하지 않고 목표 저축과의 상대적 영향만 계산합니다.</div>` : ''}
      </div>

      <div class="card" style="box-shadow:none;margin-top:16px">
        <div class="mini">SMART PRESCRIPTION</div>
        <div style="font-size:17px;font-weight:800;color:var(--navy);margin:6px 0 4px">소비를 막기보다 실질지출을 낮춥니다</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:14px">총 절감 예상 <b style="color:var(--blue)">${num(rx.reduce((s, r) => s + r.saving, 0))}원</b></div>
        <div style="display:grid;gap:10px">
          ${rx.map((r) => `<div style="border:1px solid ${r.type === 'warning' ? '#fde68a' : 'var(--bd)'};background:${r.type === 'warning' ? '#fffbe3' : '#fff'};border-radius:12px;padding:14px 16px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
              <b style="font-size:14px;color:var(--navy)">${esc(r.title)}</b>
              ${r.saving ? `<span class="badge green">-${num(r.saving)}원</span>` : ''}</div>
            <div style="font-size:12.5px;color:var(--muted);line-height:1.6;margin-top:5px">${esc(r.body)}</div>
            <div class="src">근거: ${esc(r.basis)}</div></div>`).join('')}
        </div>
      </div>

      <div class="card" style="box-shadow:none;margin-top:16px">
        <div class="mini">MONTHLY REPORT</div>
        <div class="grid4" style="margin-top:10px">
          <div class="stat"><div class="l">등록 건수</div><div class="v">${rep.count}건</div></div>
          <div class="stat"><div class="l">총 지출</div><div class="v">${num(rep.total)}원</div></div>
          <div class="stat"><div class="l">야간(22~06시)</div><div class="v">${rep.night.pct}%</div><div class="f">${rep.night.count}건</div></div>
          <div class="stat"><div class="l">업종 미상</div><div class="v ${rep.unknownPct >= 20 ? 'red' : ''}">${rep.unknownPct}%</div><div class="f">${rep.unknownCount}건</div></div>
        </div>
        <div style="margin-top:16px;display:grid;gap:7px">
          ${rep.categories.slice(0, 8).map((c) => `<div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600"><span>${esc(c.cat)}</span><span>${num(c.amount)}원 · ${c.pct}%</span></div>
            <div class="bar" style="height:7px"><i style="width:${c.pct}%"></i></div></div>`).join('')}
        </div>
        ${rep.repeats.length ? `<div class="note" style="margin-top:14px">🔁 30일 내 3회 이상 반복: ${rep.repeats.slice(0, 6).map((r) => `${esc(r.name)}×${r.count}`).join(' · ')}</div>` : ''}
      </div>`;
  }

  function monthlyBudget() {
    const income = state.profile.annual_income / 12;
    return Math.max(300000, Math.round(income - (g.monthly_saving || 0)));
  }
}

/* ======================== STEP 5 · 실행 로드맵 ============================ */
function viewStep5(v) {
  const g = state.goal;
  const { bp } = currentPlan();
  const pr = progress(g, bp, state.checklist);
  const finalPolicy = state.policies.find((p) => p.policy_id === state.finalId);

  const months = g.target_months || 24;
  const nodes = [
    { d: `D-${months * 30}`, t: '목표 설정 및 저축 플랜 확정', s: 'done',
      p: `${finalPolicy ? finalPolicy.short_name + ' 기준 ' : ''}필요 자금 ${money(bp.additionalNeeded)} 저축 목표 설정 완료.` },
    { d: `D-${Math.round(months * 30 * 0.8)}`, t: '소비 진단 연동 및 월 저축 자동화', s: 'now',
      p: `월 ${num(g.monthly_saving || bp.recommendedMonthly)}원 저축을 지키기 위해 지출 누수를 상시 점검합니다.` },
    { d: `D-${Math.round(months * 30 * 0.4)}`, t: '정책 자격 사전 재검증', s: '',
      p: '무주택 요건과 소득·자산 변동 내역을 다시 확인하고 제출서류를 준비합니다.' },
    { d: 'D-DAY', t: '정책 실행 및 목표 달성', s: 'goal',
      p: `${GOAL_LABEL[g.goal_type] || '목표'} 완료.` },
  ];

  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">STEP 5 · 실행 로드맵</div><span class="tag">Financial Readiness</span></div>
    <p class="card-sub">신청 시점까지 필요한 준비를 하나의 로드맵으로 관리합니다.</p>

    <div class="card" style="box-shadow:none">
      <div class="mini">FINANCIAL READINESS</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin:8px 0 12px">
        <div style="font-size:21px;font-weight:800;color:var(--navy)">실행 준비도</div>
        <div style="font-size:27px;font-weight:800;color:var(--blue)">${pr.readinessPct}%</div>
      </div>
      <div class="bar lg"><i style="width:${pr.readinessPct}%"></i></div>
      <div style="display:grid;gap:9px;margin-top:18px" id="cl">
        ${state.checklist.map((c) => `<label class="check ${c.is_done ? 'on' : ''}" data-k="${c.item_key}">
          <input type="checkbox" ${c.is_done ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}
      </div>
      <div class="note" style="margin-top:14px">📌 <b>중요:</b> 준비도는 대출 승인확률이 아닙니다. 목표 실행에 필요한 정보·서류·행동의 완료율입니다.</div>
    </div>

    <div class="tl" style="margin-top:20px">
      ${nodes.map((n) => `<div class="node ${n.s}">
        <div class="dot">${esc(n.d)}</div>
        <div class="body"><h4>${esc(n.t)}</h4><p>${esc(n.p)}</p></div></div>`).join('')}
    </div>

    ${finalPolicy ? `<div class="card" style="margin-top:18px;box-shadow:none">
      <div class="mini">NEXT ACTION</div>
      <div style="font-size:16px;font-weight:800;color:var(--navy);margin:6px 0 8px">${esc(finalPolicy.name)} 신청 준비</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6">${esc(finalPolicy.finance.benefit_note || '')}</div>
      <a class="btn sm" style="margin-top:12px" href="${esc(finalPolicy.source.url)}" target="_blank" rel="noopener">공식 페이지에서 확인하기 →</a>
      ${sourceLine(finalPolicy.source)}
    </div>` : ''}

    <div style="background:var(--navy);color:#fff;border-radius:16px;padding:22px;margin-top:18px;text-align:center">
      <div style="font-size:11px;font-weight:800;color:var(--blue-bd2);letter-spacing:.5px">READY TO START</div>
      <div style="font-size:18px;font-weight:800;margin:6px 0 8px">${esc(GOAL_LABEL[g.goal_type] || '목표')} 플랜이 준비되었습니다</div>
      <div style="font-size:13px;color:#94a3b8;line-height:1.6">
        필요 자기자본 ${money(bp.requiredEquity)} 중 ${money(bp.currentAsset)}을 확보했고,
        남은 ${money(bp.additionalNeeded)}을 월 ${num(g.monthly_saving || bp.recommendedMonthly)}원씩 모으는 계획입니다.
      </div>
    </div>
  </section>`));

  v.querySelectorAll('#cl label').forEach((l) => l.addEventListener('click', async (e) => {
    e.preventDefault();
    const key = l.dataset.k;
    const item = state.checklist.find((c) => c.item_key === key);
    item.is_done = !item.is_done;
    await S.toggleChecklist(g.id, key, item.is_done);
    route();
  }));
}

/* ======================== 대시보드 ======================================== */
function viewDashboard(v) {
  const g = state.goal;
  const { bp } = currentPlan();
  const pr = progress(g, bp, state.checklist);
  const finalPolicy = state.policies.find((p) => p.policy_id === state.finalId);
  const sim = simulate(bp, g, g.monthly_saving || bp.recommendedMonthly);

  const next = !state.selected.size ? ['받을 수 있는 정책을 골라 주세요', '#step1']
    : !state.finalId ? ['시뮬레이션에서 실행할 정책을 확정해 주세요', '#step3']
    : state.checklist.some((c) => !c.is_done) ? ['실행 준비도 체크리스트를 완료해 주세요', '#step5']
    : ['소비 진단으로 저축 계획을 점검해 보세요', '#step4'];

  v.append(el(`<section class="card">
    <div class="card-h">
      <div><div class="mini">MY GOAL</div>
        <div class="card-t" style="margin-top:4px">${esc(GOAL_LABEL[g.goal_type] || '목표')} · ${money(g.target_amount)}</div></div>
      <div style="text-align:right"><div style="font-size:26px;font-weight:800;color:var(--navy)">${pr.ddayLabel}</div>
        <div style="font-size:11px;color:var(--muted)">목표 ${g.target_months}개월 · 남은 ${pr.daysLeft}일</div></div>
    </div>

    <div class="grid2" style="margin-top:6px">
      <div class="card" style="box-shadow:none">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <b style="font-size:14px;color:var(--navy)">자금 달성률</b>
          <span style="font-size:24px;font-weight:800;color:var(--blue)">${pr.savingPct}%</span></div>
        <div class="bar lg" style="margin:10px 0 8px"><i style="width:${pr.savingPct}%"></i></div>
        <div style="font-size:12px;color:var(--muted)">${money(pr.savedNow)} / 필요 자기자본 ${money(pr.equityNeeded)}</div>
        <div class="src">🧮 ${esc(pr.formula)}</div>
        <div class="${pr.onTrack ? 'note' : 'warn'}" style="margin-top:10px">
          ${pr.onTrack ? '✅ 계획대로 진행 중입니다.' : '⚠️ 목표 진도보다 뒤처져 있습니다. 시뮬레이션에서 월 저축액을 조정해 보세요.'}</div>
      </div>
      <div class="card" style="box-shadow:none">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <b style="font-size:14px;color:var(--navy)">실행 준비도</b>
          <span style="font-size:24px;font-weight:800;color:var(--navy)">${pr.readinessPct}%</span></div>
        <div class="bar lg" style="margin:10px 0 8px"><i style="width:${pr.readinessPct}%;background:var(--navy)"></i></div>
        <div style="font-size:12px;color:var(--muted)">체크리스트 ${pr.done}/${pr.total} 완료</div>
        <div class="src">준비도는 승인 확률이 아니라 준비 완료율입니다.</div>
        <a class="btn ghost sm" style="margin-top:10px" href="#step5">로드맵 열기</a>
      </div>
    </div>

    <div class="grid4" style="margin-top:16px">
      <div class="stat"><div class="l">적용 정책</div><div class="v" style="font-size:15px">${finalPolicy ? esc(finalPolicy.short_name) : '미확정'}</div></div>
      <div class="stat"><div class="l">정책금융 예상</div><div class="v blue" style="font-size:17px">${money(bp.policyLoan)}</div></div>
      <div class="stat"><div class="l">남은 필요 자금</div><div class="v" style="font-size:17px">${money(Math.max(0, bp.additionalNeeded - 0))}</div></div>
      <div class="stat"><div class="l">권장 월 저축</div><div class="v" style="font-size:17px">${num(g.monthly_saving || bp.recommendedMonthly)}원</div></div>
    </div>

    <div class="note" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span>👉 다음 할 일: ${esc(next[0])}</span>
      <a class="btn sm" href="${next[1]}">바로 가기</a>
    </div>
    ${sim.monthsNeeded !== Infinity ? `<div class="src">현재 저축 속도 기준 예상 소요 ${sim.monthsNeeded}개월 · ${esc(sim.message)}</div>` : ''}
  </section>`));

  if (state.txs.length) {
    const hist = state.txs.map((t) => ({ ...t, hour: t.hour ?? new Date(t.occurred_at).getHours() }));
    const rep = FT.monthlyReport(hist, { monthlyTarget: g.monthly_saving });
    v.append(el(`<section class="card">
      <div class="card-h"><div class="card-t" style="font-size:16px">소비 요약</div><a class="btn ghost sm" href="#step4">진단 열기</a></div>
      <div class="grid4">
        <div class="stat"><div class="l">등록 건수</div><div class="v" style="font-size:17px">${rep.count}건</div></div>
        <div class="stat"><div class="l">총 지출</div><div class="v" style="font-size:17px">${num(rep.total)}원</div></div>
        <div class="stat"><div class="l">최다 지출</div><div class="v" style="font-size:15px">${esc(rep.categories[0].cat)}</div><div class="f">${rep.categories[0].pct}%</div></div>
        <div class="stat"><div class="l">야간 결제</div><div class="v" style="font-size:17px">${rep.night.pct}%</div></div>
      </div>
    </section>`));
  }
}

/* ======================== 히스토리 / 정책 모아보기 / 마이페이지 ============ */
function viewHistory(v) {
  const hist = state.txs.slice(0, 60);
  v.append(el(`<section class="card">
    <div class="card-t">히스토리</div>
    <p class="card-sub">등록된 결제 내역과 목표 설정 이력입니다.</p>
    <div class="stat" style="text-align:left;margin-bottom:14px">
      <div class="l">목표 생성</div>
      <div class="v" style="font-size:14px">${esc(state.goal.raw_input || '-')}</div>
      <div class="f">${esc(state.goal.started_on)} · ${money(state.goal.target_amount)} / ${state.goal.target_months}개월</div>
    </div>
    ${hist.length ? `<table class="wf"><thead><tr><th>일시</th><th>가맹점</th><th>분류</th><th style="text-align:right">금액</th></tr></thead>
      <tbody>${hist.map((t) => `<tr><td>${new Date(t.occurred_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
        <td class="nm">${esc(t.merchant_raw)}</td>
        <td>${t.category === '업종 미상' ? `<span class="chip warn">${esc(t.category)}</span>` : esc(t.category)}</td>
        <td class="amt" style="text-align:right">${num(t.amount)}원</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">등록된 결제 내역이 없습니다.</div>'}
  </section>`));
}

function viewPolicies(v) {
  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">정책 모아보기</div>
      <span class="tag">${state.policies.length}개 · 기준일 ${esc(state.meta.based_on)}</span></div>
    <p class="card-sub">현재 프로필 기준 판정 결과입니다. 목표와 무관한 정책도 모두 보여줍니다.</p>
    <table class="wf"><thead><tr><th style="width:110px">상태</th><th>정책명</th><th>분류</th><th>기관</th><th>신청기간</th></tr></thead>
      <tbody>${judgeAll(state.policies, state.profile, state.goal, new Date()).map((r) => `<tr>
        <td><span class="badge ${VERDICT[r.verdict].tone}">${r.dot} ${r.label}</span></td>
        <td class="nm">${esc(r.policy.name)}</td>
        <td>${esc(r.policy.lclsf)} · ${esc(r.policy.mclsf)}</td>
        <td style="color:var(--muted)">${esc(r.policy.provider)}</td>
        <td style="color:var(--muted)">${esc(r.policy.apply_period.label)}</td></tr>`).join('')}</tbody></table>
    <div class="warn" style="margin-top:14px">${esc(state.meta.review_notice)}</div>
  </section>`));
}

function viewMypage(v) {
  const p = state.profile;
  const rows = [
    ['이름', p.nickname], ['만 나이', koreanAge(p.birth_ymd) + '세'],
    ['세전 연소득', money(p.annual_income)], ['순자산', p.net_asset != null ? money(p.net_asset) : '미입력'],
    ['취업 형태', CODE.job[p.job_code]], ['학력', CODE.school[p.school_code]],
    ['결혼 상태', CODE.marriage[p.marriage_code]],
    ['거주지', p.region_name || regionName(p.zip_cd)],
    ['주택 보유', p.is_homeowner ? '보유' : '무주택'],
    ['특화 요건', (p.sbiz_codes || []).map((c) => CODE.sbiz[c]).join(', ') || '없음'],
  ];
  v.append(el(`<section class="card">
    <div class="card-t">마이페이지</div>
    <p class="card-sub">여기 값이 바뀌면 정책 판정이 즉시 다시 계산됩니다.</p>
    <div class="grid2">${rows.map(([l, val]) => `<div class="stat" style="text-align:left">
      <div class="l">${l}</div><div class="v" style="font-size:15px">${esc(val)}</div></div>`).join('')}</div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn ghost" id="logout">로그아웃</button>
      <a class="btn ghost" href="./index.html">새 목표 설정</a>
    </div>
    <div class="src" style="margin-top:14px">저장 위치: ${state.mode === 'supabase' ? 'Supabase (계정 연동)' : '이 브라우저 (localStorage)'}</div>
  </section>`));
  $('#logout').addEventListener('click', async () => { await S.signOut(); location.href = './index.html'; });
}

boot();
