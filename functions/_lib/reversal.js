// ── Reversal Signal detection ────────────────────────────────────────
// ต่างจาก Trend Score (บอกทิศทางที่กำลังเป็นอยู่) — โมดูลนี้หาสัญญาณว่า
// "แนวโน้มขาลงอาจกำลังจะจบ" ก่อนที่ Trend Score จะพลิกเป็นบวกด้วยซ้ำ:
//   1) Bullish RSI Divergence — ราคาทำจุดต่ำใหม่ แต่ RSI ไม่ทำจุดต่ำใหม่ตาม
//   2) Volume Exhaustion — วอลุ่มขาลงเริ่มเบาลงเรื่อยๆ แล้ววันนี้เขียว+วอลุ่มพุ่ง
//   3) Hammer / Bullish Engulfing — รูปแบบแท่งเทียนกลับตัวคลาสสิก
// ใช้ได้กับทุก timeframe (day/week/month) เพราะรับแค่ array ของราคา ไม่สนใจว่าแท่งคือวันไหน
import { rsiFull, trendScoreSeries } from './technicals.js';

export function findPivotIndices(values, window = 3, mode = 'low') {
  const idxs = [];
  for (let i = window; i < values.length - window; i++) {
    const slice = values.slice(i - window, i + window + 1);
    const val = values[i];
    if (mode === 'low' && val === Math.min(...slice)) idxs.push(i);
    if (mode === 'high' && val === Math.max(...slice)) idxs.push(i);
  }
  return idxs;
}

// เทียบ pivot low ล่าสุด 2 จุดภายใน lookback: ราคาต่ำลง (LL) แต่ RSI สูงขึ้น (HL) = divergence ขาขึ้น
export function detectBullishDivergence(closes, rsiSeries, window = 3, lookback = 60) {
  const n = closes.length;
  const start = Math.max(0, n - lookback);
  const lowIdxs = findPivotIndices(closes.slice(start), window, 'low').map(i => i + start);
  const validLows = lowIdxs.filter(i => rsiSeries[i] != null);
  if (validLows.length < 2) return null;

  const last = validLows[validLows.length - 1];
  const prev = validLows[validLows.length - 2];
  const priceLL = closes[last] < closes[prev];
  const rsiHL = rsiSeries[last] > rsiSeries[prev];
  if (!(priceLL && rsiHL)) return null;

  return {
    type: 'bullish_divergence',
    priorIdx: prev, priorPrice: +closes[prev].toFixed(4), priorRsi: +rsiSeries[prev].toFixed(1),
    recentIdx: last, recentPrice: +closes[last].toFixed(4), recentRsi: +rsiSeries[last].toFixed(1),
  };
}

// แท่งขาลงติดกัน (close<open) วอลุ่มมีแนวโน้มลดลง แล้ววันล่าสุดเป็นแท่งเขียว+วอลุ่มพุ่ง (>1.3x เฉลี่ยแท่งแดง)
export function detectVolumeExhaustion(opens, closes, volumes, maxDownDays = 5, spikeMultiplier = 1.3) {
  const n = closes.length;
  if (n < 4) return null;
  const i = n - 1;
  const isGreenToday = closes[i] > opens[i];
  if (!isGreenToday) return null;

  const downVols = [];
  for (let j = i - 1; j >= 0 && downVols.length < maxDownDays; j--) {
    if (closes[j] < opens[j]) downVols.push(volumes[j]);
    else break; // หยุดที่แท่งเขียวแรกที่เจอ (ต้องเป็นขาลงติดต่อกันจริง)
  }
  if (downVols.length < 3) return null; // ต้องมีขาลงต่อเนื่องอย่างน้อย 3 แท่งถึงจะนับ pattern

  // downVols[0] = แท่งล่าสุดก่อนวันนี้ (index 0), downVols[last] = แท่งเก่าสุดในชุด
  const declining = downVols[0] < downVols[downVols.length - 1];
  const avgDownVol = downVols.reduce((a, b) => a + b, 0) / downVols.length;
  const volSpike = volumes[i] > avgDownVol * spikeMultiplier;
  if (!(declining && volSpike)) return null;

  return {
    type: 'volume_exhaustion',
    downDaysCounted: downVols.length,
    avgDownVolume: Math.round(avgDownVol),
    todayVolume: Math.round(volumes[i]),
    spikeRatio: +(volumes[i] / avgDownVol).toFixed(2),
  };
}

export function detectHammer(opens, highs, lows, closes, i) {
  const body = Math.abs(closes[i] - opens[i]);
  const range = highs[i] - lows[i];
  if (range <= 0) return false;
  const lowerWick = Math.min(opens[i], closes[i]) - lows[i];
  const upperWick = highs[i] - Math.max(opens[i], closes[i]);
  return lowerWick >= body * 2 && upperWick <= body * 0.5 && body / range < 0.4;
}

export function detectBullishEngulfing(opens, closes, i) {
  if (i < 1) return false;
  const prevRed = closes[i - 1] < opens[i - 1];
  const curGreen = closes[i] > opens[i];
  if (!(prevRed && curGreen)) return false;
  return opens[i] <= closes[i - 1] && closes[i] >= opens[i - 1];
}

// ── Confirmation Check ────────────────────────────────────────────────
// Divergence/candle/volume บอกแค่ "ขาลงเริ่มอ่อนแรง" ไม่ใช่ "เข้าได้แล้ว"
// เช็คเพิ่ม 3 ข้อก่อนเรียกว่า "ยืนยัน":
//   1) Higher High — ราคาทะลุจุดสูงสุดก่อนหน้า (ระหว่าง 2 จุดต่ำของ divergence,
//      หรือ swing high 10 แท่งก่อนแท่งสัญญาณ สำหรับ candle/volume signal)
//   2) RSI(14) ปัจจุบัน > 50 — โมเมนตัมกลับมาเป็นบวกจริง ไม่ใช่แค่อ่อนแรงน้อยลง
//   3) Trend Score ปัจจุบัน > 0 — เทรนด์ใหญ่ (EMA alignment) เริ่มพลิกจริง
export function computeConfirmation({ opens, highs, lows, closes, volumes }, signals) {
  const n = closes.length;
  const lastIdx = n - 1;
  const rsiSeries = rsiFull(closes, 14);
  const scoreSeries = trendScoreSeries({ closes, highs, lows, volumes });

  const div = signals.find(s => s.type === 'bullish_divergence');
  let referenceHigh;
  if (div) {
    const segment = closes.slice(div.priorIdx, div.recentIdx + 1);
    referenceHigh = Math.max(...segment);
  } else {
    const start = Math.max(0, lastIdx - 9);
    const segment = closes.slice(start, lastIdx); // ไม่รวมแท่งสัญญาณ (แท่งล่าสุด) เอง
    referenceHigh = segment.length ? Math.max(...segment) : closes[lastIdx];
  }

  const higherHigh = closes[lastIdx] > referenceHigh;
  const rsiNow = rsiSeries[lastIdx];
  const rsiAbove50 = rsiNow != null && rsiNow > 50;
  const trendScoreNow = scoreSeries[lastIdx];
  const trendPositive = trendScoreNow != null && trendScoreNow > 0;

  const confirmedCount = [higherHigh, rsiAbove50, trendPositive].filter(Boolean).length;

  return {
    higherHigh, referenceHigh: +referenceHigh.toFixed(4),
    rsiAbove50, rsiNow: rsiNow != null ? +rsiNow.toFixed(1) : null,
    trendPositive, trendScoreNow: trendScoreNow != null ? +trendScoreNow.toFixed(1) : null,
    confirmedCount, isConfirmed: confirmedCount === 3,
  };
}

// ── รวมทุกสัญญาณ ──────────────────────────────────────────────────────
export function detectReversalSignals({ opens, highs, lows, closes, volumes }) {
  const n = closes.length;
  if (n < 20) return { hasSignal: false, signalCount: 0, signals: [], error: 'ข้อมูลไม่พอ (ต้องการอย่างน้อย 20 แท่ง)' };

  const rsiSeries = rsiFull(closes, 14);
  const lastIdx = n - 1;

  const signals = [];
  const div = detectBullishDivergence(closes, rsiSeries);
  if (div) signals.push(div);
  const volEx = detectVolumeExhaustion(opens, closes, volumes);
  if (volEx) signals.push(volEx);
  if (detectHammer(opens, highs, lows, closes, lastIdx)) signals.push({ type: 'hammer', idx: lastIdx });
  if (detectBullishEngulfing(opens, closes, lastIdx)) signals.push({ type: 'bullish_engulfing', idx: lastIdx });

  const result = {
    hasSignal: signals.length > 0,
    signalCount: signals.length,
    signals,
    price: +closes[lastIdx].toFixed(4),
    rsi: rsiSeries[lastIdx] != null ? +rsiSeries[lastIdx].toFixed(1) : null,
  };

  if (signals.length > 0) {
    result.confirmation = computeConfirmation({ opens, highs, lows, closes, volumes }, signals);
  }

  return result;
}

// ── Bearish signals (ฝั่งขาย/แนวต้าน) ─────────────────────────────────
// mirror ของฝั่ง bullish ข้างบน ใช้สำหรับ Sell Zone Alert (ราคาใกล้แนวต้าน + สัญญาณอ่อนแรง)

// เทียบ pivot high ล่าสุด 2 จุด: ราคาสูงขึ้น (HH) แต่ RSI ต่ำลง (LH) = divergence ขาลง
export function detectBearishDivergence(closes, rsiSeries, window = 3, lookback = 60) {
  const n = closes.length;
  const start = Math.max(0, n - lookback);
  const highIdxs = findPivotIndices(closes.slice(start), window, 'high').map(i => i + start);
  const validHighs = highIdxs.filter(i => rsiSeries[i] != null);
  if (validHighs.length < 2) return null;

  const last = validHighs[validHighs.length - 1];
  const prev = validHighs[validHighs.length - 2];
  const priceHH = closes[last] > closes[prev];
  const rsiLH = rsiSeries[last] < rsiSeries[prev];
  if (!(priceHH && rsiLH)) return null;

  return {
    type: 'bearish_divergence',
    priorIdx: prev, priorPrice: +closes[prev].toFixed(4), priorRsi: +rsiSeries[prev].toFixed(1),
    recentIdx: last, recentPrice: +closes[last].toFixed(4), recentRsi: +rsiSeries[last].toFixed(1),
  };
}

// แท่งขาขึ้นติดกัน วอลุ่มเริ่มเบาลง (ผู้ซื้อหมดแรง) แล้ววันล่าสุดเป็นแท่งแดง+วอลุ่มพุ่ง = ผู้ขายเข้าแทน
export function detectVolumeClimax(opens, closes, volumes, maxUpDays = 5, spikeMultiplier = 1.3) {
  const n = closes.length;
  if (n < 4) return null;
  const i = n - 1;
  const isRedToday = closes[i] < opens[i];
  if (!isRedToday) return null;

  const upVols = [];
  for (let j = i - 1; j >= 0 && upVols.length < maxUpDays; j--) {
    if (closes[j] > opens[j]) upVols.push(volumes[j]);
    else break;
  }
  if (upVols.length < 3) return null;

  const declining = upVols[0] < upVols[upVols.length - 1];
  const avgUpVol = upVols.reduce((a, b) => a + b, 0) / upVols.length;
  const volSpike = volumes[i] > avgUpVol * spikeMultiplier;
  if (!(declining && volSpike)) return null;

  return {
    type: 'volume_climax',
    upDaysCounted: upVols.length,
    avgUpVolume: Math.round(avgUpVol),
    todayVolume: Math.round(volumes[i]),
    spikeRatio: +(volumes[i] / avgUpVol).toFixed(2),
  };
}

export function detectShootingStar(opens, highs, lows, closes, i) {
  const body = Math.abs(closes[i] - opens[i]);
  const range = highs[i] - lows[i];
  if (range <= 0) return false;
  const upperWick = highs[i] - Math.max(opens[i], closes[i]);
  const lowerWick = Math.min(opens[i], closes[i]) - lows[i];
  return upperWick >= body * 2 && lowerWick <= body * 0.5 && body / range < 0.4;
}

export function detectBearishEngulfing(opens, closes, i) {
  if (i < 1) return false;
  const prevGreen = closes[i - 1] > opens[i - 1];
  const curRed = closes[i] < opens[i];
  if (!(prevGreen && curRed)) return false;
  return opens[i] >= closes[i - 1] && closes[i] <= opens[i - 1];
}

const BEARISH_LABELS_INTERNAL = {
  bearish_divergence: 'RSI Divergence (โมเมนตัมขาขึ้นอ่อนแรง)',
  volume_climax: 'วอลุ่มขาขึ้นหมดแรง + วันนี้แท่งแดง',
  shooting_star: 'แท่งเทียน Shooting Star',
  bearish_engulfing: 'แท่งเทียน Bearish Engulfing',
};

export function detectBearishSignals({ opens, highs, lows, closes, volumes }) {
  const n = closes.length;
  if (n < 20) return { hasSignal: false, signalCount: 0, signals: [], error: 'ข้อมูลไม่พอ (ต้องการอย่างน้อย 20 แท่ง)' };

  const rsiSeries = rsiFull(closes, 14);
  const lastIdx = n - 1;

  const signals = [];
  const div = detectBearishDivergence(closes, rsiSeries);
  if (div) signals.push(div);
  const volClimax = detectVolumeClimax(opens, closes, volumes);
  if (volClimax) signals.push(volClimax);
  if (detectShootingStar(opens, highs, lows, closes, lastIdx)) signals.push({ type: 'shooting_star', idx: lastIdx });
  if (detectBearishEngulfing(opens, closes, lastIdx)) signals.push({ type: 'bearish_engulfing', idx: lastIdx });

  return {
    hasSignal: signals.length > 0,
    signalCount: signals.length,
    signals,
    price: +closes[lastIdx].toFixed(4),
    rsi: rsiSeries[lastIdx] != null ? +rsiSeries[lastIdx].toFixed(1) : null,
  };
}
