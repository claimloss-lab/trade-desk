// ── Buy Zone Alert ────────────────────────────────────────────────────
// รวม 2 ระบบที่มีอยู่แล้ว (S/R engine + Reversal Signal) เป็นคำตอบเดียว:
// "ราคาตอนนี้อยู่ในโซนแนวรับ และแนวรับดูเหมือนจะรับอยู่จริง" — ตรงกับสไตล์
// เข้าที่แนวรับ (ไม่ไล่ราคา) แบบ staged entry ที่ใช้อยู่แล้ว
//
// inBuyZone = true ต้องผ่านทั้ง 2 เงื่อนไข:
//   1) nearSupport — ราคาห่างแนวรับไม่เกิน proximityPct% (อนุโลมหลุดลงไปได้เล็กน้อย
//      เพราะราคาชอบมี wick ทะลุแนวรับก่อนเด้ง)
//   2) มี "หลักฐานว่ากำลังรับอยู่" อย่างน้อย 1 ข้อ: RSI เริ่มดีดตัว, มี Reversal
//      Signal (จาก reversal.js), หรือแท่งล่าสุดไม่ได้ปิดที่จุดต่ำสุดของวัน
import { nearestSupportResistance, rsiFull } from './technicals.js';
import { detectReversalSignals } from './reversal.js';

export function detectBuyZone({ opens, highs, lows, closes, volumes }, opts = {}) {
  const proximityPct = opts.proximityPct ?? 3;   // ยอมให้ราคาอยู่เหนือแนวรับได้ไม่เกินกี่ %
  const undershootPct = opts.undershootPct ?? 2;  // ยอมให้ราคาหลุดแนวรับไปได้ไม่เกินกี่ % (wick)

  const n = closes.length;
  if (n < 30) return { inBuyZone: false, error: 'ข้อมูลไม่พอ (ต้องการอย่างน้อย 30 แท่ง)' };

  const sr = nearestSupportResistance(highs, lows, closes);
  const hasConfirmedSupport = sr.allSupports.length > 0; // ไม่ใช่แค่ fallback เป็นจุดต่ำสุดที่ยังไม่เคยเด้งกลับ
  const price = closes[n - 1];
  const support = sr.support;
  const distFromSupportPct = +(((price - support) / support) * 100).toFixed(2);

  const nearSupport = hasConfirmedSupport && distFromSupportPct >= -undershootPct && distFromSupportPct <= proximityPct;

  const rsiSeries = rsiFull(closes, 14);
  const rsiNow = rsiSeries[n - 1];
  const rsiPrev = rsiSeries[n - 2];
  const rsiRecovering = rsiNow != null && rsiPrev != null && rsiNow > rsiPrev;

  const reversal = detectReversalSignals({ opens, highs, lows, closes, volumes });

  const dayRange = highs[n - 1] - lows[n - 1];
  const notClosingAtLow = dayRange > 0 ? (closes[n - 1] - lows[n - 1]) / dayRange > 0.15 : true;

  const evidence = [];
  if (rsiRecovering) evidence.push('rsi_recovering');
  if (reversal.hasSignal) evidence.push('reversal_signal');
  if (notClosingAtLow) evidence.push('not_closing_at_low');

  const inBuyZone = nearSupport && evidence.length > 0;

  return {
    inBuyZone,
    price: +price.toFixed(4),
    support: +support.toFixed(4),
    resistance: +sr.resistance.toFixed(4),
    hasConfirmedSupport,
    distFromSupportPct,
    nearSupport,
    evidence,
    rsiNow: rsiNow != null ? +rsiNow.toFixed(1) : null,
    rsiRecovering,
    notClosingAtLow,
    reversalSignals: reversal.signals,
  };
}
