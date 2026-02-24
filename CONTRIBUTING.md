# Contributing to TinyClaw

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/TinyAGI/tinyclaw.git
cd tinyclaw
npm install
npm run build
```

## Development

```bash
# Build TinyClaw
npm run build -w packages/tinyclaw

# Run locally
./packages/tinyclaw/tinyclaw.sh start

# View logs
./packages/tinyclaw/tinyclaw.sh logs all

# Run TinyOffice dev server
npm run dev -w packages/tinyoffice
```

### Project Structure

This is a monorepo with two packages:

- `packages/tinyclaw/` - Core CLI and daemon
  - `src/` - TypeScript source (queue processor, channel clients, routing)
  - `lib/` - Bash scripts (daemon, setup wizard, messaging)
  - `scripts/` - Installation and bundling scripts
  - `.agents/skills/` - Agent skill definitions
- `packages/tinyoffice/` - Web portal (Next.js)
  - `src/` - Next.js app with React components
- `docs/` - Shared documentation

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test locally with `tinyclaw start`
4. Open a pull request

## Reporting Issues

Open an issue at [github.com/TinyAGI/tinyclaw/issues](https://github.com/TinyAGI/tinyclaw/issues) with:

- What you expected vs what happened
- Steps to reproduce
- Relevant logs (`tinyclaw logs all`)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
