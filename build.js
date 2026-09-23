#!/usr/bin/env node
/*
 * build.js — membuat versi statis Bengkel Digital agar semua aplikasi terbaca Google.
 *
 * Cara pakai (butuh Node.js 18 ke atas, tanpa install paket apa pun):
 *   1. Taruh file ini satu folder dengan index.html
 *   2. Jalankan:   SITE_URL=https://alamat-website-anda.com node build.js
 *   3. Upload isi folder dist/ ke hosting (hasil build ada di sana)
 *
 * Yang dihasilkan di dist/:
 *   index.html                     halaman induk, daftar semua aplikasi sudah tertulis di HTML
 *   aplikasi/<nama-aplikasi>/      satu halaman untuk setiap aplikasi (bisa muncul sendiri di Google)
 *   sitemap.xml, robots.txt        petunjuk untuk mesin pencari
 *
 * Jalankan ulang skrip ini setiap kali menambah, mengubah, atau menghapus aplikasi.
 */

const fs = require('fs');
const path = require('path');

/* ====== PENGATURAN ====== */
// GANTI dengan alamat asli website Anda (tanpa garis miring di akhir).
const SITE_URL = (process.env.SITE_URL || 'https://siakadsdntanjung-glitch.github.io/BENGKEL-DIGITAL').replace(/\/+$/, '');
const SITE_NAME = 'Aplikasi Sekolah';
/* ======================== */

const SRC = path.join(__dirname, 'index.html');
const OUT = path.join(__dirname, 'dist');
const COLORS = ['teal', 'brass', 'rust', 'plum', 'steel', 'olive'];

const tpl = fs.readFileSync(SRC, 'utf8');
const projectId = process.env.FIREBASE_PROJECT_ID || (tpl.match(/projectId:\s*"([^"]+)"/) || [])[1];
const apiKey = process.env.FIREBASE_API_KEY || (tpl.match(/apiKey:\s*"([^"]+)"/) || [])[1];
const FIRESTORE = process.env.FIRESTORE_URL || 'https://firestore.googleapis.com';

/* ---------- Utilitas ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function norm(s) { return String(s || '').toLowerCase(); }
function colorOf(p) { return COLORS.indexOf(p.color) !== -1 ? p.color : 'teal'; }
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}
function jsonLd(obj) {
  return '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2).replace(/</g, '\\u003c') + '\n</script>';
}

/* Alamat halaman tiap aplikasi. Aturannya HARUS sama dengan yang ada di index.html. */
function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'aplikasi';
}
function assignSlugs(list) {
  const used = {};
  list.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((p) => {
    const base = slugify(p.title);
    let slug = base, n = 0;
    while (used[slug]) { n++; slug = base + '-' + slugify(p.id).slice(0, 6) + (n > 1 ? '-' + n : ''); }
    used[slug] = true;
    p.slug = slug;
  });
}

/* ---------- Ambil data dari Firestore (REST) ---------- */
function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(f) {
  const o = {};
  Object.keys(f).forEach((k) => { o[k] = decodeValue(f[k]); });
  return o;
}

async function fetchProducts() {
  if (!projectId || !apiKey) throw new Error('projectId/apiKey Firebase tidak ditemukan di index.html');
  const out = [];
  let token = '';
  do {
    const url = FIRESTORE + '/v1/projects/' + projectId + '/databases/(default)/documents/products' +
      '?pageSize=300&key=' + encodeURIComponent(apiKey) + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Firestore membalas ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const json = await res.json();
    (json.documents || []).forEach((d) => {
      const p = decodeFields(d.fields || {});
      p.id = d.name.split('/').pop();
      p.updated = (d.updateTime || '').slice(0, 10);
      out.push(p);
    });
    token = json.nextPageToken || '';
  } while (token);
  return out;
}

/* ---------- Potongan HTML ---------- */
// Harus menghasilkan struktur yang sama dengan cardHtml() di index.html.
function cardHtml(p) {
  const c = colorOf(p);
  const href = 'aplikasi/' + p.slug + '/';
  const first = p.links && p.links[0];
  const open = first
    ? '<a class="btn compact" style="background:var(--c-' + c + ');color:#fff;" href="' + esc(first.url) + '" target="_blank" rel="noopener">' + esc(first.label) + '</a>'
    : '<span class="btn compact disabled">Segera hadir</span>';
  return (
    '<article class="card" data-id="' + esc(p.id) + '" style="border-left-color:var(--c-' + c + ');">' +
      '<div class="card-head">' +
        '<div class="mark" style="background:var(--c-' + c + '-soft);color:var(--c-' + c + ');">' + esc(p.mark) + '</div>' +
        '<div class="card-title"><h2><a class="card-link" href="' + href + '">' + esc(p.title) + '</a></h2><div class="role">' + esc(p.role) + '</div></div>' +
      '</div>' +
      (p.desc ? '<p class="desc">' + esc(p.desc) + '</p>' : '') +
      '<div class="card-foot">' + open + '<a class="btn ghost detail-btn" href="' + href + '">Detail</a></div>' +
    '</article>'
  );
}

function replaceBetween(html, startMarker, endMarker, content) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker);
  if (a < 0 || b < a) throw new Error('Penanda ' + startMarker + ' ... ' + endMarker + ' tidak ditemukan di index.html');
  return html.slice(0, a + startMarker.length) + '\n' + content + '\n' + html.slice(b);
}

function homeSeo(list) {
  const url = SITE_URL + '/';
  const names = list.map((p) => p.title);
  let desc = SITE_NAME + ' menyediakan ' + (names.length ? names.slice(0, 3).join(', ') : 'aplikasi sekolah') +
    ', dan layanan sekolah lainnya — gratis, online, dan sudah dipakai sekolah dasar dari berbagai kecamatan, kabupaten, dan provinsi di Indonesia.';
  if (desc.length > 300) desc = desc.slice(0, 297).replace(/\s+\S*$/, '') + '…';
  const title = SITE_NAME + ' — Aplikasi Rapor Digital & Keuangan BOSP Sekolah Gratis';
  return [
    '<meta name="description" content="' + esc(desc) + '">',
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="id_ID">',
    '<meta property="og:site_name" content="' + esc(SITE_NAME) + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta name="twitter:card" content="summary">',
    jsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': url + '#org', name: SITE_NAME, url: url },
        { '@type': 'WebSite', '@id': url + '#website', url: url, name: SITE_NAME, inLanguage: 'id', publisher: { '@id': url + '#org' } },
        {
          '@type': 'ItemList',
          name: 'Daftar aplikasi ' + SITE_NAME,
          numberOfItems: list.length,
          itemListElement: list.map((p, idx) => ({
            '@type': 'ListItem', position: idx + 1, name: p.title, url: SITE_URL + '/aplikasi/' + p.slug + '/'
          }))
        }
      ]
    })
  ].join('\n');
}

/* ---------- Halaman satu aplikasi ---------- */
const styleBlock = (tpl.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const fontLinks = (tpl.match(/<link[^>]+fonts\.g[^>]*>/g) || []).join('\n');

const PAGE_CSS = `
<style>
  .app-page { max-width: 760px; padding: 36px 24px 24px; }
  .app-detail { background: var(--paper-raised); border: 1px solid var(--line); border-top-width: 4px; border-radius: 12px; padding: 30px; }
  .app-detail h1 { font-size: clamp(1.7rem, 4vw, 2.3rem); line-height: 1.2; }
  .app-detail .role { font-size: 0.95rem; color: var(--ink-soft); margin-top: 4px; }
  .app-detail .desc { margin: 20px 0 0; color: var(--ink-soft); max-width: 62ch; white-space: pre-line; }
  .app-detail .features { margin-top: 18px; }
  .others { margin-top: 40px; }
  .others h2 { font-size: 1.15rem; margin-bottom: 12px; }
  .others ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; }
  .others a { display: block; padding: 8px 0; color: var(--ink-soft); }
  .back { display: inline-block; margin-top: 28px; padding: 6px 0; color: var(--ink-soft); }
  .brand-link { text-decoration: none; }
  .auth-link { text-decoration: none; display: inline-block; }
</style>`;

function appPage(p, all) {
  const c = colorOf(p);
  const url = SITE_URL + '/aplikasi/' + p.slug + '/';
  const title = p.title + (p.role ? ' — ' + p.role : '') + ' | ' + SITE_NAME;
  const desc = clip(p.desc || p.role || p.title, 155);
  const links = p.links && p.links.length
    ? p.links.map((l) => '<a class="btn" style="background:var(--c-' + c + ');color:#fff;" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>').join('')
    : '<span class="btn disabled">Tautan segera ditambahkan</span>';
  const features = p.features && p.features.length
    ? '<ul class="features">' + p.features.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '';

  // tautan ke aplikasi lain (membantu Google menemukan semua halaman)
  const idx = all.findIndex((x) => x.id === p.id);
  const others = all.filter((x) => x.id !== p.id);
  const start = others.length > 8 ? Math.min(idx, others.length - 8) : 0;
  const near = others.slice(start, start + 8);
  const othersHtml = near.length
    ? '<section class="others"><h2>Aplikasi lainnya</h2><ul>' +
      near.map((x) => '<li><a href="../' + x.slug + '/">' + esc(x.title) + '</a></li>').join('') + '</ul></section>'
    : '';

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      Object.assign({
        '@type': 'SoftwareApplication',
        name: p.title,
        description: p.desc || p.role || p.title,
        applicationCategory: 'WebApplication',
        url: url,
        inLanguage: 'id',
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL + '/' }
      }, p.role ? { alternateName: p.role } : {}),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL + '/' },
          { '@type': 'ListItem', position: 2, name: p.title, item: url }
        ]
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="id_ID">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
${fontLinks}
${jsonLd(ld)}
${styleBlock}${PAGE_CSS}
</head>
<body>
<header>
  <div class="wrap header-row">
    <a class="brand brand-link" href="../../">${esc(SITE_NAME)}</a>
    <div class="header-right"><a class="auth-link" href="../../">Semua aplikasi</a></div>
  </div>
</header>
<main class="wrap app-page">
  <article class="app-detail" style="border-top-color:var(--c-${c});">
    <div class="product-head-main">
      <div class="mark" style="background:var(--c-${c}-soft);color:var(--c-${c});">${esc(p.mark)}</div>
      <div><h1>${esc(p.title)}</h1><div class="role">${esc(p.role)}</div></div>
    </div>
    ${p.desc ? '<p class="desc">' + esc(p.desc) + '</p>' : ''}
    ${features}
    <div class="cta-row">${links}</div>
  </article>
  ${othersHtml}
  <a class="back" href="../../">Lihat semua aplikasi</a>
</main>
<footer class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(SITE_NAME)}</span>
  <span>Dibuat untuk memudahkan orang menemukan semua karya di satu alamat</span>
</footer>
</body>
</html>
`;
}

/* ---------- Jalankan ---------- */
async function main() {
  console.log('Mengambil data dari Firestore (' + projectId + ')...');
  const products = await fetchProducts();
  if (!products.length) throw new Error('Tidak ada aplikasi di koleksi "products". Build dibatalkan agar situs tidak menjadi kosong.');
  assignSlugs(products);
  products.sort((a, b) => norm(a.title).localeCompare(norm(b.title), 'id'));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 0. Salin ads.txt (kalau ada) agar ikut ter-deploy ke Firebase Hosting
  const adsPath = path.join(__dirname, 'ads.txt');
  if (fs.existsSync(adsPath)) {
    fs.copyFileSync(adsPath, path.join(OUT, 'ads.txt'));
    console.log('ads.txt disalin ke dist/');
  }

  // 1. Halaman induk: daftar aplikasi sudah tertulis di HTML
  let home = replaceBetween(tpl, '<!--SEO:START-->', '<!--SEO:END-->', homeSeo(products));
  home = replaceBetween(home, '<!--APPS:START-->', '<!--APPS:END-->', products.map(cardHtml).join(''));
  fs.writeFileSync(path.join(OUT, 'index.html'), home);

  // 2. Satu halaman per aplikasi
  products.forEach((p) => {
    const dir = path.join(OUT, 'aplikasi', p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), appPage(p, products));
  });

  // 3. sitemap.xml & robots.txt
  const today = new Date().toISOString().slice(0, 10);
  const newest = products.map((p) => p.updated).filter(Boolean).sort().pop() || today;
  const urls = [{ loc: SITE_URL + '/', lastmod: newest }].concat(
    products.map((p) => ({ loc: SITE_URL + '/aplikasi/' + p.slug + '/', lastmod: p.updated || today }))
  );
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + esc(u.loc) + '</loc><lastmod>' + u.lastmod + '</lastmod></url>').join('\n') +
    '\n</urlset>\n');
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');

  console.log('Selesai: ' + products.length + ' aplikasi -> folder dist/');
  console.log('Alamat situs yang dipakai: ' + SITE_URL + (process.env.SITE_URL ? '' : '  (bawaan; ganti dengan SITE_URL=... jika salah)'));
}

main().catch((e) => { console.error('Build gagal: ' + e.message); process.exit(1); });
