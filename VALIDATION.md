# Validation record

Initial release prepared on 21 October 2026.

## Automated checks

`npm test`: 30 passing behavior tests, covering recipient/header validation, combined search operators, date handling, snooze and trash visibility, conversation grouping, safe plain-text display, secure provider URLs, backup shape validation, identifiers, authenticated encryption, wrong passphrases, tampered ciphertext, fresh IVs, JMAP discovery/pagination/updates/uploads/submission/rejected sends/read-only tokens/network failures/reconciliation, desktop TLS policy, MIME retrieval, attachment decoding, UIDVALIDITY and moved UIDs, SMTP envelopes and Bcc, sending failures and sent-copy failures.

`npm run check`: all project JavaScript syntax, local HTML asset references and PWA manifest checked. `npm audit --omit=dev` found no known production dependency advisories at the time of preparation. This is a dependency registry check, not an application security audit.

## Browser checks

The actual web application was opened through the managed local preview in Chromium. Verified:

- Initial inbox, list and reader render without horizontal overflow at the available desktop viewport.
- Light and dark themes.
- Structured `from:nora has:attachment` search returns the expected single conversation.
- Compose, autosave, close, reopen and draft recovery.
- Undo send preserves the original recipient, subject and body.
- The full sample countdown creates a message in Sent and removes the draft, with an explicit statement that no email was delivered.
- Archive and undo restore the message.
- Connection settings distinguish JMAP web access from desktop-only IMAP/SMTP.
- Application menus, both pane layouts, sortable column headers and the local Address Book. Selecting a contact opens the composer with the correct address.
- The app, composer and product website were inspected after the blue/silver interface revision. Product copy makes no claim of a historical release date.

The local preview uses HTTP on a non-localhost hostname, so browser WebCrypto vault unlocking and service-worker offline installation cannot be exercised on that preview origin. Encryption is tested using real WebCrypto under Node.js; offline installation remains unverified on the production host. A local-preview UUID compatibility problem was found and corrected with a cryptographically random UUID fallback.

## Native packaging

Electron Builder successfully packages the Windows x64 application. The distributed executable is a portable application, built without a signing certificate. No Windows machine was available to launch it; native Windows runtime behavior and real-provider login are not certified by packaging success. Source and CI are included for macOS and Linux builds; those platform artifacts are not claimed as completed.

## External services and boundaries

No real mail provider was connected, and no email was sent to a real person. Protocol tests use controlled fixtures with the production MIME libraries and adapters. Actual provider permissions, account policy, delivery, CORS behavior and spam classification require provider-side validation.

No GitHub repository was created. The connected GitHub tool exposes reads and existing-repository edits, but not repository creation; the available browser reaches GitHub's sign-in page. The source includes MIT licensing and GitHub workflows, but workflows have not run on GitHub. The separate Sites deployment follows its own source synchronization and publication workflow.
