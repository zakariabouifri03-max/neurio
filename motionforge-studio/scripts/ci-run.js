// CI helper: runs a command, streams output, and on failure publishes the tail of the output as a GitHub
// annotation (readable via the check-runs API even when raw logs are not downloadable). Usage: node scripts/ci-run.js "<title>" <command...>
const { spawn } = require('child_process');
const [title, ...cmd] = process.argv.slice(2); let buf = '';
const c = spawn(cmd.join(' '), { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
const feed = (d) => { process.stdout.write(d); buf += d.toString(); if (buf.length > 200000) buf = buf.slice(-100000); };
c.stdout.on('data', feed); c.stderr.on('data', feed);
c.on('close', (code) => {
  if (code !== 0) {
    const tail = buf.split(/\r?\n/).filter((l) => l.trim()).slice(-45).join('\n').slice(-6000);
    console.log(`::error title=${title} failed (exit ${code})::` + tail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  }
  process.exit(code);
});
