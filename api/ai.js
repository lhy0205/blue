/* ============================================================================
 * Claude 프록시 — LLM은 "이해와 설명"만 담당한다.
 *
 * 절대 하지 않는 것 (설계서 Trust Architecture)
 *   · 정책 자격을 확정하지 않는다
 *   · 금액·금리·한도를 스스로 계산하거나 만들어내지 않는다
 *   · 심리 상태를 확률로 단정하지 않는다
 * 계산 결과(JSON)를 입력으로 받아 문장으로 풀어주는 역할만 한다.
 * ========================================================================== */

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const SYSTEM = `당신은 한국 청년 정책금융 서비스 '청사진'의 설명 담당 AI입니다.

반드시 지킬 것:
1. 금액·금리·한도·자격 판정을 스스로 만들어내지 마세요. 입력으로 주어진 값만 사용합니다.
2. "승인", "확정", "100%", "보장" 같은 표현을 쓰지 마세요. "상품상 최대한도", "1차 자격검토 결과", "예상 가능범위"로 표현합니다.
3. 소비 내역을 근거로 사용자의 감정이나 심리 상태를 단정하지 마세요. ("스트레스성 소비 85%" 같은 표현 금지)
4. 투자 상품 수익률 비교나 투자 권유를 하지 마세요.
5. 존댓말로, 군더더기 없이 2~4문장으로 답하세요.`;

const TASKS = {
  /* 자연어 목표 → 구조화 (금액은 숫자(원)로만) */
  parse_goal: (p) => ({
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `아래 문장에서 재무 목표를 추출해 JSON만 출력하세요. 설명 금지.
형식: {"goal_type":"jeonse|purchase|wedding|fund|monthly_rent","target_amount":숫자(원)|null,"target_months":숫자|null,"current_asset":숫자(원)|null,"region":"문자열|null"}
문장: ${p.text}`,
    }],
  }),

  /* 계산 결과 설명 */
  explain_blueprint: (p) => ({
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `아래는 코드가 계산한 결과입니다. 숫자를 바꾸지 말고 그대로 인용해서, 사용자가 무엇을 해야 하는지 설명해 주세요.
${JSON.stringify(p.data, null, 2)}`,
    }],
  }),

  /* 정책 판정 사유 설명 */
  explain_verdict: (p) => ({
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `아래는 규칙 엔진의 정책 자격 판정 결과입니다. 왜 이런 판정이 나왔는지, 사용자가 다음에 무엇을 확인해야 하는지 설명해 주세요.
${JSON.stringify(p.data, null, 2)}`,
    }],
  }),

  /* 소비 진단 코멘트 */
  explain_fintox: (p) => ({
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `아래는 규칙 기반 소비 위험 점수와 그 근거입니다. 점수를 바꾸지 말고, 목표 저축에 어떤 영향이 있는지만 설명하세요.
감정 추정 금지. 대안은 함께 제공된 공공혜택 범위 안에서만 제안하세요.
${JSON.stringify(p.data, null, 2)}`,
    }],
  }),
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'no_api_key', message: 'ANTHROPIC_API_KEY 미설정 — 규칙 기반 결과만 사용합니다.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const build = TASKS[body.task];
  if (!build) return res.status(400).json({ error: 'unknown_task', allowed: Object.keys(TASKS) });

  const spec = build(body);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: spec.max_tokens, system: SYSTEM, messages: spec.messages }),
    });
    const json = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'upstream_error', detail: json });

    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();

    if (body.task === 'parse_goal') {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return res.status(200).json({});
      try { return res.status(200).json(JSON.parse(m[0])); }
      catch { return res.status(200).json({}); }
    }
    res.status(200).json({ text, model: MODEL });
  } catch (e) {
    res.status(500).json({ error: 'ai_failed', message: String(e.message || e) });
  }
}
