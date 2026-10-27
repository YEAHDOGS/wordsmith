// @ts-nocheck
import App from './App.svelte'
import './app.css'
import { mount } from 'svelte'
import { APP_HOST, SHORT_HOSTS } from './lib/models.js'

// Opened on a short name (ws., word., smith.dogs.red): move to the real address before anything signs in or syncs.
const ON_SHORT_HOST = SHORT_HOSTS.includes(location.hostname)
if (ON_SHORT_HOST) location.replace(`https://${APP_HOST}${location.pathname}${location.search}${location.hash}`)

// index.html leaves the static fallback visible on browsers too old for the app; never mount over it there
const IS_LEGACY_BROWSER = !document.getElementById('legacy-fallback').hidden

const app = IS_LEGACY_BROWSER || ON_SHORT_HOST ? null : mount(App, {
  target: document.getElementById('app'),
});

export default app
