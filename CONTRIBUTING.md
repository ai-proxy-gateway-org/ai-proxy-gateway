# Contributing to AI Proxy Gateway

First off, thank you for considering contributing to the AI Proxy Gateway! It's people like you that make open-source such a great community.

## How Can I Contribute?

### Reporting Bugs
- Ensure the bug was not already reported by searching on GitHub under [Issues](../../issues).
- If you're unable to find an open issue addressing the problem, open a new one using the Bug Report template.

### Suggesting Enhancements
- Open a new issue using the Feature Request template.
- Provide clear context and explain the motivation behind the feature.

### Pull Requests
1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add or update tests in `src/test.ts`.
3. If you've changed APIs or configuration variables, update `README.md` and `.env.example`.
4. Ensure TypeScript type checking passes (`npm run typecheck`) and run the integration test suite (`npm test` against a test database).
5. Issue that pull request!

## Code Style & Quality Checks
- We use **TypeScript** (`strict: true`) and **ES Modules** (`"type": "module"`).
- Run `npm run typecheck` (`tsc --noEmit`) before submitting a PR to verify zero TypeScript compiler errors.
- Avoid committing raw secrets or API keys. Always use `.env` variables.

Thank you for helping us make AI Proxy Gateway better!
