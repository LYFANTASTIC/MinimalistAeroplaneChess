import { requireAuthenticatedUser } from './authGuard.js';

await requireAuthenticatedUser();
const domWasReady = document.readyState !== 'loading';
await import('./admin.js');
if (domWasReady) document.dispatchEvent(new Event('DOMContentLoaded'));
