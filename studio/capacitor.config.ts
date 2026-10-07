import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neurio.studio',
  appName: 'Neurio Studio',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0c0e14',
    // Export/AI features rely on a recent Chromium WebView (WebCodecs, WebGL2, WASM SIMD)
    minWebViewVersion: 94,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: { style: 'DARK', backgroundColor: '#0c0e14' },
  },
};

export default config;
