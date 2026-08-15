// ── Paper Trading — pure state-transition logic (no I/O) ────────────
// Testable in isolation; functions/api/paper-trade.js wires this to
// GitHub Contents API for persistence in public/paper-trading.json.

export function freshState(initialCapital = 1000000) {
  const now = new Date().toISOString();
  return {
    initialCapital, cash: initialCapital,
    positions: [], closedTrades: [],
    createdAt: now, updatedAt: now,
  };
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function openPosition(state, { ticker, price, qty, note }) {
  if (!ticker || !(price > 0) || !(qty > 0))
    return { ok: false, error: 'ต้องระบุ ticker, price, qty ที่ถูกต้อง' };
  const cost = price * qty;
  if (cost > state.cash + 1e-6)
    return { ok: false, error: `เงินสดไม่พอ ต้องการ ${cost.toFixed(2)} แต่มี ${state.cash.toFixed(2)}` };

  const next = { ...state, positions: [...state.positions] };
  next.cash = +(next.cash - cost).toFixed(2);
  next.positions.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    ticker, entryPrice: price, qty, entryDate: todayStr(),
    source: note || 'manual',
  });
  next.updatedAt = new Date().toISOString();
  return { ok: true, state: next };
}

export function closePosition(state, { ticker, price, qty }) {
  if (!ticker || !(price > 0))
    return { ok: false, error: 'ต้องระบุ ticker, price ที่ถูกต้อง' };

  const openQty = state.positions.filter(p => p.ticker === ticker).reduce((s, p) => s + p.qty, 0);
  const qtyToClose = qty > 0 ? qty : openQty;
  if (qtyToClose <= 0 || qtyToClose > openQty + 1e-6)
    return { ok: false, error: `ไม่มีตำแหน่ง ${ticker} เพียงพอ (มี ${openQty}, ขอปิด ${qtyToClose})` };

  const positions = state.positions.map(p => ({ ...p })); // deep-ish copy
  let remaining = qtyToClose;
  const closedLots = [];
  let cashGain = 0;

  for (const pos of positions) {
    if (remaining <= 0) break;
    if (pos.ticker !== ticker || pos.qty <= 0) continue;
    const closeQty = Math.min(pos.qty, remaining);
    const pnl = (price - pos.entryPrice) * closeQty;
    closedLots.push({
      ticker, entryPrice: pos.entryPrice, exitPrice: price, qty: closeQty,
      entryDate: pos.entryDate, exitDate: todayStr(),
      pnl: +pnl.toFixed(2), pnlPct: +(((price - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2),
    });
    cashGain += price * closeQty;
    pos.qty = +(pos.qty - closeQty).toFixed(6);
    remaining -= closeQty;
  }

  const next = {
    ...state,
    positions: positions.filter(p => p.qty > 1e-6),
    closedTrades: [...state.closedTrades, ...closedLots],
    cash: +(state.cash + cashGain).toFixed(2),
    updatedAt: new Date().toISOString(),
  };
  return { ok: true, state: next, closedLots };
}

// Mark-to-market summary given current prices { ticker: price }
export function markToMarket(state, prices) {
  let positionsValue = 0;
  const positions = state.positions.map(p => {
    const cur = prices[p.ticker];
    const value = cur != null ? cur * p.qty : null;
    if (value != null) positionsValue += value;
    return {
      ...p,
      currentPrice: cur ?? null,
      value: value != null ? +value.toFixed(2) : null,
      unrealizedPnl: cur != null ? +((cur - p.entryPrice) * p.qty).toFixed(2) : null,
      unrealizedPnlPct: cur != null ? +(((cur - p.entryPrice) / p.entryPrice) * 100).toFixed(2) : null,
    };
  });
  const equity = +(state.cash + positionsValue).toFixed(2);
  const totalReturnPct = +(((equity - state.initialCapital) / state.initialCapital) * 100).toFixed(2);
  const realizedPnl = +state.closedTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2);
  return { cash: state.cash, positionsValue: +positionsValue.toFixed(2), equity, totalReturnPct, realizedPnl, positions };
}
