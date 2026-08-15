// ── Shared technical indicator library ──────────────────────────────
// EMA, RSI (Wilder), ATR (Wilder), Volume confirmation, pivot-based
// Support/Resistance, and composite Trend Score (-100..+100).
// Used by trend-score.js, backtest.js, screener.js.

export function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

export function emaSeries(closes, n) {
  if (closes.length < n) return [];
  const k = 2 / (n + 1);
  const out = [];
  let prev = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out.push(prev);
  for (let i = n; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out; // out[out.length-1] = latest EMA
}

export function ema(closes, n) {
  const s = emaSeries(closes, n);
  return s.length ? s[s.length - 1] : null;
}

export function rsiWilder(closes, p = 14) {
  if (closes.length < p + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / p, avgLoss = losses / p;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atrWilder(highs, lows, closes, p = 14) {
  if (closes.length < p + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  let atr = trs.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < trs.length; i++) {
    atr = (atr * (p - 1) + trs[i]) / p;
  }
  return atr;
}

export function volumeRatio(volumes, n = 20) {
  if (volumes.length < n + 1) return null;
  const avg = sma(volumes.slice(0, -1), n); // avg excluding today
  const today = volumes[volumes.length - 1];
  if (!avg) return null;
  return today / avg;
}

// Pivot-based support/resistance: local extrema over a symmetric window
export function findPivots(highs, lows, window = 5) {
  const pivotHighs = [], pivotLows = [];
  for (let i = window; i < highs.length - window; i++) {
    const hSlice = highs.slice(i - window, i + window + 1);
    const lSlice = lows.slice(i - window, i + window + 1);
    if (highs[i] === Math.max(...hSlice)) pivotHighs.push(highs[i]);
    if (lows[i] === Math.min(...lSlice)) pivotLows.push(lows[i]);
  }
  return { pivotHighs, pivotLows };
}

export function nearestSupportResistance(highs, lows, closes, window = 5) {
  const { pivotHighs, pivotLows } = findPivots(highs, lows, window);
  const price = closes[closes.length - 1];
  const supports = pivotLows.filter(v => v < price).sort((a, b) => b - a);
  const resistances = pivotHighs.filter(v => v > price).sort((a, b) => a - b);
  return {
    support: supports[0] ?? Math.min(...lows),
    resistance: resistances[0] ?? Math.max(...highs),
    allSupports: [...new Set(supports.map(v => +v.toFixed(4)))].slice(0, 3),
    allResistances: [...new Set(resistances.map(v => +v.toFixed(4)))].slice(0, 3),
  };
}

// Composite Trend Score: -100 (strong sell) .. +100 (strong buy)
// Weights: EMA alignment 40, RSI momentum 30, Volume confirmation 15, ATR-normalized strength 15
export function trendScore({ closes, highs, lows, volumes }) {
  const price = closes[closes.length - 1];
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = closes.length >= 200 ? ema(closes, 200) : null;
  const rsi = rsiWilder(closes, 14);
  const atr = atrWilder(highs, lows, closes, 14);
  const volRatio = volumeRatio(volumes, 20);

  let score = 0;
  const detail = {};

  // 1) EMA alignment
  let emaComponent = 0;
  if (e20 != null && e50 != null) {
    if (e200 != null) {
      if (price > e20 && e20 > e50 && e50 > e200) emaComponent = 40;
      else if (price < e20 && e20 < e50 && e50 < e200) emaComponent = -40;
      else {
        let bull = 0, bear = 0;
        if (price > e20) bull++; else bear++;
        if (e20 > e50) bull++; else bear++;
        if (e50 > e200) bull++; else bear++;
        emaComponent = ((bull - bear) / 3) * 40;
      }
    } else {
      if (price > e20 && e20 > e50) emaComponent = 30;
      else if (price < e20 && e20 < e50) emaComponent = -30;
      else emaComponent = price > e20 ? 10 : -10;
    }
  }
  score += emaComponent;
  detail.ema = { e20: e20 != null ? +e20.toFixed(4) : null, e50: e50 != null ? +e50.toFixed(4) : null,
    e200: e200 != null ? +e200.toFixed(4) : null, component: +emaComponent.toFixed(1) };

  // 2) RSI momentum
  let rsiComponent = 0;
  if (rsi != null) rsiComponent = Math.max(-30, Math.min(30, ((rsi - 50) / 50) * 30));
  score += rsiComponent;
  detail.rsi = {
    value: rsi != null ? +rsi.toFixed(1) : null, component: +rsiComponent.toFixed(1),
    overbought: rsi != null && rsi > 70, oversold: rsi != null && rsi < 30,
  };

  // 3) Volume confirmation
  let volComponent = 0;
  if (volRatio != null && closes.length >= 2) {
    const priceUp = closes[closes.length - 1] > closes[closes.length - 2];
    const strength = Math.min(1, Math.max(0, volRatio - 1));
    volComponent = (priceUp ? 1 : -1) * strength * 15;
  }
  score += volComponent;
  detail.volume = { ratio: volRatio != null ? +volRatio.toFixed(2) : null, component: +volComponent.toFixed(1) };

  // 4) ATR-normalized momentum strength (distance from EMA20 in ATR units)
  let atrComponent = 0;
  if (atr != null && atr > 0 && e20 != null) {
    const distInAtr = (price - e20) / atr;
    atrComponent = Math.max(-15, Math.min(15, distInAtr * 5));
  }
  score += atrComponent;
  detail.atr = { value: atr != null ? +atr.toFixed(4) : null, component: +atrComponent.toFixed(1) };

  score = Math.max(-100, Math.min(100, score));

  let label = 'Neutral';
  if (score > 50) label = 'Strong Buy';
  else if (score > 20) label = 'Buy';
  else if (score < -50) label = 'Strong Sell';
  else if (score < -20) label = 'Sell';

  return { score: +score.toFixed(1), label, price: +price.toFixed(4), detail };
}
