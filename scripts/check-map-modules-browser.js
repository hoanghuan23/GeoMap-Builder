import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browser = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!browser) throw new Error('Set CHROME_PATH to a Chrome/Chromium executable.');
const profile = mkdtempSync(join(tmpdir(), 'map-modules-browser-'));
const webgl = process.argv.includes('--webgl');
const templates = process.argv.includes('--templates');
const mobile = process.argv.includes('--mobile');
const screenshots = webgl && process.argv.includes('--screenshots');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{
  name:'map-test-glyphs',configureServer(server){server.middlewares.use((request,response,next)=>{
    if(!request.url.startsWith('/tests/glyphs/')){next();return;}
    response.setHeader('Content-Type','application/x-protobuf');response.end();
  });}
}] });
try {
  await server.listen(); const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/tests/fixtures/${templates ? 'map-template-browser' : 'map-modules-browser'}.html${webgl ? '?webgl=1' : ''}${screenshots ? '&screenshots=1' : ''}`;
  const child = spawn(browser, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(webgl ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu']),
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank']);
  let socket;
  let report;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome did not start debugging.')), 10000);
      let stderr = '';
      child.stderr.on('data', data => {
        stderr += data;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); reject(new Error(`Chrome exited: ${code}. ${stderr}`)); });
    });
    const debug = new URL(endpoint);
    const targets = await (await fetch(`http://${debug.host}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const pending = new Map(); let sequence = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data); const request = pending.get(message.id);
      if (!request) return; pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Chrome did not respond: ${method}`));},10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', mobile
      ? {width:390,height:844,deviceScaleFactor:1,mobile:true}
      : {width:1000,height:760,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate', { url });
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const response = await send('Runtime.evaluate', { expression: 'document.getElementById("module-result")?.textContent', returnByValue: true });
      const value = response.result.value;
      if (value && value !== 'running') { report = JSON.parse(value); break; }
      if(screenshots){
        const ready=await send('Runtime.evaluate',{expression:'document.getElementById("module-result")?.dataset.stage === "review-ready"',returnByValue:true});
        if(ready.result.value){
          for(const id of ['point-one','line-one','polygon-one','arc-one']){
            await send('Runtime.evaluate',{expression:`window.reviewMapModule(${JSON.stringify(id)})`,awaitPromise:true});
            const capture=await send('Page.captureScreenshot',{format:'png'});
            const output=join(tmpdir(),`map-module-${id}.png`);writeFileSync(output,Buffer.from(capture.data,'base64'));console.log(`Screenshot: ${output}`);
          }
          await send('Runtime.evaluate',{expression:'window.finishMapReview()'});
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!report) {
      const response = await send('Runtime.evaluate', { expression: 'document.getElementById("module-result")?.outerHTML', returnByValue: true });
      throw new Error(`Browser integration timed out: ${response.result.value}`);
    }
    if (!report.ok) throw new Error(`${report.error}\n${report.stack || ''}`);
  } finally {
    socket?.close(); child.kill('SIGTERM');
    await new Promise(resolve => { if(child.exitCode !== null){resolve();return;}
      const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('close',()=>{clearTimeout(timer);resolve();}); });
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
