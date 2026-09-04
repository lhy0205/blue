/* ============================================================================
 * 청사진 · 부채 입력 폼 (공용)
 * 회원가입(auth.html)과 마이페이지(app.js)가 같은 폼을 쓴다.
 * 금액은 사용자가 "만 원" 단위로 입력하고, 저장은 원 단위로 한다.
 * ========================================================================== */
import { DEBT_LABEL } from './calc.js';

const KINDS = ['student', 'credit', 'card', 'mortgage', 'jeonse', 'other'];

function rowHTML(d = {}) {
  const kind = d.kind || 'student';
  return `<div class="debt-row" style="display:grid;grid-template-columns:1.1fr 1fr .8fr .9fr auto;gap:6px;align-items:end;margin-bottom:8px">
    <div><label style="font-size:11px;color:var(--muted);font-weight:700">종류</label>
      <select class="inp d-kind" style="padding:9px 10px">
        ${KINDS.map((k) => `<option value="${k}"${k === kind ? ' selected' : ''}>${DEBT_LABEL[k]}</option>`).join('')}
      </select></div>
    <div><label style="font-size:11px;color:var(--muted);font-weight:700">잔액 (만 원)</label>
      <input class="inp d-bal" type="number" min="0" step="10" style="padding:9px 10px"
        value="${d.balance != null ? Math.round(d.balance / 10000) : ''}" placeholder="400"></div>
    <div><label style="font-size:11px;color:var(--muted);font-weight:700">연 금리 (%)</label>
      <input class="inp d-rate" type="number" min="0" max="30" step="0.1" style="padding:9px 10px"
        value="${d.rate != null ? +(d.rate * 100).toFixed(2) : ''}" placeholder="1.7"></div>
    <div><label style="font-size:11px;color:var(--muted);font-weight:700">남은 개월</label>
      <input class="inp d-months" type="number" min="0" max="600" step="1" style="padding:9px 10px"
        value="${d.remaining_months || ''}" placeholder="비우면 이자만"></div>
    <button type="button" class="btn ghost d-del"
      style="padding:9px 12px;font-size:12px" title="삭제">삭제</button>
  </div>`;
}

/** 컨테이너에 부채 편집 UI를 그린다. */
export function renderDebtEditor(box, debts = []) {
  box.innerHTML = `
    <div class="debt-rows">${(debts || []).map(rowHTML).join('')}</div>
    <button type="button" class="btn ghost d-add" style="padding:8px 14px;font-size:12.5px">+ 부채 추가</button>
    <div style="font-size:11px;color:var(--muted2);margin-top:6px">
      학자금·신용대출 등 갚고 있는 대출을 넣으면 상환 계획을 함께 계산합니다.
      <b>남은 개월을 비우면</b> 만기일시(이자만 납부)로 계산합니다.</div>`;

  const rows = box.querySelector('.debt-rows');
  box.querySelector('.d-add').addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', rowHTML());
  });
  /* 삭제는 위임으로 — 나중에 추가된 행에도 걸리도록 */
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.d-del');
    if (btn) btn.closest('.debt-row').remove();
  });
}

/** 편집 UI에서 debts 배열을 읽어낸다. 잔액이 없거나 0인 행은 버린다. */
export function collectDebts(box) {
  return [...box.querySelectorAll('.debt-row')].map((r) => {
    const balance = Math.round(Number(r.querySelector('.d-bal').value || 0) * 10000);
    const rate = Number(r.querySelector('.d-rate').value || 0) / 100;
    const months = Number(r.querySelector('.d-months').value || 0);
    return {
      kind: r.querySelector('.d-kind').value,
      balance,
      rate: Math.max(0, Math.min(0.3, rate)),
      ...(months > 0 ? { remaining_months: months } : {}),
    };
  }).filter((d) => d.balance > 0);
}
