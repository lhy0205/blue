/* ============================================================================
 * 청사진 · 메인 앱 컨트롤러
 * 해시 라우팅: #dashboard #step1 #step2 #step3 #step4 #step5 #history #policies #mypage
 * ========================================================================== */
import * as S from './store.js';
import { judgeAll, resolveCombination, filterByGoal, VERDICT, CODE, koreanAge } from './rules.js';
import { buildBlueprint, feasibility, simulate, tradeoff, progress, money, monthlyPayment, ddayFrom } from './calc.js';
import * as FT from './fintox.js';
import * as CR from './credit.js';
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
  /* 세션은 남아 있는데 프로필이 사라진 경우(저장소 초기화 등) — 로그인부터 다시 */
  if (!state.profile) { await S.signOut(); location.replace('./auth.html?mode=login'); return; }
  state.goal = await S.getActiveGoal();
  if (!state.goal) { location.replace('./index.html'); return; }

  const [db, mvno] = await Promise.all([
    (await fetch('./data/policies.json')).json(),
    (await fetch('./data/mvno.json')).json(),
  ]);
  state.policies = db.policies;
  state.groups = db.exclusive_groups;
  state.meta = db.meta;
  state.mvno = mvno;

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
    ` <span class="chip" style="margin-left:6px">${mode === 'supabase' ? '계정 연동' : '로컬 저장'}</span>` +
    ` <span class="chip" style="${S.aiEnabled() ? 'background:#ffedd5;color:#c2410c' : ''}">${S.aiEnabled() ? 'AI 연결됨' : 'AI 미연결'}</span>` +
    ` <span class="chip" style="${S.policyApiEnabled() ? 'background:#dcfce7;color:#15803d' : ''}">${S.policyApiEnabled() ? '정책 API' : '정책 DB'}</span>`;

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
    step4: viewStep4, step5: viewStep5, credit: viewCredit,
    history: viewHistory, policies: viewPolicies, mypage: viewMypage,
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
/* 신뢰 레이어 배지. AI가 실제로 동작할 때만 AI ADVICE 를 켠다.
   (키가 없는데 AI ADVICE 를 띄우면 화면이 거짓말을 하게 된다) */
const trustBar = () => `<div class="trust">
  <span class="t-fact">FACT</span><span class="t-calc">CALCULATION</span>
  ${S.aiEnabled() ? '<span class="t-ai">AI ADVICE</span>' : '<span class="chip">AI 미연결 · 규칙 기반</span>'}
</div>`;

/* ---------------------------------------------------------------------------
 * AI 설명 채우기
 *  · 규칙 기반 결과는 이미 화면에 있고, AI는 그 위에 "해석"만 얹는다.
 *  · 키가 없거나 실패해도 화면은 완결된 상태를 유지한다.
 *  · AI가 만든 문장에만 AI 배지를 붙여 출처를 구분한다.
 * ------------------------------------------------------------------------- */
async function fillAI(mountId, task, data) {
  const box = document.getElementById(mountId);
  if (!box) return;
  if (!S.aiEnabled()) {
    box.innerHTML = `<div class="src" style="margin-top:10px">AI 키가 설정되지 않아 규칙 기반 설명만 표시합니다.</div>`;
    return;
  }
  box.innerHTML = `<div class="src" style="margin-top:10px"><span class="spin"></span> AI가 결과를 해석하는 중…</div>`;
  try {
    const r = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, data }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.text) {
      const e = new Error(j.message || j.error || `서버 응답 ${r.status}`);
      e.hint = j.hint;
      throw e;
    }
    box.innerHTML = `<div class="card" style="box-shadow:none;margin-top:12px;background:#fffdf8;border-color:#ffedd5">
      <span class="chip" style="background:#ffedd5;color:#c2410c;font-weight:800">AI ADVICE</span>
      <div style="margin-top:9px;font-size:13.5px;color:var(--tx);line-height:1.7">${esc(j.text)}</div>
      <div class="src">계산·판정은 코드가 수행했고, 위 문장은 그 결과를 해석한 것입니다</div>
    </div>`;
  } catch (e) {
    box.innerHTML = `<div class="warn" style="margin-top:10px">
      <b>AI 해석을 불러오지 못했습니다.</b> 위 규칙 기반 판정과 계산은 그대로 유효합니다.
      <div style="font-size:11px;margin-top:6px;opacity:.9">사유: ${esc(String(e.message).slice(0, 240))}</div>
      ${e.hint ? `<div style="font-size:11px;margin-top:6px;font-weight:700">👉 ${esc(e.hint)}</div>` : ''}
    </div>`;
  }
}

function sourceLine(src) {
  if (!src) return '';
  return `<div class="src">출처: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>
    · 기준일 ${esc(src.based_on)}
    ${src.verified
      ? '· <b style="color:#15803d">원문 대조 완료</b>'
      : '· <b style="color:#b45309">검증 전 — 신청 전 원문 확인 필요</b>'}
    ${src.note ? `<div style="margin-top:3px">${esc(src.note)}</div>` : ''}</div>`;
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
        <button class="btn ghost sm" style="margin-top:10px" data-ai="${r.policy_id}">AI에게 이 판정 설명 듣기</button>
        <div id="ai-${r.policy_id}"></div>
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

  /* 판정 근거를 AI가 풀어서 설명 (요청할 때만 호출) */
  v.querySelectorAll('[data-ai]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = state.judged.find((x) => x.policy_id === b.dataset.ai);
    b.disabled = true;
    fillAI(`ai-${r.policy_id}`, 'explain_verdict', {
      정책명: r.policy.name, 판정: r.label, 사유: r.reason,
      예상활용액: r.amount.value, 계산식: r.amount.formula,
      조건별_검토결과: r.checks.filter((c) => c.status !== 'na')
        .map((c) => ({ 항목: c.label, 결과: c.status, 기준: c.fact, 내값: c.detail })),
      사용자상황: { 만나이: koreanAge(state.profile.birth_ymd), 연소득: state.profile.annual_income,
        거주지: state.profile.region_name, 무주택: !state.profile.is_homeowner },
    });
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
    <div id="aiBlueprint"></div>
    ${disclaimer}
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn ghost" id="back1">정책 다시 고르기</button>
      <button class="btn" id="go3" style="flex:1">확인했어요 · 시뮬레이션 해보기</button>
    </div>
  </section>`));

  $('#back1').addEventListener('click', () => (location.hash = '#step1'));
  $('#go3').addEventListener('click', () => (location.hash = '#step3'));

  /* 계산이 끝난 뒤 AI에게 "그래서 뭘 해야 하는지" 해석만 요청한다 */
  fillAI('aiBlueprint', 'explain_blueprint', {
    목표금액: bp.target, 정책금융_활용가능_예상액: bp.policyLoan,
    정책혜택_예상액: bp.policyBenefit, 필요_자기자본: bp.requiredEquity,
    현재_보유자산: bp.currentAsset, 추가로_모아야_하는_금액: bp.additionalNeeded,
    권장_월저축액: bp.recommendedMonthly, 목표기간_개월: g.target_months,
    적용정책: comb.applied.filter((a) => a.applied).map((a) => a.policy.name),
    계산식: bp.formula,
  });
}

/* ======================== STEP 3 · 시뮬레이션 ============================= */
function viewStep3(v) {
  const g = state.goal;
  const picked = [...state.selected];

  /* 탐색용 목표 금액 — 저장하지 않는다. 확정하려면 아래 버튼을 눌러야 한다. */
  let simTarget = state.simTarget || g.target_amount;
  let saving = g.monthly_saving || 0;

  /* 목표금액 / 월저축액을 바꿨을 때 전체를 다시 계산한다.
     목표금액이 바뀌면 정책 판정 자체가 달라진다(예: 주택가격 상한 조건). */
  function planFor(targetAmount, monthlySaving) {
    const gg = { ...g, target_amount: targetAmount };
    const judged = judgeAll(filterByGoal(state.policies, g.goal_type), state.profile, gg, new Date());
    const chosen = judged.filter((r) => picked.includes(r.policy_id));
    const comb = resolveCombination(chosen, state.groups);
    const bp = buildBlueprint(gg, comb.applied);
    const sim = simulate(bp, gg, monthlySaving);
    const fe = feasibility(gg, bp, monthlySaving);
    return {
      gg, judged, comb, bp, sim, fe,
      dday: ddayFrom(g.started_on, sim.monthsNeeded),
      targetDday: ddayFrom(g.started_on, g.target_months),
    };
  }

  const base = planFor(g.target_amount, saving || 1);
  if (!saving) saving = Math.max(100000, base.bp.recommendedMonthly);

  const step = g.target_amount >= 100000000 ? 10000000 : 1000000;
  const tMin = Math.max(step, Math.round(g.target_amount * 0.4 / step) * step);
  const tMax = Math.round(g.target_amount * 1.6 / step) * step;

  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">STEP 3 · 저축 계획 시뮬레이션</div><span class="tag">실시간 계산</span></div>
    <p class="card-sub">목표 금액과 월 저축액을 움직이면 <b>도달 시점(D-Day)과 정책 판정이 즉시 다시 계산됩니다.</b>
      비교해 보고 실행할 정책 하나를 확정하세요.</p>

    <div id="explore"></div>

    <div class="grid2" style="align-items:start;margin-top:4px">
      <div class="card" style="box-shadow:none">
        <div class="mini">WHAT-IF SIMULATOR</div>

        <div style="margin-top:14px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <label style="font-size:12px;font-weight:700;color:var(--muted)">목표 금액</label>
            <b id="tv" style="font-size:17px;color:var(--navy)">${money(simTarget)}</b>
          </div>
          <input type="range" id="tSl" min="${tMin}" max="${tMax}" step="${step}" value="${simTarget}"
            style="width:100%;accent-color:var(--navy);margin-top:6px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted2)">
            <span>${money(tMin)}</span><span>${money(tMax)}</span></div>
        </div>

        <div style="margin-top:18px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <label style="font-size:12px;font-weight:700;color:var(--muted)">월 저축액</label>
            <b id="sv" style="font-size:17px;color:var(--navy)">${num(saving)}원</b>
          </div>
          <input type="range" id="sSl" min="100000" max="3000000" step="10000" value="${saving}"
            style="width:100%;accent-color:var(--blue);margin-top:6px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted2)">
            <span>10만 원</span><span>300만 원</span></div>
        </div>

        <div id="ddayBox" style="margin-top:18px"></div>
        <div id="simres" style="margin-top:12px"></div>
      </div>

      <div id="rightCol"></div>
    </div>

    <div style="margin-top:20px">
      <div class="mini" style="margin-bottom:8px">정책별 비교 · 실행할 하나를 확정하세요</div>
      <div id="cmp" class="grid2"></div>
      <div id="companion"></div>
    </div>
    ${disclaimer}
  </section>`));

  /* ------------------------------ 렌더 ---------------------------------- */
  function redraw() {
    const cur = planFor(simTarget, saving);
    const changed = simTarget !== g.target_amount;

    $('#tv').textContent = money(simTarget);
    $('#sv').textContent = num(saving) + '원';

    $('#explore').innerHTML = changed ? `
      <div class="warn" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span>🔍 탐색 중 · 목표를 <b>${money(g.target_amount)} → ${money(simTarget)}</b>으로 가정하고 계산했습니다. 아직 저장되지 않았습니다.</span>
        <span style="display:flex;gap:8px">
          <button class="btn ghost sm" id="resetTarget">원래대로</button>
          <button class="btn sm" id="applyTarget">이 금액으로 목표 변경</button>
        </span>
      </div>` : '';

    /* D-Day — 목표 기간 기준과 저축 속도 기준을 나란히 */
    const gapDays = cur.dday.days - cur.targetDday.days;
    const tone = gapDays > 0 ? 'var(--red)' : gapDays < 0 ? 'var(--green)' : 'var(--blue)';
    $('#ddayBox').innerHTML = `
      <div class="stat" style="text-align:left;background:#fff;border-color:${tone}">
        <div class="l">예상 도달 시점 (현재 저축 속도 기준)</div>
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:4px">
          <div style="font-size:${cur.sim.ready ? 24 : 32}px;font-weight:800;color:${cur.sim.ready ? 'var(--green)' : tone}">
            ${cur.sim.ready ? '지금 실행 가능' : esc(cur.dday.label)}</div>
          <div style="font-size:12px;color:var(--muted)">
            ${cur.sim.ready ? '추가 저축 없이 목표 금액에 대응 가능' : `${esc(cur.dday.ymd)} · 약 ${cur.sim.monthsNeeded}개월`}</div>
        </div>
        <div class="f" style="margin-top:6px">
          목표 D-Day ${esc(cur.targetDday.label)} (${esc(cur.targetDday.ymd)}) 대비
          <b style="color:${cur.sim.ready ? 'var(--green)' : tone}">${cur.sim.ready
            ? `${cur.targetDday.days}일 앞당김`
            : gapDays === 0 ? '동일' : gapDays > 0 ? `${gapDays}일 지연` : `${Math.abs(gapDays)}일 단축`}</b>
        </div>
      </div>`;

    $('#simres').innerHTML = `<div class="${cur.sim.level === 'ok' ? 'note' : 'warn'}">
      <b>${esc(cur.sim.label)}</b> · ${esc(cur.sim.message)}
      <div style="font-size:11px;opacity:.85;margin-top:6px">🧮 ${esc(cur.sim.formula)}</div></div>`;

    /* 오른쪽: 달성 가능성 + Plan A/B + 판정 변화 */
    const t = tradeoff(cur.bp, cur.gg, saving);
    const diffs = cur.judged
      .map((r) => ({ r, was: (base.judged.find((b) => b.policy_id === r.policy_id) || {}).verdict }))
      .filter((d) => d.was && d.was !== d.r.verdict);

    $('#rightCol').innerHTML = `
      <div class="card" style="box-shadow:none">
        <div class="mini">FEASIBILITY</div>
        <div style="font-size:16px;font-weight:800;color:var(--navy);margin:6px 0 6px">${esc(cur.fe.label)}</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6">${esc(cur.fe.message)}</div>
        <div class="note" style="margin-top:10px">🧮 ${esc(cur.fe.formula)}</div>
      </div>
      <div class="card" style="box-shadow:none;margin-top:14px">
        <div class="mini">GOAL TRADE-OFF</div>
        <div style="font-size:17px;font-weight:800;color:var(--navy);margin:4px 0 12px">Plan A / Plan B</div>
        <div class="grid2">
          ${[['A', t.A], ['B', t.B]].map(([k, p]) => `<div style="border:${p.recommended ? '2px solid var(--blue)' : '1px solid var(--bd)'};background:${p.recommended ? 'var(--sky)' : '#fff'};border-radius:12px;padding:14px">
            <div style="font-size:11px;font-weight:800;color:var(--blue)">Plan ${k}</div>
            <div style="font-size:14px;font-weight:800;color:var(--navy);margin:6px 0 4px">${esc(p.title)}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.5">${esc(p.detail)}</div></div>`).join('')}
        </div>
      </div>
      ${diffs.length ? `<div class="card" style="box-shadow:none;margin-top:14px;background:var(--sky);border-color:var(--blue-bd)">
        <div class="mini">판정이 바뀌었습니다</div>
        <div style="display:grid;gap:7px;margin-top:8px">
          ${diffs.map((d) => `<div style="font-size:12.5px">
            <b>${esc(d.r.policy.short_name)}</b>
            <span class="badge ${VERDICT[d.was].tone}">${VERDICT[d.was].label}</span> →
            <span class="badge ${VERDICT[d.r.verdict].tone}">${d.r.dot} ${d.r.label}</span>
            <div style="color:var(--muted);margin-top:2px">${esc(d.r.reason)}</div></div>`).join('')}
        </div>
        <div class="src">목표 금액을 바꾸면 주택가격·보증금 상한 조건에 걸리는 정책이 달라집니다.</div>
      </div>` : ''}`;

    /* 정책 비교 카드 */
    const cand = cur.judged.filter((r) => picked.includes(r.policy_id) && r.policy.finance.type === 'loan');
    const comp = cur.judged.filter((r) => picked.includes(r.policy_id) && r.policy.finance.type !== 'loan');

    $('#cmp').innerHTML = cand.map((r) => {
      const one = resolveCombination([r], state.groups);
      const bp1 = buildBlueprint(cur.gg, one.applied);
      const f = r.policy.finance;
      const pay = monthlyPayment(bp1.policyLoan, (f.rate_min + f.rate_max) / 2, f.term_years, f.repay_type);
      return `<div class="card" style="box-shadow:none">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-size:15px;font-weight:800;color:var(--navy)">${esc(r.policy.short_name)}</div>
          <span class="badge ${VERDICT[r.verdict].tone}">${r.dot} ${r.label}</span>
        </div>
        <div class="grid3" style="margin-top:12px;gap:8px">
          <div class="stat" style="padding:11px"><div class="l">활용액</div><div class="v" style="font-size:15px">${money(bp1.policyLoan)}</div></div>
          <div class="stat" style="padding:11px"><div class="l">금리</div><div class="v" style="font-size:15px">${(f.rate_min * 100).toFixed(1)}~${(f.rate_max * 100).toFixed(1)}%</div></div>
          <div class="stat" style="padding:11px"><div class="l">필요 자기자본</div><div class="v" style="font-size:15px">${money(bp1.requiredEquity)}</div></div>
        </div>
        ${pay.value ? `<div class="src">참고 · ${esc(pay.label)} 약 ${num(pay.value)}원 · ${esc(pay.note)}</div>` : ''}
        <button class="btn sm full ${state.finalId === r.policy_id ? '' : 'ghost'}" style="margin-top:12px" data-final="${r.policy_id}">
          ${state.finalId === r.policy_id ? '✓ 확정됨' : '이 정책으로 확정'}</button>
      </div>`;
    }).join('') || '<div class="empty" style="grid-column:1/-1">STEP 1에서 대출 정책을 선택하면 여기서 비교할 수 있습니다.</div>';

    $('#companion').innerHTML = comp.length ? `<div class="note" style="margin-top:12px">
      🧩 함께 적용되는 정책: ${comp.map((c) => `${esc(c.policy.short_name)}(${c.amount.value ? money(c.amount.value) : '혜택형'})`).join(' · ')}
      <div style="font-size:11px;font-weight:500;margin-top:4px;opacity:.85">적금·지원금·할인은 대출과 성격이 달라 목표 자금에 합산됩니다. 위 비교는 대출 정책끼리만 합니다.</div>
    </div>` : '';

    bindDynamic();
  }

  /* 재렌더되는 영역의 이벤트 재바인딩 */
  function bindDynamic() {
    $('#applyTarget')?.addEventListener('click', async () => {
      await S.updateGoal(g.id, { target_amount: simTarget });
      g.target_amount = simTarget;
      state.simTarget = null;
      rejudge();
      route();
    });
    $('#resetTarget')?.addEventListener('click', () => {
      simTarget = g.target_amount;
      state.simTarget = null;
      $('#tSl').value = simTarget;
      redraw();
    });
    document.querySelectorAll('[data-final]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.finalId = b.dataset.final;
      await S.finalizePolicy(g.id, state.finalId);
      await S.toggleChecklist(g.id, 'eligibility', true);
      state.checklist = await S.getChecklist(g.id);
      location.hash = '#step4';
    }));
  }

  /* 슬라이더 — 드래그 중에는 화면만, 놓았을 때 저장 */
  $('#tSl').addEventListener('input', (e) => { simTarget = Number(e.target.value); state.simTarget = simTarget; redraw(); });
  $('#sSl').addEventListener('input', (e) => { saving = Number(e.target.value); redraw(); });
  $('#sSl').addEventListener('change', async () => {
    const cur = planFor(simTarget, saving);
    await S.updateGoal(g.id, { monthly_saving: saving });
    g.monthly_saving = saving;
    await S.addSimulation(g.id, {
      monthly_saving: saving, months_needed: cur.sim.monthsNeeded,
      gap_months: cur.sim.gapMonths, plan: cur.sim.gapMonths > 0 ? 'B' : 'A',
    });
  });

  redraw();
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

    <div class="note" style="margin-top:20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span>${state.finalId
        ? '↓ 최종 점검: STEP 5 실행 로드맵에서 준비도와 신청 일정을 확인하세요'
        : '먼저 STEP 3에서 실행할 정책을 확정하면 실행 로드맵이 열립니다'}</span>
      <a class="btn sm" href="${state.finalId ? '#step5' : '#step3'}">
        ${state.finalId ? 'STEP 5 실행 로드맵으로 →' : 'STEP 3으로 돌아가기 →'}</a>
    </div>
    <div class="src" style="margin-top:10px">
      통신비·보험료 같은 성실납부 실적이 있으면 <a href="#credit">신용 빌드업</a>에서 평가사 제출자료를 만들 수 있습니다.
    </div>
  </section>`));

  $('#sample').addEventListener('click', async () => {
    const txt = await (await fetch('./data/dummy_tx.txt')).text();
    $('#paste').value = txt.trim();   // 통신비·보험료 자동이체까지 포함해야 신용 빌드업이 동작한다
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
      </div>
      <div id="aiFintox"></div>`;

    fillAI('aiFintox', 'explain_fintox', {
      최근결제: { 가맹점: latest.merchant_raw, 금액: latest.amount, 분류: latest.category, 시각: `${latest.hour}시` },
      위험점수: sc.score, 판정: sc.levelLabel,
      월저축목표: target, 목표대비_비중_퍼센트: sc.goalSharePct,
      점수_산출근거: sc.breakdown.map((b) => ({ 항목: b.label, 점수: b.point, 만점: b.max, 근거: b.fact })),
      월간요약: { 총지출: rep.total, 야간비중: rep.night.pct, 업종미상비중: rep.unknownPct,
        상위카테고리: rep.categories.slice(0, 3).map((c) => ({ 분류: c.cat, 금액: c.amount, 비중: c.pct })) },
      제안가능한_공공혜택: rx.map((r) => ({ 제목: r.title, 절감예상: r.saving })),
    });
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
          <input type="checkbox" ${c.is_done ? 'checked' : ''}><span style="flex:1">${esc(c.label)}</span>
          <span class="badge ${c.is_done ? 'green' : 'gray'}">+${CR.XP_PER_QUEST}XP</span></label>`).join('')}
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
  const sim = simulate(bp, g, g.monthly_saving || bp.recommendedMonthly);
  const pr = progress(g, bp, state.checklist, sim.monthsNeeded);
  const finalPolicy = state.policies.find((p) => p.policy_id === state.finalId);

  const next = !state.selected.size ? ['받을 수 있는 정책을 골라 주세요', '#step1']
    : !state.finalId ? ['시뮬레이션에서 실행할 정책을 확정해 주세요', '#step3']
    : state.checklist.some((c) => !c.is_done) ? ['실행 준비도 체크리스트를 완료해 주세요', '#step5']
    : ['소비 진단으로 저축 계획을 점검해 보세요', '#step4'];

  v.append(el(`<section class="card">
    <div class="card-h">
      <div><div class="mini">MY GOAL</div>
        <div class="card-t" style="margin-top:4px">${esc(GOAL_LABEL[g.goal_type] || '목표')} · ${money(g.target_amount)}</div></div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:800;color:${sim.ready ? 'var(--green)' : pr.ddayGapDays > 0 ? 'var(--red)' : 'var(--navy)'}">
          ${sim.ready ? '지금 실행 가능' : (pr.projectedDday ? pr.projectedDday.label : pr.ddayLabel)}</div>
        <div style="font-size:11px;color:var(--muted)">
          ${sim.ready ? '추가 저축 불필요' : `예상 도달 · 목표 ${pr.ddayLabel} 대비
            ${pr.ddayGapDays === 0 ? '동일' : pr.ddayGapDays > 0 ? `${pr.ddayGapDays}일 지연` : `${Math.abs(pr.ddayGapDays)}일 단축`}`}
        </div>
      </div>
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

  /* 실행 등급 (XP) */
  const { xp } = creditState();
  v.append(el(`<section class="card">
    <div class="card-h" style="margin-bottom:8px">
      <div><div class="mini">EXECUTION LEVEL</div>
        <div style="font-size:19px;font-weight:800;color:${xp.tier.color};margin-top:4px">${esc(xp.tier.label)}</div></div>
      <div style="text-align:right">
        <div style="font-size:20px;font-weight:800;color:var(--navy)">${xp.earned} <span style="font-size:12px;color:var(--muted)">/ ${xp.total} XP</span></div>
        ${xp.nextTier ? `<div style="font-size:11px;color:var(--muted)">다음 등급 ‘${esc(xp.nextTier.label)}’까지 ${xp.toNext} XP</div>` : ''}
      </div>
    </div>
    <div class="bar lg"><i style="width:${xp.pct}%;background:${xp.tier.color}"></i></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap">
      <span class="src" style="margin:0">실행 준비도 기준 등급입니다. 신용점수·승인확률과 무관합니다.</span>
      <a class="btn ghost sm" href="#credit">신용 빌드업 열기</a>
    </div>
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

/* ======================== 신용 빌드업 ==================================== */
const flagKey = (k) => `csj.flag.${state.goal.id}.${k}`;
const getFlag = (k) => localStorage.getItem(flagKey(k)) === '1';
const setFlag = (k, v) => localStorage.setItem(flagKey(k), v ? '1' : '0');

function creditState() {
  const detected = CR.detectNonFinancial(state.txs);
  const xp = CR.computeXP(state.checklist, detected, getFlag('mvno'));
  return { detected, xp };
}

function viewCredit(v) {
  const { detected, xp } = creditState();
  const telecom = detected.find((d) => d.key === 'telecom');
  const script = CR.buildSubmissionScript(state.profile, detected);
  const tierKey = localStorage.getItem('csj.mvnoTier') || 'standard';
  const mv = telecom && telecom.found ? CR.matchMvno(telecom.avgAmount, state.mvno, tierKey) : null;

  v.append(el(`<section class="card">
    <div class="card-h"><div class="card-t">신용 빌드업</div><span class="tag">언제든 이용 가능</span></div>
    <p class="card-sub">이미 성실하게 내고 있는 통신비·보험료를 <b>금융이력으로 바꾸고</b>, 고정비 자체를 낮춥니다.
      금융 이력이 얇은 사회초년생에게 가장 빠른 지렛대입니다.</p>

    <!-- XP / 등급 -->
    <div class="card" style="box-shadow:none">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div class="mini">EXECUTION LEVEL</div>
          <div style="font-size:22px;font-weight:800;color:${xp.tier.color};margin-top:4px">
            ${esc(xp.tier.label)} <span style="font-size:13px;color:var(--muted);font-weight:600">${esc(xp.tier.desc)}</span></div>
        </div>
        <div style="text-align:right">
          <div style="font-size:26px;font-weight:800;color:var(--navy)">${xp.earned} <span style="font-size:14px;color:var(--muted)">/ ${xp.total} XP</span></div>
          ${xp.nextTier ? `<div style="font-size:11px;color:var(--muted)">다음 등급까지 ${xp.toNext} XP</div>` : '<div style="font-size:11px;color:var(--muted)">최고 등급</div>'}
        </div>
      </div>
      <div class="bar lg" style="margin-top:12px"><i style="width:${xp.pct}%;background:${xp.tier.color}"></i></div>
      <div style="display:grid;gap:7px;margin-top:14px">
        ${xp.quests.map((q) => `<div style="display:flex;align-items:center;gap:9px;font-size:12.5px;
          color:${q.done ? 'var(--blue)' : 'var(--muted)'}">
          <span>${q.done ? '✅' : '⬜'}</span><span style="flex:1">${esc(q.label)}</span>
          <span class="badge ${q.done ? 'green' : 'gray'}">+${q.xp}XP</span></div>`).join('')}
      </div>
      <div class="note" style="margin-top:14px">
        📌 이 등급은 <b>실행 준비도</b>입니다. 신용점수나 대출 승인확률과는 무관합니다.
      </div>
    </div>

    <!-- 비금융 신용 가점 -->
    <div class="card" style="box-shadow:none;margin-top:16px">
      <div class="mini">NON-FINANCIAL CREDIT</div>
      <div style="font-size:17px;font-weight:800;color:var(--navy);margin:6px 0 4px">비금융 납부실적 찾기</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:14px">
        통신요금·보험료·공과금·4대보험을 꾸준히 냈다면 신용평가사에 제출해 평가에 반영을 요청할 수 있습니다.
        등록된 결제내역에서 자동으로 찾아봤습니다.</div>

      <div style="display:grid;gap:9px">
        ${detected.map((d) => `<div style="border:1px solid ${d.found ? 'var(--blue-bd2)' : 'var(--bd)'};
          background:${d.found ? 'var(--sky)' : '#fff'};border-radius:11px;padding:13px 15px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <b style="font-size:14px;color:${d.found ? 'var(--blue)' : 'var(--muted)'}">${d.found ? '✅' : '⬜'} ${esc(d.label)}</b>
            ${d.found ? `<span class="badge blue">${d.months}개월 · 평균 ${num(d.avgAmount)}원</span>` : '<span class="chip">내역 없음</span>'}
          </div>
          ${d.found ? `<div style="font-size:12px;color:var(--muted);margin-top:5px">
            납부처 ${esc(d.provider)} · 최근 ${new Date(d.latest.occurred_at).toISOString().slice(0, 10)}</div>` : ''}
        </div>`).join('')}
      </div>

      ${script ? `
        <div style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <b style="font-size:13px;color:var(--navy)">제출용 자료 (복사해서 사용)</b>
            <button class="btn ghost sm" id="copyScript">복사하기</button>
          </div>
          <textarea class="inp" id="script" rows="11" readonly style="font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6">${esc(script)}</textarea>
        </div>
        <div class="grid2" style="margin-top:12px">
          ${CR.BUREAUS.map((b) => `<a class="btn ghost sm" href="${esc(b.url)}" target="_blank" rel="noopener"
            style="flex-direction:column;align-items:flex-start;gap:3px;padding:13px 15px;text-align:left">
            <b style="font-size:13px">${esc(b.name)} →</b>
            <span style="font-size:11px;color:var(--muted);font-weight:500">${esc(b.note)}</span></a>`).join('')}
        </div>
        <div class="warn" style="margin-top:12px">
          실제 제출에는 통신사·보험사·공단이 발급한 <b>납부확인서 원본</b>이 필요합니다.
          가점 반영 여부와 폭은 평가사 내부 기준에 따라 달라지므로, 점수 상승을 보장하지 않습니다.
        </div>`
      : `<div class="warn" style="margin-top:14px">
          아직 찾은 납부실적이 없습니다. <a href="#step4" style="color:inherit;text-decoration:underline">STEP 4 소비 습관 진단</a>에서
          통신비·보험료가 포함된 결제내역을 등록하면 자동으로 인식합니다.</div>`}
    </div>

    <!-- 알뜰폰 -->
    <div class="card" style="box-shadow:none;margin-top:16px">
      <div class="mini">MVNO MATCHING</div>
      <div style="font-size:17px;font-weight:800;color:var(--navy);margin:6px 0 4px">청년 알뜰폰 요금제 매칭</div>
      ${mv ? `
        <div style="font-size:13px;color:var(--muted);margin-bottom:14px">
          통신비를 낮추면 <b>월 저축액이 그만큼 늘어납니다.</b> 목표 달성 시점에 직접 영향을 줍니다.</div>
        <div class="field" style="max-width:280px">
          <label>필요한 데이터 구간</label>
          <select class="inp" id="mvnoTier">
            ${state.mvno.tiers.map((t) => `<option value="${t.key}" ${t.key === tierKey ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="grid3">
          <div class="stat"><div class="l">현재 통신비</div><div class="v" style="font-size:17px">${num(mv.current)}원</div></div>
          <div class="stat"><div class="l">${esc(mv.tier.label)} 예상</div><div class="v blue" style="font-size:17px">${num(mv.tier.price_min)}~${num(mv.tier.price_max)}원</div></div>
          <div class="stat"><div class="l">연간 절감</div><div class="v green" style="font-size:17px">${num(mv.saveYear)}원</div></div>
        </div>
        <div class="note" style="margin-top:12px">🧮 ${esc(mv.formula)}</div>
        ${mv.worthIt ? `
          <div class="card" style="box-shadow:none;margin-top:12px;background:var(--sky);border-color:var(--blue-bd)">
            <div style="font-size:13px;color:var(--navy);line-height:1.6">
              월 <b>${num(mv.saveMin)}원</b>을 아끼면 목표 월 저축액 ${num(state.goal.monthly_saving || 0)}원의
              <b>${state.goal.monthly_saving ? Math.round(mv.saveMin / state.goal.monthly_saving * 100) : 0}%</b>를 통신비 하나로 채웁니다.</div>
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
              <a class="btn sm" href="${esc(mv.source.url)}" target="_blank" rel="noopener">요금제 찾아보기 →</a>
              <button class="btn ghost sm" id="mvnoDone">${getFlag('mvno') ? '✓ 확인함 (+20XP)' : '절감안 확인 완료 (+20XP)'}</button>
            </div>
          </div>` : `<div class="note" style="margin-top:12px">현재 요금이 이미 낮은 편이라 전환 실익이 크지 않습니다.</div>`}
        <div class="warn" style="margin-top:12px">${esc(mv.notice)}</div>
        <div class="src">출처: <a href="${esc(mv.source.url)}" target="_blank" rel="noopener">${esc(mv.source.name)}</a>
          · 기준일 ${esc(mv.source.based_on)}
          ${mv.source.verified ? '· <b style="color:#15803d">시세 대조 완료</b>' : '· <b style="color:#b45309">검증 전</b>'}</div>`
      : `<div class="warn" style="margin-top:10px">통신비 결제내역이 없어 비교할 수 없습니다.
          STEP 4에서 통신요금 자동이체 내역을 등록해 주세요.</div>`}
    </div>
  </section>`));

  $('#copyScript')?.addEventListener('click', async () => {
    const ta = $('#script');
    ta.select();
    try { await navigator.clipboard.writeText(ta.value); $('#copyScript').textContent = '✓ 복사됨'; }
    catch { document.execCommand('copy'); $('#copyScript').textContent = '✓ 복사됨'; }
  });
  $('#mvnoTier')?.addEventListener('change', (e) => {
    localStorage.setItem('csj.mvnoTier', e.target.value);
    route();
  });
  $('#mvnoDone')?.addEventListener('click', () => { setFlag('mvno', !getFlag('mvno')); route(); });
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
