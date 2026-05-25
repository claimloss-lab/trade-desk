// functions/api/md-to-docx.js
// แปลง Markdown → .docx (OOXML) ด้วย pure-JS รันบน Cloudflare edge (ไม่พึ่ง npm)
// รับ: { markdown, title }   คืน: { base64, filename }
export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { markdown, title } = await context.request.json();
    if (!markdown) return new Response(JSON.stringify({ error: 'missing markdown' }), { status: 400, headers: cors });

    const paras = mdToParagraphs(markdown);
    const documentXml = buildDocumentXml(paras);
    const zipBytes = await buildDocx(documentXml);
    const base64 = bytesToBase64(zipBytes);
    const filename = (title || 'report').replace(/[^\w.\-ก-๙]+/g, '_') + '.docx';

    return new Response(JSON.stringify({ base64, filename }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

/* ---------- Markdown → paragraph model ---------- */
function mdToParagraphs(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { out.push({ type: 'space' }); continue; }
    let m;
    if ((m = line.match(/^#\s+(.*)/)))   { out.push({ type: 'h1', runs: inline(m[1]) }); continue; }
    if ((m = line.match(/^##\s+(.*)/)))  { out.push({ type: 'h2', runs: inline(m[1]) }); continue; }
    if ((m = line.match(/^###\s+(.*)/))) { out.push({ type: 'h3', runs: inline(m[1]) }); continue; }
    if ((m = line.match(/^[-*]\s+(.*)/))){ out.push({ type: 'bullet', runs: inline(m[1]) }); continue; }
    if ((m = line.match(/^>\s?(.*)/)))   { out.push({ type: 'quote', runs: inline(m[1]) }); continue; }
    out.push({ type: 'p', runs: inline(line) });
  }
  return out;
}

// inline parser: **bold**, *italic*, `code` → runs with flags
function inline(text) {
  const runs = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ t: m[2], b: true });
    else if (m[3] !== undefined) runs.push({ t: m[3], i: true });
    else if (m[4] !== undefined) runs.push({ t: m[4], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs.length ? runs : [{ t: text }];
}

/* ---------- paragraph model → document.xml ---------- */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function runXml(r) {
  const props = [];
  if (r.b) props.push('<w:b/>');
  if (r.i) props.push('<w:i/>');
  if (r.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
}
function paraXml(p) {
  if (p.type === 'space') return '<w:p/>';
  const runs = (p.runs || []).map(runXml).join('');
  let pPr = '';
  if (p.type === 'h1') pPr = '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>';
  else if (p.type === 'h2') pPr = '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>';
  else if (p.type === 'h3') pPr = '<w:pPr><w:pStyle w:val="Heading3"/></w:pPr>';
  else if (p.type === 'bullet') pPr = '<w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
  else if (p.type === 'quote') pPr = '<w:pPr><w:pStyle w:val="Quote"/><w:ind w:left="360"/></w:pPr>';
  return `<w:p>${pPr}${runs}</w:p>`;
}
function buildDocumentXml(paras) {
  const body = paras.map(paraXml).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

/* ---------- static OOXML parts ---------- */
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const FONT = 'Tahoma'; // รองรับไทย
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="300" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1A7A4C"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="1A7A4C"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="1A7A4C"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="5A5A5A"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="560" w:hanging="280"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

/* ---------- minimal ZIP writer (store, no compression) + CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function strBytes(s) { return new TextEncoder().encode(s); }

async function buildDocx(documentXml) {
  const files = [
    { name: '[Content_Types].xml', data: strBytes(CONTENT_TYPES) },
    { name: '_rels/.rels', data: strBytes(RELS) },
    { name: 'word/_rels/document.xml.rels', data: strBytes(DOC_RELS) },
    { name: 'word/document.xml', data: strBytes(documentXml) },
    { name: 'word/styles.xml', data: strBytes(STYLES) },
    { name: 'word/numbering.xml', data: strBytes(NUMBERING) },
  ];

  const localParts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = strBytes(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // local file header
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);     // version needed
    dv.setUint16(6, 0, true);      // flags
    dv.setUint16(8, 0, true);      // method: store
    dv.setUint16(10, 0, true);     // time
    dv.setUint16(12, 0, true);     // date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);  // compressed size
    dv.setUint32(22, size, true);  // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);     // extra len
    lh.set(nameBytes, 30);

    localParts.push(lh, f.data);

    // central directory record
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);     // version made by
    cv.setUint16(6, 20, true);     // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);     // method
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);     // extra
    cv.setUint16(32, 0, true);     // comment
    cv.setUint16(34, 0, true);     // disk
    cv.setUint16(36, 0, true);     // internal attrs
    cv.setUint32(38, 0, true);     // external attrs
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + f.data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const all = [...localParts, ...central, eocd];
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of all) { out.set(part, pos); pos += part.length; }
  return out;
}

/* ---------- base64 ---------- */
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
