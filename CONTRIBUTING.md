# Contributing to Where am I

[English](./CONTRIBUTING.md) | [한국어](./CONTRIBUTING.ko.md)

Thank you for helping improve Where am I. Contributions in English or Korean are welcome, including bug reports, documentation fixes, extractor support, tests, and usability feedback.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a bug fix, open or reference an issue with reproducible details.
- For a large feature or architectural change, open an issue before implementation so we can align on scope and approach.
- Never include private source code, access tokens, internal repository names, or unredacted local paths in issues, logs, screenshots, or fixtures.

Issues labeled [`good first issue`](https://github.com/soil0119/Where-am-i/labels/good%20first%20issue) or [`help wanted`](https://github.com/soil0119/Where-am-i/labels/help%20wanted) are intended for contributors looking for a place to begin.

## Development setup

1. Fork the repository and create a focused branch from `main`.
2. Install Node.js `>=22.13.0`.
3. Install dependencies and create a local configuration.

```bash
npm ci
cp whereami.config.example.json whereami.config.json
npm run dev
```

On Windows PowerShell, use `Copy-Item whereami.config.example.json whereami.config.json` instead of `cp`.

## Making changes

- Keep each pull request focused on one problem.
- Add or update tests when behavior changes.
- Update English and Korean documentation together when shared behavior or setup changes.
- Match the existing code style and avoid unrelated formatting changes.
- Do not commit `whereami.config.json`, `public/whereami-snapshot.json`, build output, or secrets.

## Before opening a pull request

Run the same core checks used by CI:

```bash
npm run lint
npm test
```

In the pull request:

- Explain what changed and why.
- Link the related issue with `Closes #<issue-number>` when applicable.
- Include reproduction or verification steps for behavior changes.
- For UI changes, include a screenshot or short recording with sensitive data removed.
- Call out limitations, follow-up work, or compatibility concerns.

Maintainers may ask for changes before merging. Reviews should focus on the contribution, remain respectful, and follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting bugs

Please include:

- Expected and actual behavior
- Minimal reproduction steps
- Node.js version and operating system
- Sanitized error messages or logs

Do not report security vulnerabilities in a public issue. Follow [SECURITY.md](./SECURITY.md) instead.
