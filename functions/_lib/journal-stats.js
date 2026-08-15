// ── Trading Journal statistics ──────────────────────────────────────
// Pure computation over the flat `transactions` array from
// portfolio-data.json. No network calls — used by journal.js and
// unit-testable in isolation.

const THAI_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function computeJournalStats(transactions) {
  const closed = (transactions || [])
    .filter(t => t.type === 'sell' && t.realizedPnl != null)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id || 0) - (b.id || 0));

  if (!closed.length) {
    return { totalClosedTrades: 0, message: 'ยังไม่มีรายการปิดสถานะ (sell พร้อม realizedPnl) ให้วิเคราะห์' };
  }

  // ── FIFO buy-date matching per (portId, ticker) for approx holding days ──
  const allSorted = (transactions || []).slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id || 0) - (b.id || 0));
  const buyQueues = {}; // key: portId|ticker -> [dates...]
  const holdDaysById = {};
  for (const t of allSorted) {
    const key = `${t.portId}|${t.ticker}`;
    if (t.type === 'buy') {
      (buyQueues[key] = buyQueues[key] || []).push(t.date);
    } else if (t.type === 'sell') {
      const q = buyQueues[key];
      if (q && q.length) {
        const buyDate = q.shift();
        const days = Math.round((new Date(t.date) - new Date(buyDate)) / 86400000);
        if (days >= 0) holdDaysById[t.id] = days;
      }
    }
  }

  const wins = closed.filter(t => t.realizedPnl > 0);
  const losses = closed.filter(t => t.realizedPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

  // ── Per-ticker ──
  const byTickerMap = {};
  for (const t of closed) {
    const k = t.ticker;
    byTickerMap[k] = byTickerMap[k] || { ticker: k, trades: 0, wins: 0, totalPnl: 0 };
    byTickerMap[k].trades++;
    if (t.realizedPnl > 0) byTickerMap[k].wins++;
    byTickerMap[k].totalPnl += t.realizedPnl;
  }
  const byTicker = Object.values(byTickerMap).map(x => ({
    ...x, winRate: +((x.wins / x.trades) * 100).toFixed(1), totalPnl: +x.totalPnl.toFixed(2),
  })).sort((a, b) => a.totalPnl - b.totalPnl);

  // ── Per-portfolio ──
  const byPortMap = {};
  for (const t of closed) {
    const k = t.portId || 'unknown';
    byPortMap[k] = byPortMap[k] || { portId: k, trades: 0, wins: 0, totalPnl: 0 };
    byPortMap[k].trades++;
    if (t.realizedPnl > 0) byPortMap[k].wins++;
    byPortMap[k].totalPnl += t.realizedPnl;
  }
  const byPortfolio = Object.values(byPortMap).map(x => ({
    ...x, winRate: +((x.wins / x.trades) * 100).toFixed(1), totalPnl: +x.totalPnl.toFixed(2),
  })).sort((a, b) => a.totalPnl - b.totalPnl);

  // ── Day-of-week pattern (exit day) ──
  const byDowMap = {};
  for (const t of closed) {
    const dow = THAI_DOW[new Date(t.date).getDay()];
    byDowMap[dow] = byDowMap[dow] || { dow, trades: 0, wins: 0, totalPnl: 0 };
    byDowMap[dow].trades++;
    if (t.realizedPnl > 0) byDowMap[dow].wins++;
    byDowMap[dow].totalPnl += t.realizedPnl;
  }
  const byDayOfWeek = Object.values(byDowMap).map(x => ({
    ...x, winRate: +((x.wins / x.trades) * 100).toFixed(1), totalPnl: +x.totalPnl.toFixed(2),
  }));

  // ── Streaks (chronological) ──
  let curStreak = 0, curType = null, maxWinStreak = 0, maxLossStreak = 0;
  for (const t of closed) {
    const isWin = t.realizedPnl > 0;
    if (curType === isWin) curStreak++;
    else { curType = isWin; curStreak = 1; }
    if (isWin) maxWinStreak = Math.max(maxWinStreak, curStreak);
    else maxLossStreak = Math.max(maxLossStreak, curStreak);
  }
  const currentStreak = { type: curType ? 'win' : 'loss', count: curStreak };

  // ── Holding days stats ──
  const holdDaysArr = closed.map(t => holdDaysById[t.id]).filter(d => d != null);
  const avgHoldDaysWin = (() => {
    const arr = wins.map(t => holdDaysById[t.id]).filter(d => d != null);
    return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
  })();
  const avgHoldDaysLoss = (() => {
    const arr = losses.map(t => holdDaysById[t.id]).filter(d => d != null);
    return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
  })();

  const sorted = closed.slice().sort((a, b) => a.realizedPnl - b.realizedPnl);
  const worstTrade = sorted[0];
  const bestTrade = sorted[sorted.length - 1];

  return {
    totalClosedTrades: closed.length,
    winRate: +((wins.length / closed.length) * 100).toFixed(1),
    avgWin: wins.length ? +(grossProfit / wins.length).toFixed(2) : null,
    avgLoss: losses.length ? +(grossLoss / losses.length).toFixed(2) : null,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? null : 0),
    totalRealizedPnl: +(grossProfit - grossLoss).toFixed(2),
    bestTrade: bestTrade && { ticker: bestTrade.ticker, portId: bestTrade.portId, date: bestTrade.date, pnl: bestTrade.realizedPnl },
    worstTrade: worstTrade && { ticker: worstTrade.ticker, portId: worstTrade.portId, date: worstTrade.date, pnl: worstTrade.realizedPnl },
    avgHoldDaysWin, avgHoldDaysLoss,
    currentStreak, maxWinStreak, maxLossStreak,
    byTicker, byPortfolio, byDayOfWeek,
  };
}
