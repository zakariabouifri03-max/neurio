// Launch headless Chromium (bundled via @sparticuz/chromium) for renderer tests in the sandbox.
const path = require('path'), fs = require('fs'), zlib = require('zlib'), cp = require('child_process');
async function launch(extraArgs = []) {
  const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
  const pp = require('puppeteer-core');
  const libs = '/tmp/chromlibs/lib';
  if (!fs.existsSync(libs)) {
    fs.mkdirSync('/tmp/chromlibs', { recursive: true });
    const br = path.join(__dirname, '..', 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br');
    fs.writeFileSync('/tmp/chromlibs/al.tar', zlib.brotliDecompressSync(fs.readFileSync(br)));
    cp.execSync('tar xf al.tar', { cwd: '/tmp/chromlibs' });
  }
  process.env.LD_LIBRARY_PATH = libs + ':' + (process.env.LD_LIBRARY_PATH || '');
  const exe = await chromium.executablePath();
  return pp.launch({ executablePath: exe, headless: 'shell', args: [...chromium.args, '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', ...extraArgs], defaultViewport: { width: 1600, height: 900 } });
}
module.exports = { launch };
