# Mail Wizard

An email application with a familiar folder tree, message table and reading pane. An open-source, local-first mail client with an installable website and an Electron desktop application. MIT licensed, created for Colm Lenehan.

**Status: initial release, 0.1.0.** Mail Wizard is a client, not an email hosting service. Real receiving and sending require an existing mail account and its credentials. There is no Mail Wizard backend to deploy or pay for. Your provider still supplies servers, delivery, mailbox storage, spam filtering, address ownership, and any applicable subscription. This release is not a demonstrated replacement for Gmail's full feature set or security programme.

## Included

- Compact three-pane mail interface with application menus, a sortable message table, switchable pane layouts, coloured toolbar icons, local Address Book, and light/dark themes.
- Conversation grouping, local collections, star, mark read/unread, archive, spam and recoverable trash.
- Local snooze, Focus (unread) view, selection and bulk actions, keyboard shortcuts.
- Local search: text, quoted phrases, `from:`, `to:`, `subject:`, `is:unread`, `is:read`, `is:starred`, `has:attachment`, `in:`, `label:`, `before:`, `after:`, and `-` exclusions.
- Composer with To/Cc/Bcc, signatures, local autosaved drafts, attachments and an 8/15/30-second undo-send hold. A closed app does not send queued mail; the local draft remains.
- AES-256-GCM encrypted connected workspaces with PBKDF2-SHA-256, 310,000 iterations, random 16-byte salt and per-write random 12-byte IV. Credentials, cached mail, attachments and drafts are encrypted together in IndexedDB. The key is held in memory while unlocked.
- Encrypted workspace backup/restore, explicit lock, plain-text `.eml` export and attachment downloads.
- Real JMAP session discovery, mailbox/identity loading, paged email fetching, flag/mailbox updates, file upload/download and `EmailSubmission/set` sending.
- Real desktop IMAP retrieval and SMTP submission, MIME parsing, attachment downloads, UIDVALIDITY checks and serialized mailbox operations.
- Static PWA, offline application shell, product/privacy page, favicon and custom 404.

## Use the website

The website is the application in `dist/`, with no build step, runtime CDN, framework or server-side component. Serve it on HTTPS (or localhost for development):

```sh
npm run web
```

Open `http://localhost:8000`. Use the fictional sample inbox immediately, or connect from Settings. The sample is labelled and never delivers mail. `?sample=1` opens an ephemeral sample without loading or overwriting a connected vault.

On a supporting browser, install using the browser menu. On iPhone/iPad, use Share → Add to Home Screen. Offline use becomes available after the service worker has cached the app; live sync still requires connectivity. A private host may require a prior sign-in and may not reliably serve the offline shell after its session expires.

## Real email connections

### Browser / JMAP

Connect with an HTTPS session URL, provider API token and local vault passphrase of at least 12 characters. Fastmail's documented endpoint is `https://api.fastmail.com/jmap/session`; its APIs support CORS. Provider pricing and token availability vary. Other JMAP providers must allow your browser origin. Sending needs `urn:ietf:params:jmap:submission` plus a sending identity, drafts and sent mailboxes, and a sufficiently scoped token. A read-only token does not become a sending token.

The app requests 100 messages per page. Load older messages as needed. Search, threads and counts cover the loaded cache, not every unseen message on your provider. Local collections, signatures, snooze and local drafts do not synchronize across devices.

Gmail and Outlook are not JMAP providers. Their browser OAuth flows would require registered applications and provider verification. Those are not silently provisioned or represented as available here.

### Desktop / IMAP and SMTP

The desktop app connects directly from your computer, without an HTTP bridge or hosted backend. Use an account that permits IMAP/SMTP app-password access. Presets are included for Gmail, iCloud and Fastmail; availability depends on provider and account settings. Microsoft 365 and Outlook.com OAuth are not implemented in this release. Main account passwords may be refused by providers; use a permitted app password.

IMAP always uses implicit TLS on the configured port (default 993). SMTP supports implicit TLS on 465 and mandatory STARTTLS on 587. TLS certificate validation is never disabled. Provider passwords are not written to a separate desktop file: they remain in the renderer's encrypted vault and main-process memory only while connected.

Desktop synchronization loads up to 100 messages per selected standard folder, with pagination. Messages above 32 MB are not downloaded and attachments in them must be accessed through the provider. A mailbox without the relevant IMAP SPECIAL-USE role is not guessed or created. Gmail submission relies on Gmail's automatic sent-copy behavior; other providers receive an IMAP sent copy when advertised.

## Run or build the desktop application

The desktop app uses a current Electron runtime. Windows 7 is not supported. Node.js 22 or later and npm are recommended for development. Install the locked dependencies:

```sh
npm ci
npm test
npm run check
npm start
```

Build on the target operating system:

```sh
npm run desktop:build
```

The output goes to `release/`. Configuration includes Windows NSIS/portable, macOS DMG/ZIP, and Linux AppImage. The GitHub Actions desktop workflow builds all three platforms and uploads artifacts. It does not publish a release or sign/notarize builds. Signing needs the maintainer's platform credentials. Source packaging is not proof of a tested native installer; see `VALIDATION.md` for the actual checks performed.

## Static hosting

Deploy `dist/` on a static host. All asset paths are relative, including manifest and service worker paths, so repository subpaths work. `_headers` supplies optional Netlify/Cloudflare-style headers; hosts that ignore it still receive the HTML CSP, except header-only `frame-ancestors`. Configure equivalent HTTP headers on such hosts. The GitHub Pages workflow is provided, but the repository must exist and Pages must be enabled for GitHub Actions before deployment.

The ChatGPT Sites deployment is owner-private by default. Open-source licensing does not change hosting access. It is not a public GitHub Pages deployment.

## Security and current limits

- Plain-text-only message display; email HTML is reduced to text. No HTML iframe, scripts, remote images or automatic link opening.
- No telemetry, ad network, CDN scripts or Mail Wizard mail server. Your static host and email provider can retain their own operational logs.
- Mailbox encryption at rest is not end-to-end encryption. Providers can see mail as before. An unlocked app, compromised device, malicious browser extension or compromised static deployment can access plaintext and credentials. Review code before entrusting it with an important account.
- Browser storage can be cleared or evicted. Export encrypted backups, especially for local drafts. Passphrases cannot be recovered. No automatic cross-device sync of local metadata.
- Local collections and snooze do not update provider labels. Provider updates are only attempted online. There is no permanently-delete operation.
- Background synchronization, push notifications, calendar, provider contact synchronization, OpenPGP/S/MIME, provider account creation, OAuth registration/refresh, spam classification and remote full-mailbox search are not implemented.
- No time-based delivery while the app is closed. Undo send is a delay before submission, not recall after provider acceptance. Ambiguous send errors retain the draft and instruct the user to check Sent before retrying.
- Desktop trust boundary: sandboxed renderer, context isolation, Node integration off, fixed IPC methods, main-frame sender validation, static protocol allowlist, navigation/new-window blocking, permission denials and no arbitrary filesystem or URL attachment sources.
- This code has not undergone an independent security audit, large-account performance study, accessibility audit or live-provider certification. Automated tests use protocol fixtures; they do not deliver email to real people.

## Development

```sh
npm test             # search, validation, encryption, JMAP and desktop protocol fixtures
npm run check        # JS syntax and static references
```

Structure: `dist/` website and app; `desktop/` native transport; `tests/` automated checks; `scripts/` verification helpers; `.github/workflows/` CI, Pages and desktop packaging. Dependencies retain their respective licences; the desktop runtime includes third-party notices supplied by Electron and npm packages.

Protocol references: [JMAP Core, RFC 8620](https://jmap.io/spec/rfc8620/), [JMAP Mail, RFC 8621](https://jmap.io/spec/rfc8621/), [Fastmail developer documentation](https://www.fastmail.com/dev/), [ImapFlow](https://imapflow.com/docs/), [Nodemailer](https://nodemailer.com/smtp), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/).
