'use strict';
/**
 * Windows `.bat` runner.
 *
 * Google ships sdkmanager/avdmanager as .bat wrappers. Node's spawn cannot
 * execute .bat files directly (CreateProcess limitation + Node >= 18 EINVAL
 * guard), so we go through cmd.exe with verbatim arguments and correct quoting.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function quoteArg(a) {
  const s = String(a);
  if (s === '') return '""';
  if (!/[\s"&|<>^%]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"')}"`;
}

/** Build `cmd.exe /d /s /c "<bat>" args...` argument vector. */
function batArgs(batPath, args) {
  const line = `"${batPath}" ${args.map(quoteArg).join(' ')}`.trim();
  // /s + wrap everything in quotes: cmd strips the outer pair and keeps ours.
  return ['/d', '/s', '/c', `"${line}"`];
}

/**
 * Spawn a .bat (or plain exe) and return the child process.
 * When `directJava` is provided and the .bat is missing we run the Java main
 * class ourselves — useful for exotic SDK layouts.
 */
function spawnTool({ bat, exe, args, env, cwd, java, classpathJar, mainClass, toolsDir, onStdout, onStderr, onExit }) {
  let cmd; let argv; let useShell = false;

  const batExists = bat && fs.existsSync(bat);
  const exeExists = exe && fs.existsSync(exe);

  if (process.platform === 'win32') {
    if (exeExists) { cmd = exe; argv = args; }
    else if (batExists) { cmd = 'cmd.exe'; argv = batArgs(bat, args); useShell = false; }
    else if (java && classpathJar && mainClass && fs.existsSync(classpathJar)) {
      cmd = java;
      argv = ['-Dcom.android.sdklib.toolsdir=' + (toolsDir || ''), '-classpath', classpathJar, mainClass, ...args];
    } else {
      const err = new Error(`Tool not found: ${bat || exe}`);
      err.code = 'ENOENT';
      if (onExit) process.nextTick(() => onExit(-1, err));
      return null;
    }
  } else if (exeExists || (bat && fs.existsSync(bat))) {
    cmd = exeExists ? exe : bat;
    argv = args;
  } else {
    const err = new Error(`Tool not found: ${bat || exe}`);
    err.code = 'ENOENT';
    if (onExit) process.nextTick(() => onExit(-1, err));
    return null;
  }

  const child = spawn(cmd, argv, {
    env: Object.assign({}, process.env, env || {}),
    cwd,
    windowsHide: true,
    windowsVerbatimArguments: useShell,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = ''; let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { out += d; if (onStdout) onStdout(d); });
  child.stderr.on('data', (d) => { err += d; if (onStderr) onStderr(d); });
  child.on('error', (e) => { err += String(e.message || e); if (onExit) onExit(-1, e); });
  child.on('close', (code) => { if (onExit) onExit(code == null ? -1 : code, null, { stdout: out, stderr: err }); });
  child._captured = () => ({ stdout: out, stderr: err });
  return child;
}

/** Run a tool to completion, resolving with {code, stdout, stderr}. */
function runTool(spec) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawnTool(Object.assign({}, spec, {
      onExit: (code, err, cap) => {
        if (settled) return;
        settled = true;
        resolve({ code, error: err, stdout: (cap && cap.stdout) || '', stderr: (cap && cap.stderr) || '' });
      },
    }));
    if (!child && !settled) {
      settled = true;
      resolve({ code: -1, stdout: '', stderr: `spawn failed: ${spec.bat || spec.exe}`, error: new Error('ENOENT') });
    }
  });
}

module.exports = { spawnTool, runTool, batArgs, quoteArg };
