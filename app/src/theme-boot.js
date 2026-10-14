// Apply the saved theme before first paint (classic script on purpose: it must run synchronously, and CSP forbids inline scripts).
try { document.documentElement.dataset.theme = localStorage.getItem('corkboard.theme') || 'system'; } catch (e) { /* storage blocked */ }
