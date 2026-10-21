# Security policy

Mail Wizard 0.1.x is experimental and has not been independently audited. Report security vulnerabilities privately to the maintainer through the repository's private vulnerability reporting feature if enabled. Do not include credentials or private mail in public issues. If no private channel is available, open a public issue containing only a request for a private reporting channel.

Do not commit provider API tokens, app passwords, vault backups, actual emails, signing certificates, OAuth secrets, or local profile directories. Use synthetic email fixtures for tests. Never disable TLS verification to fix a connection issue. Treat attachment content as untrusted and do not auto-open files.

Changes that alter sending, encryption, credential handling, storage migrations or desktop IPC require behavioral tests and explicit review. HTML email rendering is deliberately absent. Mailbox state and local drafts must not be discarded after a network error. A provider-accepted submission must never be silently retried.
