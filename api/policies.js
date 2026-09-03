/* ============================================================================
 * 온통청년 청년정책 API 프록시
 *   GET /api/policies?lclsfNm=주거&zipCd=11440&pageSize=50
 *
 * 브라우저에서 직접 부를 수 없는 이유
 *   1) 인증키가 노출된다
 *   2) CORS 가 열려있지 않다
 * 그래서 서버에서만 호출하고, 화면이 쓰기 쉬운 형태로 정규화해서 내려준다.
 *
 * 중요: 이 API 는 "정책 목록·요건·신청정보·출처"를 공급할 뿐,
 *       자격 판정과 금액 계산은 프론트의 rules.js / calc.js 가 담당한다.
 *       (대출한도·보증금 비율 같은 금융 파라미터는 이 API 에 존재하지 않는다)
 * ========================================================================== */

const ENDPOINT = 'https://www.youthcenter.go.kr/go/ythip/getPlcy';

/* 온통청년 코드 → 우리 스키마 */
function normalize(item) {
  const s = (v) => (v == null || v === '' ? null : String(v).trim());
  const n = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[^\d]/g, '')) || null);

  return {
    plcy_no: s(item.plcyNo),
    name: s(item.plcyNm),
    explain: s(item.plcyExplnCn),
    support: s(item.plcySprtCn),
    keywords: s(item.plcyKywdNm) ? s(item.plcyKywdNm).split(',').map((x) => x.trim()) : [],
    lclsf: s(item.lclsfNm),
    mclsf: s(item.mclsfNm),
    provider: s(item.sprvsnInstCdNm) || s(item.operInstCdNm),
    operator: s(item.operInstCdNm),

    /* 판정에 쓰는 요건 */
    eligibility: {
      age: { min: n(item.sprtTrgtMinAge), max: n(item.sprtTrgtMaxAge), limited: item.sprtTrgtAgeLmtYn === 'Y' },
      income_cond_code: s(item.earnCndSeCd),
      income_min: n(item.earnMinAmt),
      income_max: n(item.earnMaxAmt),
      income_note: s(item.earnEtcCn),
      marriage_code: s(item.mrgSttsCd),
      job_codes: s(item.jobCd) ? s(item.jobCd).split(',') : [],
      school_codes: s(item.schoolCd) ? s(item.schoolCd).split(',') : [],
      major_codes: s(item.plcyMajorCd) ? s(item.plcyMajorCd).split(',') : [],
      sbiz_codes: s(item.sBizCd) ? s(item.sBizCd).split(',') : [],
      zip_cds: s(item.zipCd) ? s(item.zipCd).split(',') : [],
      extra_note: s(item.addAplyQlfcCndCn),
      exclude_note: s(item.ptcpPrpTrgtCn),
    },

    /* 신청 기간 → Ended / Conditional 판정 근거 */
    apply_period: {
      code: s(item.aplyPrdSeCd),          // 0057001 특정기간 / 0057002 상시 / 0057003 마감
      raw: s(item.aplyYmd),
      biz_start: s(item.bizPrdBgngYmd),
      biz_end: s(item.bizPrdEndYmd),
      biz_note: s(item.bizPrdEtcCn),
    },
    scale: {
      limited: item.sprtSclLmtYn === 'Y',
      count: n(item.sprtSclCnt),
      first_come: item.sprtArvlSeqYn === 'Y',
    },

    /* 실행 연결 */
    action: {
      apply_method: s(item.plcyAplyMthdCn),
      screening: s(item.srngMthdCn),
      apply_url: s(item.aplyUrlAddr),
      documents: s(item.sbmsnDcmntCn),
      etc: s(item.etcMttrCn),
    },

    /* 신뢰 레이어 */
    source: {
      name: s(item.sprvsnInstCdNm) || '온통청년',
      url: s(item.refUrlAddr1) || s(item.aplyUrlAddr) || 'https://www.youthcenter.go.kr',
      ref2: s(item.refUrlAddr2),
      based_on: s(item.lastMdfcnDt) || s(item.frstRegDt),
      api: 'youthcenter.go.kr/go/ythip/getPlcy',
    },
  };
}

export default async function handler(req, res) {
  const key = process.env.YOUTH_API_KEY;
  if (!key) {
    return res.status(503).json({
      error: 'no_api_key',
      message: '온통청년 인증키(YOUTH_API_KEY)가 설정되지 않았습니다. 정형 정책 DB(policies.json)로 동작합니다.',
    });
  }

  const q = new URLSearchParams({ apiKeyNm: key, rtnType: 'json', pageType: '1' });
  for (const k of ['pageNum', 'pageSize', 'plcyNo', 'plcyNm', 'plcyKywdNm', 'plcyExplnCn', 'zipCd', 'lclsfNm', 'mclsfNm']) {
    if (req.query[k]) q.set(k, req.query[k]);
  }
  if (!q.has('pageSize')) q.set('pageSize', '50');
  if (!q.has('pageNum')) q.set('pageNum', '1');

  try {
    const r = await fetch(`${ENDPOINT}?${q}`, { headers: { Accept: 'application/json' } });
    const text = await r.text();

    if (!r.ok) {
      let detail = text.slice(0, 300);
      try { detail = JSON.parse(text); } catch {}
      return res.status(r.status).json({ error: 'upstream_error', status: r.status, detail });
    }

    const json = JSON.parse(text);
    /* 응답 봉투 구조가 버전에 따라 다를 수 있어 방어적으로 꺼낸다 */
    const list = json?.result?.youthPolicyList || json?.youthPolicyList || json?.result?.list || [];
    const paging = json?.result?.pagging || json?.pagging || null;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({
      count: list.length,
      paging,
      fetched_at: new Date().toISOString(),
      policies: list.map(normalize),
    });
  } catch (e) {
    res.status(500).json({ error: 'proxy_failed', message: String(e.message || e) });
  }
}
