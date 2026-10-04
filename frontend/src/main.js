import { mount } from 'svelte';
import App from './App.svelte';
import './fonts.css';
import './styles.css';

// Chromium's Linux "-apple-system" alias resolves before the web-font fallback.
// Prefer native SF only on Apple platforms; use the bundled UI font elsewhere.
document.documentElement.classList.toggle('native-apple-font', /Mac|iPhone|iPad|iPod/.test(navigator.platform));

mount(App, { target: document.getElementById('app') });
