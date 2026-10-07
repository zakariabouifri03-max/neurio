// Copies the pure-JS browser builds we ship inside the renderer into src/renderer/vendor.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'vendor');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/fflate/esm/browser.js'), path.join(out, 'fflate.js'));
fs.copyFileSync(path.join(root, 'node_modules/ag-psd/dist/bundle.js'), path.join(out, 'ag-psd.js'));
console.log('vendored fflate + ag-psd');
