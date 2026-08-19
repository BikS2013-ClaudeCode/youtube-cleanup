# Issues — Pending Items

## Dependency vetting log

- 2026-08-18 — `playwright-core@^1.62.1` vetted: latest stable major at time of
  writing; `npm audit` on the resolved tree reports 0 advisories at any severity.
  Chose `playwright-core` over `playwright` deliberately — it ships no bundled
  browser binaries, which is correct for a tool that only attaches to an
  already-running Chrome over CDP. Re-vet before any major bump; Playwright is a
  fast-moving, browser-engine-adjacent package.
- 2026-08-18 — `commander@^15.0.0` vetted: latest stable major, 0 advisories.
- 2026-08-18 — dev-only: `typescript@^7.0.2`, `@types/node@^26.2.0`,
  `tsx@^4.23.12`. Full-tree `npm audit`: 0 vulnerabilities.

## Open items

- 2026-08-19 — **`--max-passes` promoted to `YOUTUBE_CLEANUP_MAX_PASSES`.** It
  previously defaulted to 12 in `src/cli.ts`, which is a fallback for a setting
  that bounds behaviour, contradicting the no-fallback rule — and it was
  inconsistent with `YOUTUBE_CLEANUP_MAX_SCROLLS`, which was already required.
  No exception was recorded because none is needed: the rule is now satisfied.

- 2026-08-19 — **Live-DOM verification done.** Four assumptions in the first
  implementation were wrong and are now corrected against the real page:
  1. History rows are `yt-lockup-view-model` / `ytm-shorts-lockup-view-model-v2`,
     not `ytd-video-renderer`. Shorts sit in a `ytd-reel-shelf-renderer` carousel.
  2. There is no inline remove "X"; only a "More actions" dropdown.
  3. The dropdown entry's host is `role="presentation"` — the tap target is the
     inner `.ytListItemViewModelTappable`.
  4. Clicking Remove leaves the tile in the DOM. Success can only be confirmed
     by reloading, so `clearShorts` verifies by reload, never by detachment.
- 2026-08-19 — **`doctor` rewritten** against the real mechanism. The obsolete
  inline-control cascade (`probeRemoveControl`, `probeAll`, `removeViaOverflow`,
  `ButtonProbe`, `ProbeReport`, `BTN_ATTR`) is deleted; `probeRow` + `probeMenu`
  replace it, and doctor ends in a READY / NOT READY verdict with exit code 1 on
  failure. Falls back to a regular row when history has no Shorts.
- 2026-08-19 — Manifests now record `entries` (every row seen), not just Shorts,
  so runs can be diffed to prove nothing outside Shorts was removed. The earlier
  manifests lack this baseline. Note the feed row count drifts on its own
  (observed 172 → 174 with no removal in between), so small count changes
  between scans are not evidence of deletion.
- The sign-in guard needed a hydration wait; checking at `domcontentloaded`
  produced a false "not signed in" on a properly authenticated session.
- Chrome 136+ refuses `--remote-debugging-port` when pointed at the default
  profile directory. Reusing a logged-in session therefore requires copying
  `Local State` + `Default/Cookies` into a separate `--user-data-dir`.
