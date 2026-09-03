/* ============================================================================
 * 청사진 · Financial Calculator
 * 금액 계산은 전부 여기서만 한다. LLM은 이 결과를 설명만 한다.
 * 모든 함수는 계산식(formula)을 함께 반환해서 화면에 근거를 그대로 노출한다.
 * ========================================================================== */

const man = (n) => Math.round(n / 10000).toLocaleString('ko-KR') + '만 원';
const eok = (n) => (n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 2) + '억 원';
export const money = (n) => (Math.abs(n) >= 100000000 ? eok(n) : man(n));

/* 주택 취득 시 부대비용 (취득세·중개보수·법무비 개략치) */
const ACQUISITION_COST_RATE = 0.035;

/* ---------------------------------------------------------------------------
 * 1. 청사진(Blueprint) : 목표 자금 구조
 *    goal            { target_amount, target_months, current_asset, goal_type }
 *    appliedPolicies resolveCombination() 결과 중 applied === true 인 항목
 * ------------------------------------------------------------------------- */
export function buildBlueprint(goal, appliedPolicies) {
  const on = appliedPolicies.filter((p) => p.applied);

  const sum = (role) => on
    .filter((p) => p.amount.role === role)
    .reduce((s, p) => s + p.amount.value, 0);

  const policyLoan    = sum('policy_loan');    // 정책금융 활용가능 예상액
  const policyBenefit = sum('policy_benefit'); // 정책혜택 예상액 (지원금)
  const govMatch      = sum('future_fund');    // 정부기여금 등 미래 예상자금

  const target       = goal.target_amount;
  const currentAsset = goal.current_asset || 0;

  /* 필요 자기자본 = 목표 - 정책대출 - 정책혜택 */
  const requiredEquity = Math.max(0, target - policyLoan - policyBenefit);
  /* 추가로 모아야 하는 금액 = 필요 자기자본 - 현재자산 - 정부기여금 */
  const additionalNeeded = Math.max(0, requiredEquity - currentAsset - govMatch);

  const months = goal.target_months || 1;
  const recommendedMonthly = Math.round(additionalNeeded / months / 1000) * 1000;

  /* 부대비용 (주택 구입 목표에만) */
  const acquisitionCost = goal.goal_type === 'purchase'
    ? Math.round(target * ACQUISITION_COST_RATE) : 0;

  return {
    target, currentAsset, policyLoan, policyBenefit, govMatch,
    requiredEquity, additionalNeeded, recommendedMonthly, acquisitionCost,
    /* 목표 대응 가능 자원 (설계서의 상위 개념) */
    totalResource: currentAsset + policyLoan + policyBenefit + govMatch,
    wallet: [
      { key: 'current',  label: '보유 금융자산',        value: currentAsset,  status: '확보 완료',  tone: 'green' },
      { key: 'loan',     label: '정책금융 활용가능 예상액', value: policyLoan,    status: '검토 가능',  tone: 'blue'  },
      { key: 'benefit',  label: '정책혜택 예상액',       value: policyBenefit, status: '신청 필요',  tone: 'blue'  },
      { key: 'future',   label: '미래 예상자금',         value: additionalNeeded + govMatch, status: '저축 예정', tone: 'navy' },
    ],
    formula: {
      requiredEquity: `목표 ${money(target)} − 정책대출 ${money(policyLoan)}` +
        (policyBenefit ? ` − 정책혜택 ${money(policyBenefit)}` : '') + ` = ${money(requiredEquity)}`,
      additionalNeeded: `필요 자기자본 ${money(requiredEquity)} − 보유 ${money(currentAsset)}` +
        (govMatch ? ` − 정부기여금 ${money(govMatch)}` : '') + ` = ${money(additionalNeeded)}`,
      monthly: `${money(additionalNeeded)} ÷ ${months}개월 ≈ 월 ${money(recommendedMonthly)}`,
    },
  };
}

/* ---------------------------------------------------------------------------
 * 2. 달성 가능성 판정
 *    설계서의 차별점: "듣고 싶은 답이 아니라 가능한 답"
 * ------------------------------------------------------------------------- */
export function feasibility(goal, bp, monthlySaving) {
  const months = goal.target_months || 1;
  const saved = (monthlySaving || 0) * months;
  const reachable = bp.currentAsset + bp.policyLoan + bp.policyBenefit + bp.govMatch + saved;
  const need = bp.target + bp.acquisitionCost;
  const shortfall = need - reachable;

  let level, label, message;
  if (shortfall <= 0) {
    level = 'ok'; label = '달성 가능권';
    message = `현재 계획으로 목표 시점에 ${money(Math.abs(shortfall))} 여유가 예상됩니다.`;
  } else if (shortfall <= need * 0.05) {
    level = 'tight'; label = '추가자금 필요';
    message = `약 ${money(shortfall)}이 부족합니다. 기간 또는 월 저축액을 조정하면 도달할 수 있습니다.`;
  } else {
    level = 'hard'; label = '현재 계획으로는 어려움';
    message = `약 ${money(shortfall)}이 부족합니다${bp.acquisitionCost ? ' (취득 부대비용 포함)' : ''}. 목표 금액이나 기간을 조정하는 대안이 필요합니다.`;
  }
  return {
    level, label, message, shortfall, reachable, need,
    formula: `${money(need)} − (보유 ${money(bp.currentAsset)} + 정책 ${money(bp.policyLoan + bp.policyBenefit)} + 저축 ${money(saved)}) = ${shortfall > 0 ? money(shortfall) + ' 부족' : money(-shortfall) + ' 여유'}`,
  };
}

/* ---------------------------------------------------------------------------
 * 3. What-if 시뮬레이션
 * ------------------------------------------------------------------------- */
export function simulate(bp, goal, monthlySaving) {
  const target = goal.target_months || 1;
  if (!monthlySaving || monthlySaving <= 0) {
    return { monthsNeeded: Infinity, gapMonths: Infinity, level: 'hard', label: '계산 불가', message: '월 저축액을 입력해 주세요.' };
  }
  const monthsNeeded = Math.ceil(bp.additionalNeeded / monthlySaving);
  const gap = monthsNeeded - target;

  let level, label, message;
  if (gap > 6)        { level = 'hard';  label = '지연';       message = `기존 목표보다 약 ${gap}개월 늦어집니다.`; }
  else if (gap > 0)   { level = 'tight'; label = '조정 필요';   message = `약 ${gap}개월 추가로 필요합니다.`; }
  else if (gap === 0) { level = 'ok';    label = '목표권';     message = '기존 목표 기간과 정확히 일치합니다.'; }
  else                { level = 'ok';    label = '조기 달성';   message = `기존 목표보다 약 ${Math.abs(gap)}개월 단축됩니다.`; }

  return {
    monthsNeeded, gapMonths: gap, level, label, message,
    formula: `${money(bp.additionalNeeded)} ÷ 월 ${money(monthlySaving)} = ${monthsNeeded}개월`,
  };
}

/* Plan A / Plan B 자동 산출 */
export function tradeoff(bp, goal, monthlySaving) {
  const sim = simulate(bp, goal, monthlySaving);
  return {
    A: {
      title: '기간을 지킨다',
      detail: `${goal.target_months}개월 목표를 유지하려면 월 ${money(bp.recommendedMonthly)}이 필요합니다.`,
      value: bp.recommendedMonthly,
      recommended: sim.gapMonths <= 0,
    },
    B: {
      title: '저축 부담을 낮춘다',
      detail: `월 ${money(monthlySaving)}을 유지하면 목표 시점이 ${sim.monthsNeeded}개월로 ${sim.gapMonths > 0 ? `약 ${sim.gapMonths}개월 연장` : '단축'}됩니다.`,
      value: sim.monthsNeeded,
      recommended: sim.gapMonths > 0,
    },
  };
}

/* ---------------------------------------------------------------------------
 * 4. 대시보드 진척률
 *    설계서 원칙에 따라 "승인 확률"이 아니라 두 축으로 분리해서 보여준다.
 *      savingProgress    실제 돈이 얼마나 모였는가
 *      readiness         실행에 필요한 준비가 얼마나 됐는가
 * ------------------------------------------------------------------------- */
export function progress(goal, bp, checklist) {
  const equityNeeded = Math.max(1, bp.requiredEquity);
  const savedNow = Math.min(bp.currentAsset, equityNeeded);
  const savingPct = Math.round((savedNow / equityNeeded) * 100);

  const total = checklist.length || 1;
  const done = checklist.filter((c) => c.is_done).length;
  const readinessPct = Math.round((done / total) * 100);

  const start = new Date(goal.started_on || Date.now());
  const dday = new Date(start);
  dday.setMonth(dday.getMonth() + (goal.target_months || 0));
  const daysLeft = Math.ceil((dday - new Date()) / 86400000);
  const elapsed = Math.max(0, (goal.target_months || 0) - Math.ceil(daysLeft / 30));

  return {
    savingPct, savedNow, equityNeeded,
    readinessPct, done, total,
    daysLeft, dday, elapsedMonths: elapsed,
    ddayLabel: daysLeft > 0 ? `D-${daysLeft}` : `D+${Math.abs(daysLeft)}`,
    /* 목표 저축 대비 실제 진도 (앞서가는지 뒤처지는지) */
    onTrack: savingPct >= Math.round((elapsed / Math.max(1, goal.target_months)) * 100),
    formula: `보유 ${money(savedNow)} ÷ 필요 자기자본 ${money(equityNeeded)} = ${savingPct}%`,
  };
}

/* 대출 월 납입액 — 참고 표시용
 * 전세자금대출은 만기일시상환(이자만 납부)이 일반적이고,
 * 주택구입자금대출은 원리금균등 분할상환이 일반적이다.
 * 둘을 같은 식으로 계산하면 전세대출 월 부담이 실제의 20배로 부풀려진다. */
export function monthlyPayment(principal, annualRate, years, type = 'amortizing') {
  if (!principal) return { value: 0, label: '', note: '' };
  if (type === 'interest_only') {
    return {
      value: Math.round((principal * annualRate) / 12),
      label: '월 이자',
      note: '만기일시상환 · 원금은 만기에 상환(보증금 반환으로 충당)',
    };
  }
  const r = annualRate / 12;
  const n = (years || 30) * 12;
  const value = r === 0 ? Math.round(principal / n) : Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
  return { value, label: '월 상환액', note: `원리금균등 ${years || 30}년 상환 기준` };
}
