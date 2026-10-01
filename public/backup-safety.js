(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TradeDeskBackupSafety = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function stableRecord(value, ignoredKey = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
    const keys = Object.keys(value).filter(key => key !== ignoredKey).sort();
    return JSON.stringify(keys.map(key => [key, value[key]]));
  }

  function transactionKey(tx) {
    if (tx && tx.id != null) return 'id:' + String(tx.id);
    return 'row:' + stableRecord(tx);
  }

  function stockIdentity(stock) {
    const ticker = String(stock.ticker).trim().toUpperCase();
    return ticker + '|' + (stock.id == null ? 'no-id' : String(stock.id));
  }

  function quantities(stocks) {
    const totals = new Map();
    for (const stock of Array.isArray(stocks) ? stocks : []) {
      if (!stock || !stock.ticker) continue;
      const ticker = String(stock.ticker).trim().toUpperCase();
      const qty = Number(stock.qty);
      if (!ticker || !Number.isFinite(qty) || qty <= 0) continue;
      totals.set(ticker, (totals.get(ticker) || 0) + qty);
    }
    return totals;
  }

  function findSnapshotLosses(remote, local) {
    const safeTicker = /^[A-Za-z0-9][A-Za-z0-9._^$()&-]{0,31}$/;
    const finiteNumber = value => (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
    const safeId = /^[A-Za-z0-9_-]{1,48}$/;
    const validId = id => (typeof id === 'number' && Number.isSafeInteger(id)) ||
      (typeof id === 'string' && safeId.test(id));
    const validStock = stock => stock && typeof stock === 'object' && !Array.isArray(stock) &&
      typeof stock.ticker === 'string' && safeTicker.test(stock.ticker.trim()) &&
      (stock.id == null || validId(stock.id)) && finiteNumber(stock.qty) && Number(stock.qty) >= 0 &&
      (!Object.prototype.hasOwnProperty.call(stock, 'buyPrice') || (finiteNumber(stock.buyPrice) && Number(stock.buyPrice) >= 0));
    const validTransaction = tx => tx && typeof tx === 'object' && !Array.isArray(tx) &&
      typeof tx.ticker === 'string' && safeTicker.test(tx.ticker.trim()) &&
      ['buy', 'sell'].includes(String(tx.type || '').toLowerCase()) &&
      (tx.id == null || validId(tx.id)) && finiteNumber(tx.qty) && Number(tx.qty) > 0 &&
      finiteNumber(tx.price) && Number(tx.price) > 0 &&
      (!Object.prototype.hasOwnProperty.call(tx, 'fee') || finiteNumber(tx.fee));
    const validSnapshot = snapshot => {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
          !Array.isArray(snapshot.portfolios) || !Array.isArray(snapshot.transactions)) return false;
      const portfolioIds = new Set();
      for (const p of snapshot.portfolios) {
        if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.id !== 'string' || !safeId.test(p.id) ||
            typeof p.type !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(p.type) || !Array.isArray(p.stocks) ||
            !p.stocks.every(validStock) ||
            (Object.prototype.hasOwnProperty.call(p, 'cash') && !finiteNumber(p.cash))) return false;
        if (portfolioIds.has(p.id)) return false;
        portfolioIds.add(p.id);
        const stockIds = new Set();
        for (const stock of p.stocks) {
          const identity = stockIdentity(stock);
          if (stockIds.has(identity)) return false;
          stockIds.add(identity);
        }
      }
      if (!snapshot.transactions.every(validTransaction)) return false;
      const transactionIds = new Set();
      for (const tx of snapshot.transactions) {
        if (tx.id == null) continue;
        const id = String(tx.id);
        if (transactionIds.has(id)) return false;
        transactionIds.add(id);
      }
      return true;
    };
    const emptyResult = { missingPortfolios: [], missingHoldings: [], missingTransactions: [], changedHoldings: [], changedTransactions: [], cashChanges: [], invalidSnapshot: true, hasLoss: true };
    if (!validSnapshot(remote) || !validSnapshot(local)) return emptyResult;

    const remotePortfolios = remote.portfolios;
    const localPortfolios = local.portfolios;
    const localById = new Map(localPortfolios.map(p => [p.id, p]));
    const missingPortfolios = [];
    const missingHoldings = [];
    const changedHoldings = [];
    const changedTransactions = [];
    const cashChanges = [];
    const changedBackupFields = ['notes', 'dividends', 'watchlist', 'dcaHistory', 'currency', 'drConversions', '_srAlerts']
      .filter(key => Object.prototype.hasOwnProperty.call(remote, key) && stableRecord(remote[key]) !== stableRecord(local[key]));
    const remoteTransactions = remote.transactions;
    const localTransactions = local.transactions;
    const localTransactionBuckets = new Map();
    for (const tx of localTransactions) {
      const key = transactionKey(tx);
      if (!localTransactionBuckets.has(key)) localTransactionBuckets.set(key, []);
      localTransactionBuckets.get(key).push(tx);
    }
    const missingTransactions = [];
    for (const remoteTx of remoteTransactions) {
      const bucket = localTransactionBuckets.get(transactionKey(remoteTx));
      if (!bucket || bucket.length === 0) missingTransactions.push(remoteTx);
      else {
        const localTx = bucket.shift();
        if (stableRecord(remoteTx, 'id') !== stableRecord(localTx, 'id')) {
          changedTransactions.push({ id: remoteTx.id, ticker: remoteTx.ticker });
        }
      }
    }
    const remoteTransactionCounts = new Map();
    for (const tx of remoteTransactions) {
      const key = transactionKey(tx);
      remoteTransactionCounts.set(key, (remoteTransactionCounts.get(key) || 0) + 1);
    }
    const newLocalTransactions = [];
    for (const tx of localTransactions) {
      const key = transactionKey(tx);
      const count = remoteTransactionCounts.get(key) || 0;
      if (count > 0) remoteTransactionCounts.set(key, count - 1);
      else newLocalTransactions.push(tx);
    }

    for (const remotePortfolio of remotePortfolios) {
      if (!remotePortfolio || remotePortfolio.id == null) continue;
      const portfolioId = String(remotePortfolio.id);
      const localPortfolio = localById.get(portfolioId);
      if (!localPortfolio) {
        missingPortfolios.push(remotePortfolio.id);
        continue;
      }

      const remoteCash = Math.round((Number(remotePortfolio.cash) || 0) * 100) / 100;
      const localCash = Math.round((Number(localPortfolio.cash) || 0) * 100) / 100;
      if (Math.abs(remoteCash - localCash) >= 0.01) {
        cashChanges.push({ portfolioId: remotePortfolio.id, remoteCash, localCash });
      }

      const localStocksByIdentity = new Map(localPortfolio.stocks.map(stock => [stockIdentity(stock), stock]));
      const localStocksByTicker = new Map();
      for (const stock of localPortfolio.stocks) {
        const ticker = String(stock.ticker).trim().toUpperCase();
        if (!localStocksByTicker.has(ticker)) localStocksByTicker.set(ticker, []);
        localStocksByTicker.get(ticker).push(stock);
      }
      for (const remoteStock of remotePortfolio.stocks) {
        const ticker = String(remoteStock.ticker).trim().toUpperCase();
        const candidates = localStocksByTicker.get(ticker) || [];
        const localStock = remoteStock.id != null
          ? localStocksByIdentity.get(stockIdentity(remoteStock))
          : (candidates.length === 1 ? candidates[0] : null);
        if (!localStock) {
          if (candidates.length) changedHoldings.push({ portfolioId: remotePortfolio.id, ticker });
          continue;
        }
        if (stableRecord(remoteStock, 'qty') !== stableRecord(localStock, 'qty')) {
          changedHoldings.push({ portfolioId: remotePortfolio.id, ticker });
        }
      }

      const remoteQty = quantities(remotePortfolio.stocks);
      const localQty = quantities(localPortfolio.stocks);
      for (const [ticker, remoteShares] of remoteQty) {
        const localShares = localQty.get(ticker) || 0;
        const missingQty = remoteShares - localShares;
        if (missingQty <= 1e-8) continue;

        const recordedSellQty = newLocalTransactions.reduce((sum, tx) => {
          if (String(tx.portId) !== portfolioId || String(tx.ticker || '').trim().toUpperCase() !== ticker) return sum;
          if (String(tx.type || '').toLowerCase() !== 'sell') return sum;
          const qty = Number(tx.qty);
          return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
        }, 0);

        if (recordedSellQty + 1e-8 < missingQty) {
          missingHoldings.push({
            portfolioId: remotePortfolio.id,
            ticker,
            remoteQty: remoteShares,
            localQty: localShares,
            missingQty,
          });
        }
      }
    }

    return {
      missingPortfolios,
      missingHoldings,
      missingTransactions,
      changedHoldings,
      changedTransactions,
      cashChanges,
      changedBackupFields,
      invalidSnapshot: false,
      hasLoss: changedBackupFields.length > 0 || missingPortfolios.length > 0 || missingHoldings.length > 0 || missingTransactions.length > 0 ||
        changedHoldings.length > 0 || changedTransactions.length > 0 || cashChanges.length > 0,
    };
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function validateImportedBackup(data) {
    const fail = () => ({ ok: false, error: 'Backup contains unsafe markup or invalid identifiers' });
    const safeId = /^[A-Za-z0-9_-]{1,48}$/;
    const safeTicker = /^[A-Za-z0-9][A-Za-z0-9._^$()&-]{0,31}$/;
    const unsafeText = /<\s*\/?\s*[a-z][^>]*>|(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i;
    if (!data || typeof data !== 'object' || !Array.isArray(data.portfolios)) return fail();
    for (const portfolio of data.portfolios) {
      if (!portfolio || typeof portfolio.id !== 'string' || !safeId.test(portfolio.id) ||
          typeof portfolio.type !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(portfolio.type) ||
          (portfolio.color && !/^#[0-9a-f]{6}$/i.test(portfolio.color)) || !Array.isArray(portfolio.stocks)) return fail();
      for (const stock of portfolio.stocks) {
        if (!stock || typeof stock.ticker !== 'string' || !safeTicker.test(stock.ticker) ||
            (stock.id != null && !Number.isSafeInteger(Number(stock.id)))) return fail();
      }
    }
    if (data.transactions != null && !Array.isArray(data.transactions)) return fail();
    if (data.transactions && data.transactions.some(tx => !tx ||
        (tx.id != null && !Number.isSafeInteger(Number(tx.id))) ||
        (tx.portId != null && (typeof tx.portId !== 'string' || !safeId.test(tx.portId))))) return fail();
    if (data.watchlist != null) {
      if (!Array.isArray(data.watchlist)) return fail();
      for (const item of data.watchlist) {
        if (typeof item === 'string') {
          if (!safeTicker.test(item)) return fail();
        } else if (!item || typeof item !== 'object' || typeof item.ticker !== 'string' || !safeTicker.test(item.ticker) ||
                   (item.id != null && !Number.isSafeInteger(Number(item.id)))) return fail();
      }
    }

    function inspect(value, key = '') {
      if (typeof value === 'string') {
        if (unsafeText.test(value)) return false;
        if (['ticker', 'parentTicker', 'drTicker'].includes(key) && value && !safeTicker.test(value)) return false;
        if (key === 'link' && value && !/^https?:\/\//i.test(value.trim())) return false;
        if (key === 'color' && value && !/^#[0-9a-f]{6}$/i.test(value)) return false;
        return true;
      }
      if (Array.isArray(value)) return value.every(v => inspect(v, key));
      if (value && typeof value === 'object') return Object.entries(value).every(([k, v]) => {
        if (k === 'id' && v != null && !(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) &&
            !(typeof v === 'string' && safeId.test(v))) return false;
        if (k === 'portId' && v != null && (typeof v !== 'string' || !safeId.test(v))) return false;
        return inspect(v, k);
      });
      return true;
    }
    return inspect(data) ? { ok: true } : fail();
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value == null ? '' : value).trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
      return '';
    }
  }

  return { findSnapshotLosses, validateImportedBackup, escapeHTML, safeExternalUrl };
});
