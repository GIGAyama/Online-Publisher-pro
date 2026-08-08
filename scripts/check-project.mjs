#!/usr/bin/env node
/**
 * GIGA Standard v4 品質ゲート
 *
 * 使い方:  node scripts/check-project.mjs
 *          npm run check
 *
 * 設定は quality.config.json に置く。
 * 既存の実装が落ちる場合でも検査を緩めないこと。どうしても通せない項目は
 * quality.config.json の securityExceptions に「理由」を書いて明示的に許可する。
 * （黙って閾値を上げると、次の人が「元から問題なかった」と勘違いする）
 *
 * 依存パッケージなし。Node 18 以降で動く。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CONFIG = JSON.parse(read('quality.config.json'));

const results = [];
let failed = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}
function sizeOf(rel) {
  return fs.statSync(path.join(ROOT, rel)).size;
}
function kb(n) {
  return (n / 1024).toFixed(1) + ' KB';
}
/**
 * コメントを取り除く。
 * 「localStorage を操作しない」と説明した日本語コメントまで違反と数えてしまい、
 * 直しようのない不合格が出ていたため、実際のコードだけを見るようにする。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* ... */
    .replace(/(^|[^:])\/\/.*$/gm, '$1')  // // ...（URLの // を消さないよう直前1文字を見る）
    .replace(/<!--[\s\S]*?-->/g, ' ');   // <!-- ... -->
}

/** id: 監査表の記号 / label: 人間が読む説明 / ok: 判定 / detail: 実測値 */
function check(id, label, ok, detail = '') {
  results.push({ id, label, ok, detail });
  if (!ok) failed++;
}

// ─────────────────────────────────────────────
// A. 法務・配布
// ─────────────────────────────────────────────
check('A1', 'LICENSE の実ファイルがある', exists('LICENSE'));
check('A2', '.gitignore がある', exists('.gitignore'));
check('A3', '.github/dependabot.yml がある', exists('.github/dependabot.yml'));
check('A4', 'README.md と MANUAL.md の両方がある', exists('README.md') && exists('MANUAL.md'));

if (exists('.gitignore')) {
  const gi = read('.gitignore');
  check('A2b', '.gitignore が .clasp.json と .env を無視している',
    gi.includes('.clasp.json') && gi.includes('.env'));
}

// ─────────────────────────────────────────────
// B. セキュリティ
// ─────────────────────────────────────────────
const sources = CONFIG.sourceGlobs.filter(exists);
// コメント内の記述を違反と数えないよう、判定はコメントを除いた本文で行う
const allSource = sources.map((f) => ({ file: f, text: stripComments(read(f)) }));

const clearHits = allSource.filter((s) => /localStorage\s*\.\s*clear\s*\(/.test(s.text));
check('C5', 'localStorage.clear() を使っていない', clearHits.length === 0,
  clearHits.map((h) => h.file).join(', '));

const pmHits = allSource.filter((s) => /postMessage\s*\([^)]*['"]\*['"]/.test(s.text));
check('B4', 'postMessage の宛先が "*" になっていない', pmHits.length === 0,
  pmHits.map((h) => h.file).join(', '));

// APIキー・スプレッドシートIDの直書き（よくある形だけを見る）
const secretPatterns = [
  { name: 'Google APIキー', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'スプレッドシートID', re: /['"][a-zA-Z0-9_-]{44}['"]/ },
];
const secretHits = [];
for (const s of allSource) {
  for (const p of secretPatterns) {
    const m = s.text.match(p.re);
    if (m) secretHits.push(`${s.file}: ${p.name}らしき文字列`);
  }
}
check('B2', '秘密情報・IDの直書きが無い', secretHits.length === 0, secretHits.join(' / '));

// ─────────────────────────────────────────────
// D. 表示
// ─────────────────────────────────────────────
const d = CONFIG.displayChecks;

for (const f of d.requireViewportFitCover.filter(exists)) {
  check('D1', `${f} の viewport に viewport-fit=cover がある`,
    /viewport-fit\s*=\s*cover/.test(read(f)));
}
for (const f of d.requireViewportFitCover.filter(exists)) {
  // 児童も使う画面なので、拡大禁止は入れない（アクセシビリティ上の後退）
  check('D1b', `${f} に user-scalable=no が入っていない`,
    !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(read(f)));
}
for (const f of d.requireDvh.filter(exists)) {
  const t = read(f);
  const hasBare100vh = /100vh/.test(t);
  const hasDvh = /100dvh/.test(t);
  // 100vh 単独は禁止。フォールバックとして dvh と併記されていれば可。
  check('D2', `${f} が 100dvh を使っている（100vh 単独でない）`, !hasBare100vh || hasDvh,
    hasBare100vh && !hasDvh ? '100vh のみ' : '');
}
for (const f of d.requireSafeArea.filter(exists)) {
  check('D3', `${f} が safe-area-inset を適用している`, /safe-area-inset/.test(read(f)));
}
for (const f of d.requireFluidType.filter(exists)) {
  check('D4', `${f} が clamp() の可変文字サイズを使っている`, /clamp\s*\(/.test(read(f)));
}
for (const f of d.requireReducedMotion.filter(exists)) {
  check('D10', `${f} が prefers-reduced-motion に対応している`,
    /prefers-reduced-motion/.test(read(f)));
}
for (const f of d.requirePrintCss.filter(exists)) {
  const t = read(f);
  check('D12', `${f} に印刷用CSSがある`, /@media\s+print/.test(t));
  check('D12b', `${f} の印刷CSSに print-color-adjust:exact がある`,
    /print-color-adjust\s*:\s*exact/.test(t),
    '無いと原稿用紙のマス目と添削の赤線が印刷されない');
}

// Canvas の DPR 補正（画面表示用の Canvas がある場合のみ必須）
for (const s of allSource) {
  if (!/getContext\(['"]2d['"]\)/.test(s.text)) continue;
  // document.createElement('canvas') だけで DOM に載せない＝オフスクリーン用途。
  // 画像の縮小などに使うもので、DPR 補正はむしろ有害なので対象外とする。
  const isOffscreenOnly = !/<canvas/i.test(s.text) && !/canvasRef/.test(s.text);
  if (isOffscreenOnly) {
    check('D5', `${s.file} の Canvas はオフスクリーン用途（DPR補正の対象外）`, true, '画像縮小用');
  } else {
    check('D5', `${s.file} の Canvas に devicePixelRatio 補正がある`,
      /devicePixelRatio/.test(s.text));
  }
}

// ─────────────────────────────────────────────
// E. PWA
// ─────────────────────────────────────────────
const sh = CONFIG.shell;
if (sh && exists(sh.manifest)) {
  const mf = JSON.parse(read(sh.manifest));
  const base = '/' + CONFIG.repoName + '/';
  for (const key of ['id', 'start_url', 'scope']) {
    check('E1', `manifest の ${key} がリポジトリ名の絶対パスになっている`,
      typeof mf[key] === 'string' && mf[key].startsWith(base),
      String(mf[key]));
  }

  const icons = mf.icons || [];
  const has = (size, purpose) => icons.some((i) =>
    String(i.sizes).includes(size) && String(i.purpose || 'any').includes(purpose));
  check('E2', 'manifest に 192/512 の any と maskable が揃っている',
    has('192x192', 'any') && has('512x512', 'any') &&
    has('192x192', 'maskable') && has('512x512', 'maskable'));

  // manifest が指すアイコンが実在するか
  const missing = icons
    .map((i) => path.posix.join(sh.dir, i.src.replace(/^\.\//, '')))
    .filter((p) => !exists(p));
  check('E2b', 'manifest のアイコンが実在する', missing.length === 0, missing.join(', '));

  check('E2c', 'apple-touch-icon がある（iOS は maskable に非対応）',
    exists(path.posix.join(sh.dir, 'icons/apple-touch-icon.png')));
}

if (sh && exists(sh.html)) {
  const t = read(sh.html);
  const headEnd = t.indexOf('</head>');
  const head = headEnd >= 0 ? t.slice(0, headEnd) : t;
  const bipAt = head.indexOf('beforeinstallprompt');
  const manifestAt = head.indexOf('rel="manifest"');
  // Chrome は条件が揃うと即座に合図を出す。重い読み込みより先に受け取ること。
  check('E3', 'beforeinstallprompt を <head> の最上部で捕まえている',
    bipAt >= 0 && (manifestAt < 0 || bipAt < manifestAt),
    bipAt < 0 ? '見つからない' : `head内 ${bipAt} 文字目`);

  check('E4', 'インストールボタンがアプリ内にある', /install/i.test(t) && /<button/.test(t));
  check('E7', '更新のお知らせを出している',
    /SKIP_WAITING/.test(t) && /あたらしい|新しいバージョン|更新/.test(t));
  check('E10', 'apple-touch-icon を参照している', /rel="apple-touch-icon"/.test(t));
}

if (sh && exists(sh.serviceWorker)) {
  const t = read(sh.serviceWorker);
  const code = stripComments(t);
  check('E5', 'sw.js が自アプリ接頭辞のキャッシュだけを削除している',
    /CACHE_PREFIX/.test(code) && /startsWith\(\s*CACHE_PREFIX\s*\)/.test(code),
    '同一オリジンの他アプリを巻き添えにしないため');
  check('E6', 'sw.js が localStorage に触れていない', !/localStorage/.test(stripComments(t)),
    '児童の書きかけ（monogatari_maker_pro_autosave 等）に触れないこと');
  check('E9', 'sw.js に APP_VERSION がある', /APP_VERSION/.test(t));
  check('E11', 'sw.js の precache が addAll で全滅しない',
    !/cache\.addAll\(/.test(code),
    'addAll は1本の失敗で全体が落ち、オフライン起動できなくなる');
  check('E8b', 'sw.js が offline.html にフォールバックする', /offline\.html/.test(t));
}
if (sh) check('E8', 'offline.html がある', exists(sh.offlinePage));

// ─────────────────────────────────────────────
// F. 性能・保守性
// ─────────────────────────────────────────────
for (const f of sources) {
  const bytes = sizeOf(f);
  const lines = read(f).split('\n').length;
  check('F4', `${f} が 400KB / 5,000行 以内`,
    bytes <= CONFIG.limits.maxSourceBytes && lines <= CONFIG.limits.maxSourceLines,
    `${kb(bytes)} / ${lines}行`);
}

// 画像サイズ（securityExceptions のパスは理由付きで許可）
const exceptions = CONFIG.securityExceptions || [];
const isExcepted = (rel) => exceptions.find((e) => rel.startsWith(e.path));

function walkImages(dir) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    const rel = path.posix.join(dir, name);
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) continue;
    if (/\.(png|jpe?g|webp|gif)$/i.test(name)) out.push(rel);
  }
  return out;
}

const images = (CONFIG.imageDirs || []).flatMap(walkImages);
for (const rel of images) {
  const bytes = sizeOf(rel);
  let limit = CONFIG.limits.maxImageBytes;
  if (/icon-.*512\.png$/.test(rel)) limit = CONFIG.limits.maxIcon512Bytes;
  if (/favicon\.png$/.test(rel)) limit = CONFIG.limits.maxFaviconBytes;
  const ex = isExcepted(rel);
  if (ex) {
    check('D7', `${rel}（例外として許可: ${ex.id}）`, true, kb(bytes));
  } else {
    check('D7', `${rel} が ${kb(limit)} 以内`, bytes <= limit, kb(bytes));
  }
}

// ─────────────────────────────────────────────
// 出力
// ─────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length;
console.log('');
console.log('  GIGA Standard v4 品質ゲート — ' + CONFIG.repoName + '（' + CONFIG.architecture + '型）');
console.log('  ' + '─'.repeat(66));
for (const r of results) {
  const mark = r.ok ? '  ✅' : '  ❌';
  console.log(`${mark} [${r.id}] ${r.label}${r.detail ? '  … ' + r.detail : ''}`);
}
console.log('  ' + '─'.repeat(66));
console.log(`  ${pass} / ${results.length} 項目が合格`);

if (exceptions.length) {
  console.log('');
  console.log('  明示的に許可している例外（理由つき）:');
  for (const e of exceptions) console.log(`    ・${e.id}（${e.path}）— ${e.reason}`);
}
console.log('');

if (failed > 0) {
  console.error(`  ❌ ${failed} 項目が不合格です。閾値を緩めず、直すか securityExceptions に理由を書いてください。`);
  process.exit(1);
}
console.log('  ✅ すべて合格しました。');
