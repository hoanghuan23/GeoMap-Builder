import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeRoadText } from '../src/shared/data/text-utils.js';
import { resolveBoundaryCountry } from '../src/shared/geography/country-boundary-sources.js';

export function googleMapsUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!(url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')
      || /^(?:www\.|maps\.)?google\.(?:com|com\.vn)$/.test(url.hostname)
        && (url.pathname.startsWith('/maps') || url.hostname.startsWith('maps.')))) return null;
    url.protocol = 'https:';
    return url;
  } catch { return null; }
}

export function googlePlacePin(value) {
  const url = googleMapsUrl(value);
  if (!url || !url.pathname.startsWith('/maps/place/')) return null;
  const pair = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  if (!pair) return null; // @lat,lng is the viewport, never the selected pin.
  const lat = Number(pair[1]); const lng = Number(pair[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  url.search = ''; url.hash = '';
  return { lat, lng, sourceUrl: url.href };
}

function parts(value) {
  const pieces = String(value || '').split(',').map(value => value.trim()).filter(Boolean);
  const first = normalizeRoadText(pieces[0]).replace(/^so\s+(?:nha\s+)?/, '');
  const number = /^(\d+[a-z]?(?:\s+\d+[a-z]?)*)(?:\s+|$)/.exec(first)?.[1];
  const street = (number ? first.slice(number.length).trim() : first).replace(/^(?:pho|duong|p|d|street|road)\s+/, '');
  return { first, number, street, parent: pieces.length > 1 ? pieces.filter(piece => !resolveBoundaryCountry(piece)).at(-1) : null };
}

export function googleAddressMatches(expected, actual, title = '', label = '') {
  const a = parts(expected); const b = parts(actual);
  const compact = value => normalizeRoadText(value).replace(/\s/g, '');
  if (a.parent && !compact(actual).includes(compact(a.parent))) return false;
  if (a.number) return a.number === b.number && a.street === b.street;
  const brand = normalizeRoadText(title.split(/[–—]/)[0]); const name = normalizeRoadText(label);
  const named = brand.length >= 8 && name.length >= 8 && (name.includes(brand) || brand.includes(name));
  if (!named) return false;
  const unit = a.first.match(/\b[a-z]+\d+[a-z]?\b/)?.[0];
  if (unit) return normalizeRoadText(actual).split(' ').includes(unit);
  return a.first.length >= 8 && normalizeRoadText(actual).includes(a.first);
}

// This function is evaluated in an isolated, signed-out browser. It reads only
// visible address evidence and place links; page scripts are never evaluated on the server.
function snapshot() {
  const text = document.body?.innerText || '';
  return { url: location.href, label: [...document.querySelectorAll('h1')].map(node => node.innerText).find(Boolean) || '',
    addresses: [...new Set([document.querySelector('[data-item-id="address"]')?.innerText,
      ...text.split('\n').filter(line => line.includes(',') && line.length < 800)].filter(Boolean))].slice(0, 20),
    places: [...document.querySelectorAll('a[href*="/maps/place/"]')].map(node => ({ url: node.href,
      label: node.getAttribute('aria-label') || node.innerText })).slice(0, 8),
    approximate: /location shown is not precise|vị trí (?:hiển thị )?không chính xác/i.test(text),
    blocked: /unusual traffic|not a robot|recaptcha|before you continue to google/i.test(text),
    empty: /can't find|couldn't find|no results found|không tìm thấy/i.test(text) };
}

async function browserSession(path) {
  const profile = mkdtempSync(join(tmpdir(), 'geomap-google-'));
  const child = spawn(path, ['--headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--disable-extensions', '--disable-background-networking', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank']);
  let socket; let sequence = 0; const pending = new Map(); const listeners = new Set();
  const close = async () => {
    socket?.close(); child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = ''; const timer = setTimeout(() => reject(new Error('Không khởi động được trình duyệt Google Maps.')), 10_000);
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-8000);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once('error', () => { clearTimeout(timer); reject(new Error('Không khởi động được trình duyệt Google Maps.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Trình duyệt Google Maps đã dừng.')); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data); const request = pending.get(value.id);
      if (request) { pending.delete(value.id); clearTimeout(request.timer); value.error ? request.reject(new Error(value.error.message)) : request.resolve(value.result); }
      else for (const listener of listeners) listener(value);
    });
    socket.addEventListener('close', () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Trình duyệt Google Maps đã đóng.')); } pending.clear(); });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('Google Maps phản hồi quá lâu.')); }, 10_000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    async function tab() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      return async (value, signal) => {
        const url = googleMapsUrl(value);
        if (!url) return null;
        signal?.throwIfAborted();
        const navigation = new Promise((resolve, reject) => {
          const done = error => { listeners.delete(listener); clearTimeout(timer); error ? reject(error) : resolve(); };
          const listener = event => { if (event.sessionId === sessionId && event.method === 'Page.frameNavigated'
            && !event.params.frame.parentId && event.params.frame.url !== 'about:blank') done(); };
          const timer = setTimeout(() => done(new Error('Google Maps tải trang quá lâu.')), 12_000);
          listeners.add(listener);
        });
        navigation.catch(() => {});
        await send('Page.navigate', { url: url.href }, sessionId); await navigation;
        const deadline = Date.now() + 12_000; let result;
        while (Date.now() < deadline && !signal?.aborted) {
          let response;
          try { response = await send('Runtime.evaluate', { expression: `(${snapshot.toString()})()`, returnByValue: true }, sessionId); }
          catch (error) {
            if (!/context|navigat/i.test(error.message)) throw error;
            await new Promise(resolve => setTimeout(resolve, 350)); continue;
          }
          const value = response.result?.value;
          if (value) {
            result = value; const pin = googlePlacePin(value.url);
            if (value.blocked || value.empty || (pin ? value.addresses.length && value.label : value.places.length)) return value;
          }
          await new Promise(resolve => setTimeout(resolve, 350));
        }
        return result;
      };
    }
    return { tab, close };
  } catch (error) { await close(); throw error; }
}

let queue = Promise.resolve();
export function resolveGoogleMapsPoints(locations, { env = {}, signal = AbortSignal.timeout(120_000) } = {}) {
  // One isolated browser per import, at most three tabs; concurrent imports queue.
  const task = queue.catch(() => {}).then(async () => {
    const matches = []; const errors = new Set(); let attempted = 0; let next = 0; let blocked = false;
    const path = env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
    if (!path) return { matches, attempted, reason: 'Chưa có Chrome/Chromium để đọc link Google Maps (CHROME_PATH).' };
    if (signal.aborted) return { matches, attempted, reason: 'Hết thời gian tra Google Maps.' };
    let browser;
    try {
      browser = await browserSession(path);
      await Promise.all(Array.from({ length: Math.min(3, locations.length) }, async () => {
        const open = await browser.tab();
        while (next < locations.length && !signal.aborted && !blocked) {
          const location = locations[next++]; attempted++;
          const direct = new URL('https://www.google.com/maps/search/');
          direct.search = new URLSearchParams({ api: '1', query: location.address, hl: 'en' });
          const urls = [...new Set([direct.href, ...(location.links || []).map(value => googleMapsUrl(value)?.href).filter(Boolean)])];
          const accept = result => {
            const pin = googlePlacePin(result?.url);
            if (!pin || !result.addresses.some(address => googleAddressMatches(location.address, address, location.title, result.label))) return false;
            matches.push({ id: location.id, ...pin, approximate: result.approximate === true }); return true;
          };
          try {
            let found = false;
            for (const url of urls) {
              const result = await open(url, signal);
              if (result?.blocked) { blocked = true; errors.add('Google Maps yêu cầu xác minh; chưa tra tiếp.'); break; }
              if (accept(result)) { found = true; break; }
              for (const candidate of (result?.places || []).filter(item => googlePlacePin(item.url)).slice(0, 3)) {
                const detail = await open(candidate.url, signal);
                if (detail?.blocked) { blocked = true; errors.add('Google Maps yêu cầu xác minh; chưa tra tiếp.'); break; }
                if (accept(detail)) { found = true; break; }
              }
              if (found || blocked || signal.aborted) break;
            }
          } catch (error) {
            if (env.AI_DEBUG === 'true') console.warn('Google Maps lookup', { id: location.id, error: error.message });
            errors.add(signal.aborted ? 'Hết thời gian tra Google Maps.' : 'Một số link Google Maps chưa đọc được.');
          }
        }
      }));
    } catch (error) { errors.add(error.message || 'Không đọc được Google Maps.'); }
    finally { await browser?.close(); }
    if (signal.aborted) errors.add('Hết thời gian tra Google Maps.');
    return { matches, attempted, reason: [...errors].join(' ') };
  });
  queue = task.then(() => {}, () => {});
  return task;
}
