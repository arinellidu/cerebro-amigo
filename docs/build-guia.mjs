#!/usr/bin/env node
// Monta o PDF do guia do psiquiatra a partir do HTML único.
// Contorna o bug do Chrome 149 que corta o print-to-pdf em 8 páginas:
// divide o documento nos marcadores <!--SPLIT-->, renderiza cada pedaço
// (cada um <= 8 páginas) e concatena com pdfunite.
// Uso: node build-guia.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPdf } from './html-to-pdf.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(DIR, 'guia-psiquiatra-cerebro-amigo.html');
const OUT = join(DIR, 'guia-psiquiatra-cerebro-amigo.pdf');

const html = readFileSync(SRC, 'utf8');

// separa <head> (até </head>) do conteúdo do <body>
const headEnd = html.indexOf('</head>') + '</head>'.length;
const head = html.slice(0, headEnd);                 // <!doctype>...<head>...</head>
const bodyOpenIdx = html.indexOf('<body>', headEnd);
const bodyInner = html.slice(bodyOpenIdx + '<body>'.length, html.lastIndexOf('</body>'));

const parts = bodyInner.split('<!--SPLIT-->');
console.log(`Guia: ${parts.length} pedaço(s).`);

const tmpPdfs = [];
let port = 9333;
for (let i = 0; i < parts.length; i++) {
  const tmpHtml = join(DIR, `.guia-part${i}.html`);
  const tmpPdf = join(DIR, `.guia-part${i}.pdf`);
  writeFileSync(tmpHtml, `${head}\n<body>\n${parts[i]}\n</body>\n</html>`);
  await renderPdf(tmpHtml, tmpPdf, { port: port++ });
  rmSync(tmpHtml);
  tmpPdfs.push(tmpPdf);
  console.log(`  pedaço ${i + 1}/${parts.length} renderizado`);
}

// concatena
execFileSync('pdfunite', [...tmpPdfs, OUT]);
tmpPdfs.forEach((p) => rmSync(p));
console.log('OK ->', OUT);
