# Detection sources and integration boundary

Selection checked on 2026-11-11 using upstream repositories and source, not third-party score sites.

| Project | Upstream purpose / integration fit | Decision |
| --- | --- | --- |
| [CreepJS](https://github.com/abrahamjuliot/creepjs) | Research into anti-fingerprinting leaks, prototype lies, rendering and cross-surface inconsistency | Primary local module engine, pinned source |
| [FingerprintJS](https://github.com/fingerprintjs/fingerprintjs) | Browser component collection and visitor identifiers; commercial platform is separate | Not used as a spoofing quality verdict |
| [BotD](https://github.com/fingerprintjs/BotD) | Basic client-side bot detection; stability-focused maintenance | Not selected as the primary spoofing audit engine |
| [TZP](https://github.com/arkenfox/TZP) | Gecko / Firefox / Tor fingerprint-protection tests | Useful future Gecko reference, outside current Chromium scope |

There is no universal “official browser realism certification” provided by these repositories. Selection is based on the stated test objective. CreepJS is a research suite, not a supported collection SDK and not a manufacturer ranking service.

Pinned upstream: [10aa6724cd33a1015db1574211890518cd04f0cc](https://github.com/abrahamjuliot/creepjs/tree/10aa6724cd33a1015db1574211890518cd04f0cc). The local adapter executes 22 modules in the relevant upstream dependency order. Source files are unchanged and verified against SHA-256 at build time. The upstream source snapshot, MIT license and trademark policy are retained. CreepJS is used solely for attribution; Prism is a distinct derivative tool with no endorsement claim.

Included: prototype integrity checks, worker fallback and cross-surface checks, rendering/pixel checks, fonts, geometry, screen, navigator, JS errors, math, CSS, media, Intl, headless/stealth heuristics, lies/trash/error evidence.

Excluded: upstream webpage UI, remote predictions, remote validation samples, commercial services, full FP ID and any guarantee that a spoofed browser passes third-party detection. There is no fake realism percentage. Weak headless similarity remains informational. Module missing/error is not converted to “clean”.

Local changes live in the adapter and reporting layers only: module timeouts, raw result storage, flattening to field rows, component hash naming, audio stable-input selection, service-worker cleanup and evidence wording. The engine's consoleErrors collector requires dynamic Function calls; the local probe CSP allows these while restricting connections to the local origin.

Legacy demo signals use a separate namespace; legacy snapshots remain available. Hash results are comparable only with matching source/algorithm versions and input test. Shared output is evidence of shared output, not proof of device identity or information leakage.
