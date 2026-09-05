import { readFileSync } from 'node:fs';

const resource = name => readFileSync(new URL(name, import.meta.url), 'utf8');

export const DASHBOARD_HTML = resource('progress-dashboard.html');
export const DASHBOARD_CSS = resource('progress-dashboard.css');
export const DASHBOARD_JS = resource('progress-dashboard-client.js');
