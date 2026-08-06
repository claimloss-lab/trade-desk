// functions/api/insider.js
// SEC EDGAR insider trading (Form 4) lookup for US-listed tickers.
// Free, no API key required — SEC just asks for a real contact in the User-Agent.
// (redeploy trigger: SEC_CONTACT_EMAIL set 2026-08-06)
// Set a Cloudflare Pages env var SEC_CONTACT_EMAIL (e.g. "TradeDesk yourname@email.com")
// so SEC can reach you if there's ever an issue; falls back to a generic UA if unset.

const MAX_FILINGS_PER_TICKER = 2; // keep subrequest count low (Workers free plan cap: 50/request)
const MAX_TICKERS_PER_CALL = 15;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const tickersParam = url.searchParams.get('tickers') || '';
  const tickers = [...new Set(
    tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  )].slice(0, MAX_TICKERS_PER_CALL);

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: 'missing tickers' }), { status: 400, headers: cors });
  }

  const contact = context.env?.SEC_CONTACT_EMAIL || 'TradeDesk personal-use contact@example.com';
  const secHeaders = { 'User-Agent': contact, 'Accept-Encoding': 'gzip, deflate' };

  try {
    const cikMap = await getCikMap(secHeaders);
    const results = {};
    const errors = {};

    // Process sequentially in small batches to stay polite to SEC and under subrequest limits
    const batchSize = 4;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      await Promise.all(batch.map(async (t) => {
        try {
          const rows = await fetchInsiderForTicker(t, cikMap, secHeaders);
          results[t] = rows;
        } catch (e) {
          errors[t] = String(e.message || e);
        }
      }));
    }

    return new Response(JSON.stringify({ results, errors, generatedAt: Date.now() }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: cors });
  }
}

async function getCikMap(secHeaders) {
  // Cached at the edge for a day — this file is ~800KB and rarely changes
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: secHeaders,
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!res.ok) throw new Error('company_tickers.json fetch failed: ' + res.status);
  const data = await res.json();
  const map = {};
  for (const key in data) {
    const row = data[key];
    if (row?.ticker) map[row.ticker.toUpperCase()] = String(row.cik_str).padStart(10, '0');
  }
  return map;
}

async function fetchInsiderForTicker(ticker, cikMap, secHeaders) {
  const cik = cikMap[ticker];
  if (!cik) return { error: 'ticker not found in SEC EDGAR', filings: [] };

  const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: secHeaders,
    cf: { cacheTtl: 3600 },
  });
  if (!subRes.ok) throw new Error('submissions fetch failed: ' + subRes.status);
  const sub = await subRes.json();

  const recent = sub?.filings?.recent;
  if (!recent?.form) return { cik, filings: [] };

  const cikNum = String(Number(cik)); // strip leading zeros for the archive path

  const form4Indexes = [];
  for (let i = 0; i < recent.form.length && form4Indexes.length < MAX_FILINGS_PER_TICKER; i++) {
    if (recent.form[i] === '4') form4Indexes.push(i);
  }

  const filings = [];
  for (const idx of form4Indexes) {
    const accession = recent.accessionNumber[idx];
    const primaryDoc = recent.primaryDocument[idx];
    const filingDate = recent.filingDate[idx];
    if (!primaryDoc) continue;
    const accessionNoDashes = accession.replace(/-/g, '');
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDashes}/${primaryDoc}`;
    try {
      const docRes = await fetch(docUrl, { headers: secHeaders, cf: { cacheTtl: 21600 } });
      if (!docRes.ok) continue;
      const xml = await docRes.text();
      const parsed = parseForm4Xml(xml, filingDate, accession);
      if (parsed) filings.push(parsed);
    } catch (e) {
      // Skip filings we can't parse — don't fail the whole ticker
    }
  }

  return { cik, filings };
}

// Lightweight regex-based extraction of the standard EDGAR ownership XML schema.
// Not a full XML parser, but the schema has been stable since 2003 and this
// covers the fields useful for a signal panel.
function parseForm4Xml(xml, filingDate, accession) {
  const tag = (src, name) => {
    const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null;
  };
  const block = (src, name) => {
    const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return m ? m[1] : '';
  };

  const ownerBlock = block(xml, 'reportingOwner');
  const ownerName = tag(ownerBlock, 'rptOwnerName') || 'ไม่ทราบชื่อ';
  const relBlock = block(ownerBlock, 'reportingOwnerRelationship');
  const isDirector = tag(relBlock, 'isDirector') === '1';
  const isOfficer = tag(relBlock, 'isOfficer') === '1';
  const officerTitle = tag(relBlock, 'officerTitle');

  const txBlocks = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)];
  const transactions = txBlocks.map(m => {
    const tx = m[1];
    const codeBlock = block(tx, 'transactionCoding');
    const amtBlock = block(tx, 'transactionAmounts');
    const code = tag(codeBlock, 'transactionCode');
    const shares = tag(block(amtBlock, 'transactionShares'), 'value');
    const price = tag(block(amtBlock, 'transactionPricePerShare'), 'value');
    const acqDisp = tag(block(amtBlock, 'transactionAcquiredDisposedCode'), 'value');
    const txDate = tag(block(tx, 'transactionDate'), 'value') || filingDate;
    return {
      date: txDate,
      code, // P=open-market buy, S=sale, A=grant/award, M=option exercise, G=gift, F=tax withholding, etc.
      acquiredDisposed: acqDisp, // A = acquired (bullish-ish), D = disposed (bearish-ish)
      shares: shares ? Number(shares) : null,
      pricePerShare: price ? Number(price) : null,
    };
  }).filter(t => t.code);

  if (!transactions.length) return null; // e.g. derivative-only filings (option grants) — skip for v1

  return {
    filingDate,
    accession,
    ownerName,
    isDirector,
    isOfficer,
    officerTitle,
    transactions,
  };
}
