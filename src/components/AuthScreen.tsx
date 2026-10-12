/** Sign in / create account against any Neurio server. */
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { ensureNotificationPermission } from '../lib/notifications';

type Mode = 'login' | 'register' | 'server';

export function AuthScreen() {
  const { login, register, bootstrap, baseUrl, config, lastError } = useStore(useShallow((state) => ({
    login: state.login,
    register: state.register,
    bootstrap: state.bootstrap,
    baseUrl: state.baseUrl,
    config: state.config,
    lastError: state.lastError,
  })));

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [serverUrl, setServerUrl] = useState(baseUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lastError) setError(lastError);
  }, [lastError]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'server') {
        await bootstrap(serverUrl);
        setMode('login');
      } else if (mode === 'login') {
        await login(username.trim(), password, serverUrl);
      } else {
        if (password !== confirm) throw new Error('Passwords do not match');
        if (password.length < 8) throw new Error('Passwords need at least 8 characters');
        await register(username.trim(), password, displayName.trim() || username.trim(), serverUrl);
      }
      void ensureNotificationPermission();
    } catch (caught) {
      setError((caught as Error).message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">N</div>
          <div>
            <h1>Neurio</h1>
            <p className="muted">
              Free, self-hosted chat with voice, video and screen sharing.
              {config ? ` Connected to ${config.name} v${config.version}.` : ''}
            </p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={submit} className="auth-form">
          <label>
            Server address
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="http://127.0.0.1:8790"
              spellCheck={false}
            />
          </label>
          <p className="hint">
            Use <code>http://127.0.0.1:8790</code> for a server on this computer, or the LAN address
            (for example <code>http://192.168.1.20:8790</code>) of the machine that runs it.
          </p>

          {mode !== 'server' && (
            <>
              <label>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="e.g. alex"
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </label>
            </>
          )}

          {mode === 'register' && (
            <>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="How others see you"
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </>
          )}

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Connect to server'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' && (
            <>
              <span>Need an account?</span>
              <button className="link" onClick={() => setMode('register')} type="button">
                Create one
              </button>
              <button className="link" onClick={() => setMode('server')} type="button">
                Change server
              </button>
            </>
          )}
          {mode === 'register' && (
            <>
              <span>Already registered?</span>
              <button className="link" onClick={() => setMode('login')} type="button">
                Sign in
              </button>
            </>
          )}
          {mode === 'server' && (
            <button className="link" onClick={() => setMode('login')} type="button">
              Back to sign in
            </button>
          )}
        </div>

        <footer className="auth-footer">
          <span>
            No cloud, no API keys — your messages live in a SQLite file on the server you choose.
          </span>
        </footer>
      </div>
    </div>
  );
}
