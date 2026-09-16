/* ============================================================================
 * Asset Service (AS)
 * Frontend facade for V4 instrument data and deterministic calculations.
 * Live market data can replace loadInstruments() without changing callers.
 * ========================================================================== */
import {
  compareV4Models,
  evaluateModelApplication,
  projectInstrument,
  marketInterestScore,
} from './calc.js';

const INSTRUMENTS_URL = './data/instruments.json';
let catalog = null;

export async function loadInstruments({ force = false } = {}) {
  if (catalog && !force) return catalog;
  const response = await fetch(INSTRUMENTS_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`상품 데이터 응답 ${response.status}`);
  const data = await response.json();
  catalog = data;
  return data;
}

export async function getInstruments({ category, ticker } = {}) {
  const data = await loadInstruments();
  return (data.instruments || []).filter((item) =>
    (!category || item.category === category) && (!ticker || item.ticker === ticker));
}

export async function getInstrument(ticker) {
  const items = await getInstruments({ ticker });
  return items[0] || null;
}

export async function compareModels(input) {
  return compareV4Models(input);
}

export async function checkModel(input) {
  return evaluateModelApplication(input);
}

export async function expectedReturn(ticker, input) {
  const instrument = await getInstrument(ticker);
  if (!instrument) return { available: false, reason: '상품을 찾을 수 없습니다.' };
  return { ticker, instrument, ...projectInstrument(instrument, input) };
}

export function scoreMarketInterest(input) {
  return marketInterestScore(input);
}

export const AS = Object.freeze({
  loadInstruments,
  getInstruments,
  getInstrument,
  compareModels,
  checkModel,
  expectedReturn,
  scoreMarketInterest,
});

export default AS;
