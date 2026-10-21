# Contributing

Use Node.js 22+, run `npm ci`, then `npm test` and `npm run check`. Keep the website buildless and self-contained in `dist/`. New features must work with keyboard navigation, narrow layouts and both colour themes. Respect reduced-motion preferences.

Use fictional message data only. Include a meaningful regression test for changes to email protocols, sending behavior or cryptography. Preserve encryption format compatibility; introduce a versioned migration if necessary. Explain provider limitations accurately. Avoid adding server dependencies, telemetry or remote fonts/scripts to the web app.

Submit focused pull requests with the concrete behavior change and validation performed. Desktop packaging is distinct from runtime testing: state which operating systems and real providers were actually exercised.
