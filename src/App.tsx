import { useEffect } from 'react';
import { applyInitialTheme, useStore } from './lib/store';
import { AuthScreen } from './components/AuthScreen';
import { AppShell } from './components/AppShell';
import { ModalHost } from './components/Modals';
import { ensureNotificationPermission } from './lib/notifications';

export default function App() {
  const authStatus = useStore((state) => state.authStatus);
  const bootstrap = useStore((state) => state.bootstrap);
  const baseUrl = useStore((state) => state.baseUrl);

  useEffect(() => {
    applyInitialTheme();
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void ensureNotificationPermission();
    const handler = () => {
      const state = useStore.getState();
      if (state.focusedChannelId && document.hasFocus()) {
        void state.ackChannel(state.focusedChannelId, null);
      }
    };
    window.addEventListener('focus', handler);
    const visibility = () => {
      if (document.visibilityState === 'visible') handler();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [authStatus]);

  if (authStatus === 'restoring') {
    return (
      <div className="splash">
        <div className="splash-logo">N</div>
        <h1>Neurio</h1>
        <p>Connecting to {baseUrl}…</p>
      </div>
    );
  }

  if (authStatus === 'anonymous') return <AuthScreen />;

  return (
    <>
      <AppShell />
      <ModalHost />
    </>
  );
}
