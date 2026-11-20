import type { CapacitorConfig } from '@capacitor/cli';

const appUrlValue = process.env.RICHY_MD_APP_URL;

if (!appUrlValue) {
    throw new Error('Set RICHY_MD_APP_URL to the new deployed dashboard URL before building the Android app.');
}

const appUrl = new URL(appUrlValue);
if (appUrl.protocol !== 'https:' || appUrl.pathname !== '/app/' || appUrl.search || appUrl.hash) {
    throw new Error('RICHY_MD_APP_URL must be an HTTPS URL ending in /app/.');
}
const hostname = appUrl.hostname.toLowerCase();
if (hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.github.dev')
    || hostname.endsWith('.app.github.dev')) {
    throw new Error('Build the Android app with the deployed Render URL, not a local or Codespaces URL.');
}

const config: CapacitorConfig = {
    appId: 'com.richymd.app',
    appName: 'RICHY MD',
    webDir: 'website/app',
    server: {
        url: appUrl.href,
        cleartext: false,
        allowNavigation: [appUrl.hostname],
    },
};

export default config;
