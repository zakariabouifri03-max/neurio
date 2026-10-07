// Montaj Pro — entry point
import { boot } from './app.js';

function fatal(err) {
  console.error(err);
  if (window.__bootPanel) {
    window.__bootErrors.push('boot(): ' + (err && (err.stack || err.message) || err));
    window.__bootPanel('تعذر إقلاع المحرر', 'واجهة التطبيق ما كملتش الإقلاع. هذا تقرير تقني:');
    return;
  }
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b0e14;color:#ffb4b4;font:14px/1.6 system-ui;padding:24px;overflow:auto;direction:ltr';
  box.innerHTML = `<h2 style="color:#fff">Montaj Pro — startup error</h2><pre style="white-space:pre-wrap">${String(err && err.stack || err)}</pre>`;
  document.body.appendChild(box);
}

boot().catch(fatal);
