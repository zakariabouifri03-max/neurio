import React from 'react';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI error', error, info);
  }
  render() {
    if (this.state.error)
      return (
        <div style={{ padding: 40, maxWidth: 720, margin: '0 auto' }}>
          <h2>Something went wrong in the interface</h2>
          <p className="muted">Your project is autosaved. You can reload the page to recover it.</p>
          <pre style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 11 }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <button className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    return this.props.children;
  }
}
