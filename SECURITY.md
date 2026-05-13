# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in SimpleCMP, please **do not** open
a public issue. Instead, email the maintainer directly with details. We will respond within
a reasonable timeframe and coordinate disclosure once a fix is available.

For sensitive reports, you can use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
feature on this repository.

## Scope

Security issues that fall within scope:

- Bypasses of consent collection or storage
- Code execution or injection vulnerabilities
- Leakage of user data outside the consent boundary
- Issues in the recorder that could expose data unintentionally in production

Out of scope:

- Issues in third-party CMS plugins maintained in separate repositories
- Issues in upstream Klaro! that have not been ported to SimpleCMP — please report those
  to the [Klaro! project](https://github.com/KIProtect/klaro)

## Supported versions

Pre-1.0: only the `main` branch and the most recent published version receive security
updates.

Post-1.0: the most recent two minor versions will receive security updates.
