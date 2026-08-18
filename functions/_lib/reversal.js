// ── Reversal Signal detection ────────────────────────────────────────
// ต่างจาก Trend Score (บอกทิศทางที่กำลังเป็นอยู่) — โมดูลนี้หาสัญญาณว่า
// "แนวโน้มขาลงอาจกำลังจะจบ" ก่อนที่ Trend Score จะพลิกเป็นบวกด้วยซ้ำ:
//   1) Bullish RSI Divergence — ราคาทำจุดต่ำใหม่ แต่ RSI ไม่ทำจุดต่ำใหม่ตาม
//   2) Volume Exhaustion — วอลุ่มขาลงเริ่มเบาลงเรื่อยๆ แล้ววันนี้เขียว+วอลุ่มพุ่ง
//   3) Hammer / Bullish Engulfing — รูปแบบแท่งเทียนกลับตัวคลาสสิก
// ใช้ได้กับทุก timeframe (day/week/month) เพราะรับแค่ array ของราคา ไม่สนใจว่าแท่งคือวันไหน
import { rsiFull } from './technicals.js';

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

  return {
    hasSignal: signals.length > 0,
    signalCount: signals.length,
    signals,
    price: +closes[lastIdx].toFixed(4),
    rsi: rsiSeries[lastIdx] != null ? +rsiSeries[lastIdx].toFixed(1) : null,
  };
}
