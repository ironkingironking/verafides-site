# Verafides form delivery repair — 2026-09-27

The website's SMTP hostname did not match the mail server certificate. After
correcting the hostname, an actual submission exposed temporary SMTP greylisting
on the previous unauthenticated delivery path.

## Changes

- Use authenticated SMTP submission on `mail.movena.ch:587` with STARTTLS.
- The dedicated website app password is restricted to SMTP. IMAP, POP3, DAV,
  ActiveSync and Sieve are disabled for this app password. The regular mailbox
  password was not changed. The credential is only in the protected server
  environment file and is not part of this repository.
- Require TLS whenever SMTP credentials are used over a non-implicit-TLS transport.
- Enable registration for the November event.
- Pass the current event title to the registration form, rather than the original
  filename, which still contains the previous September date.

## Verification

- Node syntax check and `git diff --check` passed.
- `npm run lint` passed, including the Hugo build and site link checks.
- SMTP authentication with required STARTTLS passed.
- Public event submission returned HTTP 303 to `/danke/`.
- The contact handler's local integration test returned HTTP 303 to `/danke/`.
- Both uniquely marked messages were verified in the recipient's INBOX.
- Public contact submission without a CAPTCHA token returned HTTP 400. The
  public CAPTCHA remains enabled. A successful browser submission including
  CAPTCHA has not been verified: the automated browser received no valid token
  and no user Chrome extension was connected.
- Test messages explicitly state that they are not real registrations or requests.

## CMS observations and operational follow-up

The existing CMS commit `d30f484` changed the September event to November and was
present in both GitHub and production before this repair. The reported intermittent
GUI editing problem was not reproduced; the user subsequently confirmed that
editing works again. No GUI root cause is claimed.

Keep the deployed tracked source synchronized with GitHub before further CMS
publishes. The existing deployment handler requires a clean worktree and a
fast-forward update; unpublished local commits can block later CMS deployments.
This repair is committed locally first. A GitHub push requires explicit user
authorization under the project rules.

For future incidents, check the complete path: CMS commit, deployed commit,
rendered page, form response, and actual mailbox delivery. An SMTP connection
check alone does not prove delivery. On server moves, retain the protected SMTP
environment configuration and verify certificate name, authentication, and a
marked end-to-end test message.
