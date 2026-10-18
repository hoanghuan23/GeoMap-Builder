import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const browser = process.platform === "win32" && [
  join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")
].find(existsSync);

test("focusing and toggling the hex switch never scrolls the whole page", { skip: !browser }, () => {
  const directory = mkdtempSync(join(tmpdir(), "geomap-hex-layout-"));
  try {
    const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
    const css = read("../src/styles.css").replace(/@import[^;]+;/g, "") + read("../src/reference-tweaks.css");
    const syncControls = read("../src/app.js").match(/function syncRegionHexControls\(\) \{[\s\S]*?\n\}/)[0];
    const probe = `<script>
      const $ = id => document.getElementById(id);
      const state = { regionHexEnabled: false, regionHexResolution: 6 };
      ${syncControls}
      const sidebar = document.querySelector('.sidebar');
      for (const id of ['feature-section','region-hex-controls','style-section']) $(id).hidden = false;
      const spacer = document.createElement('div'); spacer.style.height = '1000px'; sidebar.prepend(spacer);
      const input = $('show-region-hex');
      input.addEventListener('change', () => { state.regionHexEnabled = input.checked; syncRegionHexControls(); });
      sidebar.scrollTop += input.closest('label').getBoundingClientRect().top - sidebar.getBoundingClientRect().top - 200;
      function sample() { return {
        scrollY, shellTop: document.querySelector('.app-shell').getBoundingClientRect().top,
        mapBottom: document.querySelector('.map-panel').getBoundingClientRect().bottom, viewport: innerHeight,
        resolutionHidden: $('region-hex-resolution-control').hidden, enabled: input.checked
      }; }
      const samples = [sample()];
      for (let i = 0; i < 6; i++) { input.focus(); input.click(); samples.push(sample()); }
      const result = document.createElement('pre'); result.id = 'layout-result';
      result.textContent = JSON.stringify(samples); document.body.append(result);
    </script>`;
    const html = read("../index.html")
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<link[^>]*>/g, "")
      .replace("</head>", `<style>${css}</style></head>`)
      .replace("</body>", `${probe}</body>`);
    const file = join(directory, "layout.html"); writeFileSync(file, html);
    const result = spawnSync(browser, [
      "--headless", "--no-sandbox", "--disable-gpu", "--disable-software-rasterizer", "--no-first-run",
      `--user-data-dir=${join(directory, "profile")}`, "--window-size=1400,900", "--dump-dom", pathToFileURL(file).href
    ], { encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/<pre id="layout-result">([^<]+)<\/pre>/);
    assert.ok(match, "Browser must return measured layout");
    const samples = JSON.parse(match[1]);
    assert.equal(samples.length, 7);
    for (const sample of samples) {
      assert.equal(sample.scrollY, 0, "Focus must stay inside the scrolling sidebar");
      assert.equal(sample.shellTop, 0);
      assert.equal(sample.mapBottom, sample.viewport);
      assert.equal(sample.resolutionHidden, !sample.enabled);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
