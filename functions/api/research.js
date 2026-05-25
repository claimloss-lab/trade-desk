// functions/api/research.js
// Initiating Coverage generator — Claude Opus 4.7 + native web search
// รับ: { ticker, name, sector, lang }   คืน: { ticker, markdown, model }
export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { ticker, name, sector, lang } = await context.request.json();
    if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

    const isEN = lang === 'en';
    const langInstr = isEN
      ? 'Write the entire report in English.'
      : 'เขียนรายงานทั้งหมดเป็นภาษาไทย (ใส่หัวข้อภาษาอังกฤษในวงเล็บได้) คงตัวเลข ticker และชื่อเฉพาะไว้ตามต้นฉบับ';

    const system = `You are a senior equity research analyst. You produce concise, accurate Initiating Coverage notes grounded ONLY in data you verify via web search. Always search for the latest quarterly results, market data, and recent news before writing. Never fabricate figures — if a number cannot be verified, state that explicitly. Prefer primary sources (company filings, press releases) over aggregators.`;

    const userPrompt = `Act as an Equity Research Analyst covering the ${sector || 'relevant'} sector. First, use web search to gather the latest filings, quarterly financials, market data, and recent news for ${ticker} (${name || ticker}). Then synthesize an Initiating Coverage summary.

The report MUST include these four sections:
1. Business Description — what the company does and how it makes money (include segment breakdown if available).
2. Competitive Moat — analyze top moats (brand, network effects, switching costs, IP, scale).
3. Industry Overview — market size, growth rates, competitive landscape, and regulatory/geopolitical trends.
4. Financial Overview — historical margin trends, growth track record, and capital allocation (buybacks, dividends, capex).

Formatting rules (IMPORTANT):
- Output a clean Markdown report and NOTHING else (no preamble, no closing chat).
- "# ${ticker} — Initiating Coverage" as the H1 title.
- One italic line under the title noting the latest reported period (e.g. *as of <date> · latest: Q_ FY____*).
- "## " for each of the 4 numbered sections; "### " for sub-points.
- Begin each section with a bolded "**Key takeaway:** ..." line.
- Use "- " bullets for details; cite figures inline (e.g. "Q1 FY2027: $81.6B"). Mark estimates as estimates.
- End with "## Risks to Watch" (bullets) and a final one-line italic disclaimer that this is informational, not investment advice.
- ${langInstr}`;

    if (!context.env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY ไม่ได้ตั้งค่าใน Cloudflare (Settings → Environment variables)' }), { status: 500, headers: cors });
    }

    // เรียก Claude — ลองพร้อม web search ก่อน ถ้าพลาด (เช่น web search ยังไม่เปิดใน org) ค่อย retry แบบไม่มี web search
    async function callClaude(useWebSearch) {
      const body = {
        model: 'claude-opus-4-7',
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      };
      if (useWebSearch) body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }];
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': context.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      return r;
    }

    let res = await callClaude(true);
    let usedWebSearch = true;
    if (!res.ok) {
      // web-search อาจยังไม่เปิดใน org → retry without tools so a report still generates
      const firstErr = await res.text();
      const retry = await callClaude(false);
      if (!retry.ok) {
        const secondErr = await retry.text();
        return new Response(JSON.stringify({ error: 'Claude error', detail: firstErr, retryDetail: secondErr }), { status: 502, headers: cors });
      }
      res = retry;
      usedWebSearch = false;
    }

    const data = await res.json();
    const markdown = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (!markdown) {
      return new Response(JSON.stringify({ error: 'empty result', detail: JSON.stringify(data).slice(0, 500) }), { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({ ticker, markdown, model: data.model || 'claude-opus-4-7', webSearch: usedWebSearch }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
