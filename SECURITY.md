# Security Policy

[English](./SECURITY.md) | [한국어](./SECURITY.ko.md)

## Supported versions

Security fixes are currently provided for the latest release and the latest commit on the `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's **Security → Advisories → Report a vulnerability** flow to submit a [private vulnerability report](https://github.com/soil0119/Where-am-i/security/advisories/new). If that option is unavailable, use a private contact method listed on the [maintainer's GitHub profile](https://github.com/soil0119).

Include as much of the following as you can safely provide:

- The affected version or commit
- Impact and realistic attack scenario
- Minimal reproduction steps or proof of concept
- Suggested mitigation, if known

Do not attach raw internal source code, access tokens, repository names, local paths, or unredacted snapshots. You should receive an initial acknowledgement within 7 days. We will coordinate disclosure and remediation timing with you after validating the report.

## Local scan data

`whereami.config.json` and `public/whereami-snapshot.json` may contain local paths, Git metadata, and source evidence. They are ignored by Git by default, and production builds remove the snapshot. If you modify the configuration or create a separate deployment pipeline, ensure these files are never included in public artifacts.
