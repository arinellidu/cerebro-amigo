#!/usr/bin/env node
// Renderiza HTML -> PDF via Chrome DevTools Protocol (Page.printToPDF).
// Exporta renderPdf(htmlPath, pdfPath); também roda como CLI.
// Uso CLI: node html-to-pdf.mjs <input.html> <output.pdf>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function renderPdf(htmlPath, pdfPath, { port = 9333 } = {}) {
  const inPath = resolve(htmlPath);
  const outPath = resolve(pdfPath);
  const fileUrl = 'file://' + inPath;

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const getJson = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json();

    let version;
    for (let i = 0; i < 60; i++) {
      try { version = await getJson('/json/version'); break; } catch { await sleep(200); }
    }
    if (!version) throw new Error('Chrome DevTools não subiu');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    });
    const send = (method, params = {}, sessionId) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
    await new Promise((res) => ws.addEventListener('open', res, { once: true }));

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);

    const loaded = new Promise((res) => {
      const h = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) {
          ws.removeEventListener('message', h); res();
        }
      };
      ws.addEventListener('message', h);
    });
    await send('Page.navigate', { url: fileUrl }, sessionId);
    await loaded;
    await sleep(500); // assenta layout/fontes

    const result = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,  // respeita @page (A4 + margens do CSS)
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    }, sessionId);

    writeFileSync(outPath, Buffer.from(result.data, 'base64'));
    ws.close();
    return outPath;
  } finally {
    chrome.kill();
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await renderPdf(process.argv[2], process.argv[3]);
  console.log('OK ->', out);
}
