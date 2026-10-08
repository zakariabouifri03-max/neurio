import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/** Top-level boundary: one failing panel must never take the whole app down. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[lumora] render error', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'Inter, sans-serif', color: '#ecebf5' }}>
          <h1>Something went wrong</h1>
          <p style={{ color: '#8e8ca8' }}>{this.state.error.message}</p>
          <button className="btn primary" onClick={() => location.reload()} style={{ padding: '8px 14px' }}>
            Reload Lumora Studio
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener('unhandledrejection', (e) => console.error('[lumora] unhandled rejection', e.reason));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
