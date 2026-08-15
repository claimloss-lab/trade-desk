// ── /api/backtest ────────────────────────────────────────────────────
// POST { ticker, range='5y', entryScore=20, exitScore=-20,
//        initialCapital=100000, feePct=0.001 }
// Backtests a Trend-Score crossover strategy against historical daily
// OHLCV from Yahoo Finance: go long when score crosses above entryScore,
// exit when score drops below exitScore. Reports win rate, drawdown,
// profit factor, and compares vs buy & hold over the same window.
import { trendScoreSeries } from '../_lib/technicals.js';

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST')
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const {
      ticker, range = '5y', entryScore = 20, exitScore = -20,
      initialCapital = 100000, feePct = 0.001,
    } = await context.request.json();

    if (!ticker) return new Response(JSON.stringify({ error: 'no ticker' }), { status: 400, headers: cors });
    if (entryScore <= exitScore)
      return new Response(JSON.stringify({ error: 'entryScore ต้องมากกว่า exitScore' }), { status: 400, headers: cors });

    const norm = s => (s || '').replace('.', '-').replace(/-BK$/, '.BK');
    const sym = norm(ticker);

    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${encodeURIComponent(range)}&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!r.ok) return new Response(JSON.stringify({ error: 'yahoo fetch failed' }), { status: 502, headers: cors });
    const j = await r.json();
    const res = j.chart?.result?.[0];
    const q = res?.indicators?.quote?.[0];
    if (!res || !q) return new Response(JSON.stringify({ error: 'no data' }), { status: 502, headers: cors });

    const rows = (res.timestamp || []).map((t, i) => ({
      date: t, close: q.close?.[i], high: q.high?.[i], low: q.low?.[i], volume: q.volume?.[i],
    })).filter(x => x.close != null && x.high != null && x.low != null);

    if (rows.length < 260)
      return new Response(JSON.stringify({ error: 'ข้อมูลไม่พอสำหรับ backtest (ต้องการอย่างน้อย ~260 วันทำการ)' }), { status: 400, headers: cors });

    const closes = rows.map(x => x.close);
    const highs = rows.map(x => x.high);
    const lows = rows.map(x => x.low);
    const volumes = rows.map(x => x.volume || 0);
    const dates = rows.map(x => new Date(x.date * 1000).toISOString().slice(0, 10));

    const scores = trendScoreSeries({ closes, highs, lows, volumes });
    const firstValidIdx = scores.findIndex(s => s != null);

    // ── Simulate ──
    let cash = initialCapital, shares = 0, inPosition = false;
    let entryPrice = 0, entryDate = null, entryIdx = 0, capitalAtEntry = 0;
    const trades = [];
    const equitySeries = [];
    let peak = initialCapital, maxDD = 0;

    for (let i = 0; i < closes.length; i++) {
      const score = scores[i];
      if (score != null) {
        if (!inPosition && score > entryScore) {
          capitalAtEntry = cash;
          shares = (cash * (1 - feePct)) / closes[i];
          cash = 0; inPosition = true;
          entryPrice = closes[i]; entryDate = dates[i]; entryIdx = i;
        } else if (inPosition && score < exitScore) {
          cash = shares * closes[i] * (1 - feePct);
          const pnlPct = (closes[i] - entryPrice) / entryPrice * 100;
          trades.push({
            entryDate, entryPrice: +entryPrice.toFixed(4),
            exitDate: dates[i], exitPrice: +closes[i].toFixed(4),
            pnlPct: +pnlPct.toFixed(2), dollarPnl: +(cash - capitalAtEntry).toFixed(2),
            bars: i - entryIdx, status: 'closed',
          });
          shares = 0; inPosition = false;
        }
      }
      const eq = inPosition ? shares * closes[i] : cash;
      equitySeries.push(eq);
      if (eq > peak) peak = eq;
      const dd = (eq - peak) / peak * 100;
      if (dd < maxDD) maxDD = dd;
    }

    let openTrade = null;
    if (inPosition) {
      const lastClose = closes[closes.length - 1];
      const pnlPct = (lastClose - entryPrice) / entryPrice * 100;
      openTrade = {
        entryDate, entryPrice: +entryPrice.toFixed(4),
        exitDate: dates[dates.length - 1], exitPrice: +lastClose.toFixed(4),
        pnlPct: +pnlPct.toFixed(2), dollarPnl: +((shares * lastClose) - capitalAtEntry).toFixed(2),
        bars: closes.length - 1 - entryIdx, status: 'open',
      };
    }

    const wins = trades.filter(t => t.dollarPnl > 0);
    const losses = trades.filter(t => t.dollarPnl <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.dollarPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.dollarPnl, 0));

    const finalEquity = equitySeries[equitySeries.length - 1];
    const buyHoldReturnPct = firstValidIdx >= 0
      ? +(((closes[closes.length - 1] - closes[firstValidIdx]) / closes[firstValidIdx]) * 100).toFixed(2)
      : null;

    // Downsample equity curve for a lighter payload (chart display)
    const step = Math.max(1, Math.ceil(equitySeries.length / 500));
    const equityCurve = [];
    for (let i = 0; i < equitySeries.length; i += step) {
      equityCurve.push({ date: dates[i], equity: +equitySeries[i].toFixed(2) });
    }
    equityCurve.push({ date: dates[dates.length - 1], equity: +finalEquity.toFixed(2) });

    const summary = {
      totalTrades: trades.length,
      winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : null,
      avgWinPct: wins.length ? +(wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length).toFixed(2) : null,
      avgLossPct: losses.length ? +(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length).toFixed(2) : null,
      profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? null : 0),
      totalReturnPct: +(((finalEquity - initialCapital) / initialCapital) * 100).toFixed(2),
      buyHoldReturnPct,
      maxDrawdownPct: +maxDD.toFixed(2),
      finalEquity: +finalEquity.toFixed(2),
      periodStart: dates[firstValidIdx >= 0 ? firstValidIdx : 0],
      periodEnd: dates[dates.length - 1],
    };

    return new Response(JSON.stringify({
      ticker, range,
      params: { entryScore, exitScore, feePct, initialCapital },
      summary,
      trades: openTrade ? [...trades, openTrade] : trades,
      equityCurve,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
