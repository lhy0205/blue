/* ============================================================================
 * 청사진 · 목표 자연어 파서
 *
 * 설계 원칙: LLM은 "이해·설명"만 담당하고 금액 계산은 코드가 한다.
 * 여기서는 규칙 기반으로 먼저 파싱하고, AI 키가 있을 때만 보정을 받는다.
 * (키가 없어도 서비스 전체가 동작해야 하므로 규칙 파서가 기본값이다.)
 * ========================================================================== */

export const GOAL_LABEL = {
  jeonse: '전세 독립',
  purchase: '내집 마련',
  wedding: '결혼 자금',
  fund: '목돈 만들기',
};

const UNIT = { '억': 1e8, '천만': 1e7, '백만': 1e6, '만': 1e4, '천': 1e3, '원': 1 };

/* "1억 5천만 원", "8,000만원", "600만 원" → 숫자 */
function evalMoney(expr) {
  let total = 0;
  const re = /(\d[\d,.]*)\s*(억|천만|백만|만|천|원)?/g;
  let m, matched = false;
  while ((m = re.exec(expr))) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(n)) continue;
    const u = m[2];
    if (!u && matched) continue;
    total += n * (UNIT[u] || 1);
    matched = true;
  }
  return Math.round(total);
}

const MONEY_RE = /((?:\d[\d,.]*\s*(?:억|천만|백만|만|천)\s*)+(?:원)?)/g;
const HAVE_RE = /(있|보유|모았|모은|자산|현재|지금|가지고)/;

export function parseGoal(text) {
  const raw = (text || '').trim();

  /* ---------- 목표 유형 ---------- */
  let goal_type = 'fund';
  if (/전세|독립|자취|보증금/.test(raw)) goal_type = 'jeonse';
  if (/아파트|매매|내집|집을?\s*사|주택\s*구입|분양/.test(raw)) goal_type = 'purchase';
  if (/결혼|신혼|웨딩/.test(raw)) goal_type = 'wedding';
  if (/월세/.test(raw) && !/전세/.test(raw)) goal_type = 'monthly_rent';

  /* ---------- 기간 ---------- */
  let target_months = null;
  const y = raw.match(/(\d+)\s*년/);
  const mo = raw.match(/(\d+)\s*개월/);
  if (y) target_months = parseInt(y[1], 10) * 12;
  if (mo) target_months = parseInt(mo[1], 10);

  /* ---------- 금액 (목표 / 현재자산 분리) ---------- */
  const amounts = [];
  let m;
  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(raw))) {
    const value = evalMoney(m[1]);
    if (!value) continue;
    /* 금액 뒤 12글자 안에 '있어/보유/자산' 류가 오면 현재 보유 자산으로 본다 */
    const after = raw.slice(m.index + m[1].length, m.index + m[1].length + 14);
    const before = raw.slice(Math.max(0, m.index - 10), m.index);
    amounts.push({ value, isHave: HAVE_RE.test(after) || /자산은?\s*$|현재\s*$|지금\s*$/.test(before) });
  }

  let target_amount = null, current_asset = null;
  const haves = amounts.filter((a) => a.isHave);
  const rest = amounts.filter((a) => !a.isHave);
  if (haves.length) current_asset = haves[0].value;
  if (rest.length) target_amount = Math.max(...rest.map((a) => a.value));
  /* 금액이 하나뿐인데 '있어'가 붙었으면 목표가 아니라 보유자산이다 */
  if (!target_amount && current_asset && amounts.length === 1) target_amount = null;
  /* 목표가 보유자산보다 작으면 뒤바뀐 것으로 보고 교정 */
  if (target_amount && current_asset && target_amount < current_asset) {
    [target_amount, current_asset] = [current_asset, target_amount];
  }

  /* ---------- 지역 ---------- */
  let region = null;
  const r = raw.match(/([가-힣]{2,4})\s*(구|시|군|도)\b/);
  if (r) region = r[0].replace(/\s/g, '');
  else if (/경기/.test(raw)) region = '경기도';
  else if (/서울/.test(raw)) region = '서울특별시';

  return {
    raw_input: raw,
    goal_type,
    target_amount,
    target_months,
    current_asset,
    region,
    confidence: {
      goal_type: /전세|아파트|결혼|목돈|독립|매매/.test(raw) ? 'high' : 'low',
      target_amount: target_amount ? 'high' : 'none',
      target_months: target_months ? 'high' : 'none',
    },
  };
}

/* ---------------------------------------------------------------------------
 * AI 보정 (선택) — /api/ai 가 있을 때만 동작.
 * 서버가 구조화된 JSON만 돌려주고, 금액 계산은 여전히 코드가 한다.
 * ------------------------------------------------------------------------- */
export async function enhanceWithAI(text, ruleResult) {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'parse_goal', text }),
    });
    if (!res.ok) return ruleResult;
    const ai = await res.json();
    /* 규칙 파서가 못 찾은 값만 AI 결과로 메운다 (AI가 기존 값을 덮어쓰지 않음) */
    return {
      ...ruleResult,
      goal_type: ruleResult.confidence.goal_type === 'high' ? ruleResult.goal_type : (ai.goal_type || ruleResult.goal_type),
      target_amount: ruleResult.target_amount ?? ai.target_amount ?? null,
      target_months: ruleResult.target_months ?? ai.target_months ?? null,
      current_asset: ruleResult.current_asset ?? ai.current_asset ?? null,
      region: ruleResult.region || ai.region || null,
      ai_used: true,
    };
  } catch {
    return ruleResult;
  }
}
