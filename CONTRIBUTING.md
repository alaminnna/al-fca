# Contributing to AL-FCA

Thanks for helping improve AL-FCA. This is an unofficial user-session library,
so the bar for changes is deliberately high: **correctness and safety first**.

## Ground rules

1. **No stealth/evasion features.** No proxy rotation, fingerprint spoofing,
   CAPTCHA bypass, detection evasion, or ban circumvention — even if asked.
   Pull requests adding these will be rejected.
2. **No third-party data flows.** All requests go to Facebook/Messenger hosts.
   `test/security.test.js` enforces this at the source level.
3. **No new dependencies without discussion.** Every dependency is a
   supply-chain risk; the audit removed five unused ones — don't add that back.
   If you must, justify it and keep it maintained and audit-clean.
4. **No process-global side effects at require time** (no `console.log`
   hijacks, no signal handlers, no timers, no network, no `process.exit`).
5. **No live Facebook traffic in tests.** Mock the transport or use the fake
   broker pattern in `test/mqtt-lifecycle.test.js`.

## Workflow

```bash
git clone https://github.com/alaminnna/al-fca
cd al-fca && npm ci
npm test                 # 61 tests must pass before and after your change
node --check <files>     # keep every shipped file parseable
npm audit --omit=dev     # must stay at 0
bash scripts/compat-install.sh   # if you touched packaging
```

- One logical change per pull request; update `CHANGELOG.md` (Unreleased).
- Every **bug fix needs a regression test** named with a `regression` tag and a
  comment pointing at the failure it prevents.
- Public API changes: update `API_REFERENCE.md` and `API_COMPATIBILITY.md`,
  and list the breaking change explicitly in the PR description.

## Code conventions

- CommonJS (`require`/`module.exports`) — this package has no build step.
- Every `src/**/*.js` module (except `core/logger.js`, `auth/login.js`,
  `transport/http-client.js`) must export the factory
  `(defaultFuncs, api, ctx) => fn` — `buildAPI` registers `api[<filename>]`.
  `test/buildapi.test.js` verifies the whole surface offline.
- Use `src/core/logger.js` for logging, never bare `console.*`.
- Callback APIs: never invoke the callback twice; if you also return a Promise,
  it only settles when the caller did not pass a callback (legacy contract).
- Bounded state only: anything keyed by message/thread ID goes through
  `e2ee/core/bounded-store.js` or a comparable cap.
- Resource lifecycle: every socket/timer/cache you open needs a shutdown path
  reachable from `stopListening()`/`logout()`/`disconnect()`.

## Reporting bugs

Include: Node version, package version, a sanitized log (no cookies, no message
content, no thread IDs of real users), and the smallest reproduction. For
`parse_error` events attach the `detail` field only.

## Security issues

See `SECURITY.md` — please use a GitHub security advisory rather than a public
issue.
