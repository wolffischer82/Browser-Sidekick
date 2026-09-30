// Writes the small fixture PDFs used by the PDF extractor tests
// (tests/fixtures/pdf): a text PDF, an image-only PDF (like a scan) and a
// password-protected PDF (standard security handler, RC4 128-bit, R3).
// Deterministic output; run with `node scripts/make-pdf-fixtures.mjs`.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../tests/fixtures/pdf');
const latin1 = (s) => Buffer.from(s, 'latin1');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const hex = (buf) => `<${buf.toString('hex')}>`;

/**
 * Builds a PDF from `objects` (object number = index + 1). Each object is
 * `{ dict, stream?, strings? }`: `dict` is PDF source text in which `$0`,
 * `$1`, ... stand for `strings[n]`, written as hex strings (encrypted when
 * `encrypt` is given). `stream` is a Buffer.
 */
function buildPdf(objects, { trailer, encrypt } = {}) {
  const parts = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  const offsets = [];
  let length = parts[0].length;
  const push = (buf) => {
    parts.push(buf);
    length += buf.length;
  };
  objects.forEach((obj, index) => {
    const num = index + 1;
    const crypt = (data) =>
      encrypt && !obj.plain ? rc4(encrypt.objectKey(num, 0), data) : Buffer.from(data);
    let dict = obj.dict.replace(/\$(\d+)/g, (_, n) => hex(crypt(latin1(obj.strings[Number(n)]))));
    offsets.push(length);
    if (obj.stream) {
      const data = crypt(obj.stream);
      dict = dict.replace('>>', ` /Length ${String(data.length)} >>`);
      push(latin1(`${String(num)} 0 obj\n${dict}\nstream\n`));
      push(data);
      push(latin1('\nendstream\nendobj\n'));
    } else {
      push(latin1(`${String(num)} 0 obj\n${dict}\nendobj\n`));
    }
  });
  const xrefAt = length;
  const size = objects.length + 1;
  let xref = `xref\n0 ${String(size)}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  push(latin1(xref));
  push(
    latin1(
      `trailer\n<< /Size ${String(size)} ${trailer} >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

const textContent = (lines) =>
  latin1(
    'BT /F1 14 Tf 72 720 Td 18 TL\n' +
      lines.map((line) => `(${line.replace(/[()\\]/g, '\\$&')}) Tj T*`).join('\n') +
      '\nET',
  );

const PAGE_ONE = [
  'Night trains in Europe',
  'Sleeper services returned to many routes this year.',
  'Most of them run between capitals.',
];
const PAGE_TWO = ['Operators plan more cross-border connections for the winter timetable.'];

/** Catalog, pages, font, two text pages and an info dictionary (objects 1-8). */
function textObjects(title) {
  return [
    { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { dict: '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>' },
    {
      dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    },
    { dict: '<< >>', stream: textContent(PAGE_ONE) },
    {
      dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    },
    { dict: '<< >>', stream: textContent(PAGE_TWO) },
    { dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    { dict: '<< /Title $0 /Producer $1 >>', strings: [title, 'Browser Sidekick fixtures'] },
  ];
}

// Standard security handler, revision 3 (PDF 1.7, 7.6.3.3, algorithms 2, 3, 5).
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const padded = (password) => Buffer.concat([latin1(password), PAD]).subarray(0, 32);

function securityHandler(userPassword, ownerPassword, id) {
  const n = 16;
  const permissions = -3904; // print, copy and so on allowed; only opening needs the password
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);

  let ownerKey = md5(padded(ownerPassword));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  let o = rc4(ownerKey, padded(userPassword));
  for (let i = 1; i <= 19; i++)
    o = rc4(
      ownerKey.map((b) => b ^ i),
      o,
    );

  let key = md5(padded(userPassword), o, p, id);
  for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  key = key.subarray(0, n);

  let u = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++)
    u = rc4(
      key.map((b) => b ^ i),
      u,
    );
  u = Buffer.concat([u, Buffer.alloc(16)]);

  return {
    dict: `<< /Filter /Standard /V 2 /R 3 /Length 128 /O ${hex(o)} /U ${hex(u)} /P ${String(permissions)} >>`,
    objectKey(num, gen) {
      const extra = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, 0]);
      return md5(key, extra).subarray(0, Math.min(n + 5, 16));
    },
  };
}

function textPdf() {
  return buildPdf(textObjects('Night trains in Europe'), {
    trailer: '/Root 1 0 R /Info 8 0 R',
  });
}

function encryptedPdf() {
  const id = md5(latin1('browser-sidekick-encrypted-fixture'));
  const handler = securityHandler('sidekick', 'owner-secret', id);
  const objects = [...textObjects('Locked report'), { dict: handler.dict, plain: true }];
  return buildPdf(objects, {
    trailer: `/Root 1 0 R /Info 8 0 R /Encrypt 9 0 R /ID [${hex(id)} ${hex(id)}]`,
    encrypt: handler,
  });
}

function imageOnlyPdf() {
  // A 16 x 16 grey gradient drawn over the page, as a scanner would; no text.
  const pixels = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) pixels[i] = (i % 16) * 16;
  return buildPdf(
    [
      { dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      {
        dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
      },
      { dict: '<< >>', stream: latin1('q 540 0 0 720 36 36 cm /Im1 Do Q') },
      {
        dict: '<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 >>',
        stream: pixels,
      },
      { dict: '<< /Title $0 >>', strings: ['Scanned letter'] },
    ],
    { trailer: '/Root 1 0 R /Info 6 0 R' },
  );
}

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'text.pdf'), textPdf());
await writeFile(resolve(OUT, 'encrypted.pdf'), encryptedPdf());
await writeFile(resolve(OUT, 'image-only.pdf'), imageOnlyPdf());
