// Builds docs/user-guide/<lang>/S3Browser-user-guide.<lang>.pdf from user-guide.md for every language.
// Usage: bun run --cwd docs build:pdf
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import tocDoneRight from 'markdown-it-toc-done-right';
import { chromium } from 'playwright';

const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Supported languages and the heading shown above the table of contents. */
const LANGS = {
  en: 'Contents',
  vi: 'Mục lục',
  ja: '目次',
  'zh-CN': '目录',
  'zh-TW': '目錄',
  ru: 'Содержание',
  de: 'Inhalt',
};
const FONT_CSS = [
  '@fontsource/noto-sans/400.css',
  '@fontsource/noto-sans/700.css',
  '@fontsource/noto-sans-jp/400.css',
  '@fontsource/noto-sans-jp/700.css',
  '@fontsource/noto-sans-sc/400.css',
  '@fontsource/noto-sans-sc/700.css',
  '@fontsource/noto-sans-tc/400.css',
  '@fontsource/noto-sans-tc/700.css',
];
/** Fallback font for Han characters per language (must match the :lang() rules in theme.css). */
const HAN_FONT = { ja: 'Noto Sans JP', 'zh-CN': 'Noto Sans SC', 'zh-TW': 'Noto Sans TC' };
const TOC_MARKER = '${toc}';

/** One slug function for heading ids and TOC links; keeps letters (incl. Vietnamese, CJK), drops punctuation like GitHub. */
const slugify = text =>
  encodeURIComponent(
    String(text)
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-')
  );

const md = new MarkdownIt({ html: true, linkify: true })
  .use(anchor, { slugify })
  .use(tocDoneRight, { slugify, level: [2, 3], containerClass: 'toc', listType: 'ul' });

/** Font-face rules of the bundled fonts, with url() turned into absolute file URLs. */
function loadFontCss() {
  return FONT_CSS.map(file => {
    const path = join(docsDir, 'node_modules', file);
    const base = pathToFileURL(dirname(path)).href;
    return readFileSync(path, 'utf8').replace(/url\(\.\/files\//g, `url(${base}/files/`);
  }).join('\n');
}

/** Puts the TOC after the first h1 unless the author placed the marker manually. */
function withToc(source, tocTitle) {
  if (source.includes(TOC_MARKER)) return source;
  return source.replace(/^# .+$/m, h1 => `${h1}\n\n<div class="toc-title">${tocTitle}</div>\n\n${TOC_MARKER}\n`);
}

function buildHtml(source, lang, fontCss, themeCss) {
  const body = md.render(withToc(source, LANGS[lang]));
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${fontCss}\n${themeCss}</style></head><body>${body}</body></html>`;
}

const footerFont = lang => `font:8pt 'Noto Sans','${HAN_FONT[lang] ?? 'Noto Sans JP'}',sans-serif;color:#52606d;`;
const headerTemplate = (title, lang) => `<div style="width:100%;padding:0 18mm;${footerFont(lang)}">${title}</div>`;
const footerTemplate = lang =>
  `<div style="width:100%;padding:0 18mm;${footerFont(lang)}text-align:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

async function buildLang(browser, lang, fontCss, themeCss) {
  const dir = join(docsDir, 'user-guide', lang);
  const mdFile = join(dir, 'user-guide.md');
  if (!existsSync(mdFile)) {
    console.warn(`[skip] ${mdFile} not found`);
    return;
  }
  const source = readFileSync(mdFile, 'utf8');
  const title = source.match(/^# (.+)$/m)?.[1] ?? 'S3Browser';
  // Written next to the markdown so relative image paths (images/...) resolve.
  const htmlFile = join(dir, '.user-guide.tmp.html');
  writeFileSync(htmlFile, buildHtml(source, lang, fontCss, themeCss));
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const out = join(dir, `S3Browser-user-guide.${lang}.pdf`);
    await page.pdf({
      path: out,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(title, lang),
      footerTemplate: footerTemplate(lang),
      margin: { top: '20mm', bottom: '18mm', left: '18mm', right: '18mm' },
    });
    await page.close();
    console.log(`[ok] ${out}`);
  } finally {
    rmSync(htmlFile, { force: true });
  }
}

const fontCss = loadFontCss();
const themeCss = readFileSync(join(docsDir, 'theme.css'), 'utf8');
const browser = await chromium.launch();
try {
  for (const lang of Object.keys(LANGS)) {
    await buildLang(browser, lang, fontCss, themeCss);
  }
} finally {
  await browser.close();
}
