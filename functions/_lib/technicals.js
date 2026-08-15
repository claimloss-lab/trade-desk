// ── Shared technical indicator library ──────────────────────────────
// EMA, RSI (Wilder), ATR (Wilder), Volume confirmation, pivot-based
// Support/Resistance, and composite Trend Score (-100..+100).
// Series (*Full) variants compute the whole history in O(n) so
// backtest.js / screener.js can walk day-by-day without recomputing
// each indicator from scratch at every step.
// Used by trend-score.js, backtest.js, screener.js.

export function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

// ---- Series (full-history, O(n)) ----
export function emaFull(closes, n) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < n) return out;
  const k = 2 / (n + 1);
  let prev = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsiFull(closes, p = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < p + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / p, avgLoss = losses / p;
  out[p] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function atrFull(highs, lows, closes, p = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < p + 1) return out;
  const trs = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    trs[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  let atr = 0;
  for (let i = 1; i <= p; i++) atr += trs[i];
  atr /= p;
  out[p] = atr;
  for (let i = p + 1; i < n; i++) {
    atr = (atr * (p - 1) + trs[i]) / p;
    out[i] = atr;
  }
  return out;
}

export function volumeRatioFull(volumes, n = 20) {
  const out = new Array(volumes.length).fill(null);
  for (let i = n; i < volumes.length; i++) {
    const avg = volumes.slice(i - n, i).reduce((a, b) => a + b, 0) / n;
    out[i] = avg ? volumes[i] / avg : null;
  }
  return out;
}

// ---- Single-value convenience wrappers (latest bar) ----
export function ema(closes, n) {
  const s = emaFull(closes, n);
  return s.length ? s[s.length - 1] : null;
}
export function rsiWilder(closes, p = 14) {
  const s = rsiFull(closes, p);
  return s.length ? s[s.length - 1] : null;
}
export function atrWilder(highs, lows, closes, p = 14) {
  const s = atrFull(highs, lows, closes, p);
  return s.length ? s[s.length - 1] : null;
}
export function volumeRatio(volumes, n = 20) {
  const s = volumeRatioFull(volumes, n);
  return s.length ? s[s.length - 1] : null;
}

// ---- Pivot-based support/resistance ----
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

// ---- Composite Trend Score series: -100 (strong sell) .. +100 (strong buy) ----
// Weights: EMA alignment 40, RSI momentum 30, Volume confirmation 15, ATR-normalized strength 15
// Returns an array aligned to `closes`, null where there isn't enough history yet.
export function trendScoreSeries({ closes, highs, lows, volumes }) {
  const n = closes.length;
  const e20f = emaFull(closes, 20);
  const e50f = emaFull(closes, 50);
  const e200f = emaFull(closes, 200);
  const rsif = rsiFull(closes, 14);
  const atrf = atrFull(highs, lows, closes, 14);
  const volf = volumeRatioFull(volumes, 20);
  const out = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const e20 = e20f[i], e50 = e50f[i], e200 = e200f[i];
    const rsi = rsif[i], atr = atrf[i], volRatio = volf[i];
    if (e20 == null || e50 == null) continue;

    let score = 0;
    // 1) EMA alignment
    let emaComponent = 0;
    if (e200 != null) {
      if (closes[i] > e20 && e20 > e50 && e50 > e200) emaComponent = 40;
      else if (closes[i] < e20 && e20 < e50 && e50 < e200) emaComponent = -40;
      else {
        let bull = 0, bear = 0;
        if (closes[i] > e20) bull++; else bear++;
        if (e20 > e50) bull++; else bear++;
        if (e50 > e200) bull++; else bear++;
        emaComponent = ((bull - bear) / 3) * 40;
      }
    } else {
      if (closes[i] > e20 && e20 > e50) emaComponent = 30;
      else if (closes[i] < e20 && e20 < e50) emaComponent = -30;
      else emaComponent = closes[i] > e20 ? 10 : -10;
    }
    score += emaComponent;

    // 2) RSI momentum
    let rsiComponent = 0;
    if (rsi != null) rsiComponent = Math.max(-30, Math.min(30, ((rsi - 50) / 50) * 30));
    score += rsiComponent;

    // 3) Volume confirmation
    let volComponent = 0;
    if (volRatio != null && i >= 1) {
      const priceUp = closes[i] > closes[i - 1];
      const strength = Math.min(1, Math.max(0, volRatio - 1));
      volComponent = (priceUp ? 1 : -1) * strength * 15;
    }
    score += volComponent;

    // 4) ATR-normalized momentum strength
    let atrComponent = 0;
    if (atr != null && atr > 0) {
      const distInAtr = (closes[i] - e20) / atr;
      atrComponent = Math.max(-15, Math.min(15, distInAtr * 5));
    }
    score += atrComponent;

    out[i] = Math.max(-100, Math.min(100, +score.toFixed(2)));
  }
  return out;
}

function scoreLabel(score) {
  if (score == null) return null;
  if (score > 50) return 'Strong Buy';
  if (score > 20) return 'Buy';
  if (score < -50) return 'Strong Sell';
  if (score < -20) return 'Sell';
  return 'Neutral';
}

// Latest-bar convenience wrapper (used by trend-score.js live endpoint)
export function trendScore(data) {
  const series = trendScoreSeries(data);
  const score = series[series.length - 1];
  const price = data.closes[data.closes.length - 1];
  const e20 = emaFull(data.closes, 20).at(-1);
  const e50 = emaFull(data.closes, 50).at(-1);
  const e200 = emaFull(data.closes, 200).at(-1);
  const rsi = rsiFull(data.closes, 14).at(-1);
  const atr = atrFull(data.highs, data.lows, data.closes, 14).at(-1);
  const volRatio = volumeRatioFull(data.volumes, 20).at(-1);
  return {
    score, label: scoreLabel(score), price: +price.toFixed(4),
    detail: {
      ema: { e20: e20 != null ? +e20.toFixed(4) : null, e50: e50 != null ? +e50.toFixed(4) : null, e200: e200 != null ? +e200.toFixed(4) : null },
      rsi: { value: rsi != null ? +rsi.toFixed(1) : null, overbought: rsi != null && rsi > 70, oversold: rsi != null && rsi < 30 },
      volume: { ratio: volRatio != null ? +volRatio.toFixed(2) : null },
      atr: { value: atr != null ? +atr.toFixed(4) : null },
    },
  };
}
