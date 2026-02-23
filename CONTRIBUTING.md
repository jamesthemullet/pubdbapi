# Contributing

## Package manager

This repository uses **Yarn** for dependency and script commands.

- Use `yarn install` for dependencies
- Use `yarn <script>` to run scripts from `package.json`
- Avoid `npm` commands in this repo to keep workflows and lockfile behavior consistent

## Common commands

- Start dev server: `yarn dev`
- Run tests: `yarn test`
- Run tests with coverage: `yarn test:coverage`
- Run tests in watch mode: `yarn test:watch`
- Type-check: `yarn ts-check`
- Lint: `yarn lint`
- Auto-fix lint issues: `yarn lint:fix`
- Build: `yarn build`

## Going forward

When adding docs, PR notes, or team instructions, prefer Yarn command examples.
