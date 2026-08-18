// ── Sell Zone Alert ────────────────────────────────────────────────────
// mirror ของ Buy Zone แต่ฝั่งขาย/ทำกำไร: "ราคาลงมาอยู่ในโซนแนวต้าน และแนวต้าน
// ดูเหมือนจะกดอยู่จริง" — เหมาะไว้เป็นสัญญาณพิจารณาขาย/ลดพอร์ตบางส่วน
//
// inSellZone = true ต้องผ่านทั้ง 3 เงื่อนไข:
//   1) nearResistance — ราคาห่างแนวต้านไม่เกิน proximityPct% (อนุโลมราคาแทงขึ้นไป
//      เหนือแนวต้านได้เล็กน้อยจาก overshootPct เพราะราคาชอบมี wick ทะลุก่อนร่วง)
//   2) มี "หลักฐานว่ากำลังโดนกดอยู่" อย่างน้อย 1 ข้อ: RSI เริ่มอ่อนแรง, มี Bearish
//      Reversal Signal (จาก reversal.js), หรือแท่งล่าสุดไม่ได้ปิดที่จุดสูงสุดของวัน
//   3) rsiNotOversold — RSI ปัจจุบันไม่ต่ำกว่า minRsi (ค่าเริ่มต้น 35) กันเคสที่
//      ราคาร่วงจากแนวต้านไปไกลแล้ว (สายเกินไปที่จะขายตรงนี้)
import { nearestSupportResistance, rsiFull } from './technicals.js';
import { detectBearishSignals } from './reversal.js';

export function detectSellZone({ opens, highs, lows, closes, volumes }, opts = {}) {
  const proximityPct = opts.proximityPct ?? 3;   // ยอมให้ราคาอยู่ต่ำกว่าแนวต้านได้ไม่เกินกี่ %
  const overshootPct = opts.overshootPct ?? 2;    // ยอมให้ราคาทะลุแนวต้านขึ้นไปได้ไม่เกินกี่ % (wick)
  const minRsi = opts.minRsi ?? 35;               // RSI ต่ำกว่านี้ = ร่วงจากแนวต้านไปไกลแล้ว ไม่นับเป็นโซนขาย

  const n = closes.length;
  if (n < 30) return { inSellZone: false, error: 'ข้อมูลไม่พอ (ต้องการอย่างน้อย 30 แท่ง)' };

  const sr = nearestSupportResistance(highs, lows, closes);
  const hasConfirmedResistance = sr.allResistances.length > 0; // ไม่ใช่แค่ fallback เป็นจุดสูงสุดที่ยังไม่เคยร่วงกลับ
  const price = closes[n - 1];
  const resistance = sr.resistance;
  const distFromResistancePct = +(((resistance - price) / resistance) * 100).toFixed(2); // + = ราคาต่ำกว่าแนวต้าน

  const nearResistance = hasConfirmedResistance && distFromResistancePct >= -overshootPct && distFromResistancePct <= proximityPct;

  const rsiSeries = rsiFull(closes, 14);
  const rsiNow = rsiSeries[n - 1];
  const rsiPrev = rsiSeries[n - 2];
  const rsiWeakening = rsiNow != null && rsiPrev != null && rsiNow < rsiPrev;
  const rsiNotOversold = rsiNow == null || rsiNow >= minRsi;

  const bearish = detectBearishSignals({ opens, highs, lows, closes, volumes });

  const dayRange = highs[n - 1] - lows[n - 1];
  const notClosingAtHigh = dayRange > 0 ? (highs[n - 1] - closes[n - 1]) / dayRange > 0.15 : true;

  const evidence = [];
  if (rsiWeakening) evidence.push('rsi_weakening');
  if (bearish.hasSignal) evidence.push('bearish_signal');
  if (notClosingAtHigh) evidence.push('not_closing_at_high');

  const inSellZone = nearResistance && evidence.length > 0 && rsiNotOversold;

  return {
    inSellZone,
    price: +price.toFixed(4),
    resistance: +resistance.toFixed(4),
    support: +sr.support.toFixed(4),
    hasConfirmedResistance,
    distFromResistancePct,
    nearResistance,
    evidence,
    rsiNow: rsiNow != null ? +rsiNow.toFixed(1) : null,
    rsiWeakening,
    rsiNotOversold,
    minRsi,
    notClosingAtHigh,
    bearishSignals: bearish.signals,
  };
}
