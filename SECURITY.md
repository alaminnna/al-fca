# Security Policy

## What this library is (threat model)

AL-FCA automates a **user session** on Facebook. It holds the same power as
the logged-in browser session it emulates. That makes credential handling the
core security concern: the `appState` (cookies) is effectively a password.

## Credential handling rules (enforced in code and tests)

1. **No credentials in the repo.** `.gitignore` covers `appstate.json`,
   `config.json`, `cookie.txt`, `e2ee_device.json`, `.al-fca-e2ee/`, `*.log`.
   Automated tests fail if a hardcoded upload key or third-party endpoint
   reappears (`test/security.test.js`).
2. **No third-party data flows.** All traffic goes to `facebook.com`,
   `messenger.com`, `upload.facebook.com`, `edge-chat.facebook.com`,
   `reg-e2ee.facebook.com` and Facebook CDN hosts only
   (enforced by `test/security.test.js`). The only exception is an *explicit,
   caller-invoked* `api.uploadImageToImgbb(image, { apiKey })` using the
   caller's own key.
3. **No secrets in logs.** Cookies are never printed. Response-body logging
   exists only at `verbose` level (`logLevel: "verbose"`) — don't use it in
   production, and never paste verbose logs into public issues unredacted.
4. **Update checks are opt-in and read-only.** The library never installs
   packages (`execSync` is banned and regression-tested), never rewrites
   package.json, and never exits your process.
5. **E2EE device keys** persist at `./.al-fca-e2ee/device.json` (or your
   `e2eeDevicePath`) with mode `0600`, gitignored. `e2eeMemoryOnly` is not
   supported by the current backend — keys always persist; mount the path on
   tmpfs if that is unacceptable.
6. **Decrypted E2EE media cache** is served over loopback HTTP
   (`127.0.0.1`, random port, 10-minute TTL, 128 MB cap). Any local process on
   the machine can read it while it is cached — call `stopListeningAsync()`
   (which disconnects the E2EE bridge and stops the cache server) when done,
   or run bots in a user-private environment.

## Reporting a vulnerability

Open a GitHub security advisory (Security → Report a vulnerability) or an
issue marked "security". Please do not include real cookies, tokens, or
message content in reports.

## Known limitations (honest list)

- This is an unofficial library emulating browser traffic; Meta can change
  endpoints at any time and may restrict accounts that automate sessions.
  For production integrations use Meta's official Messenger Platform.
- The E2EE implementation is a vendored build (`e2ee/vendor/fbme/`) using
  `@signalapp/libsignal-client`. Its handshake correctness against the live
  service cannot be verified offline; review `INTEGRATION_TESTING.md` before
  trusting it for sensitive conversations.
- `utils.post/get` (HTTP transport) follow `request`-compatible semantics:
  GET redirects are followed, POST redirects are surfaced via
  `headers.location`. Verify pinned TLS expectations yourself if you add
  proxying (`proxy` option uses `https-proxy-agent`).
