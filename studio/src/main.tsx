import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles/global.css';

if (import.meta.env.DEV) void import('./devtools');
void import('./platform/native').then((m) => m.initNative());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
