# pipelint

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/pipelint.svg)](https://www.npmjs.com/package/@lxgicstudios/pipelint)
[![license](https://img.shields.io/npm/l/@lxgicstudios/pipelint.svg)](https://github.com/lxgicstudios/pipelint/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@lxgicstudios/pipelint.svg)](https://nodejs.org)

Validate GitHub Actions workflow YAML files offline. Catches unknown keys, deprecated actions, missing required fields, invalid expressions, and more. Built-in auto-fix for common issues.

## Install

```bash
npm install -g @lxgicstudios/pipelint
```

Or run directly with npx:

```bash
npx @lxgicstudios/pipelint .
```

## Usage

```bash
# Lint all workflows in your repo
pipelint .

# Lint a specific workflow file
pipelint .github/workflows/ci.yml

# Auto-fix common issues
pipelint . --fix

# Strict mode (warnings become errors)
pipelint . --strict

# JSON output for CI pipelines
pipelint . --json
```

## Features

- Works completely offline (no API calls)
- Detects deprecated GitHub Actions versions and suggests upgrades
- Catches missing required fields (`on`, `jobs`, `runs-on`)
- Flags hardcoded secrets (should use `${{ secrets.* }}`)
- Validates expression syntax for unbalanced parentheses
- Checks for unversioned action references
- Detects tab indentation (YAML requires spaces)
- Auto-fix mode for common issues
- Strict mode treats warnings as errors
- ZERO external dependencies
- JSON output for CI integration

## Checks

| Check | Level | Fixable |
|-------|-------|---------|
| Deprecated action versions | Warning | Yes |
| Missing `on` trigger | Error | No |
| Missing `jobs` section | Error | No |
| Tab indentation | Error | Yes |
| Trailing whitespace | Warning | Yes |
| Hardcoded secrets | Error | No |
| Unversioned actions | Error | No |
| Invalid expressions | Error | No |
| Unknown top-level keys | Warning | No |

## Options

| Option | Description |
|--------|-------------|
| `--fix` | Auto-fix common issues (deprecated actions, tabs, whitespace) |
| `--strict` | Treat warnings as errors |
| `--json` | Output results as JSON |
| `--help` | Show help message |

## How It Finds Files

When you point pipelint at a directory, it'll look for:

1. `.github/workflows/*.yml` and `.github/workflows/*.yaml`
2. Any `.yml` or `.yaml` files in the given directory

You can also point it directly at a specific file.

## CI Usage

```bash
# Add to your CI pipeline
npx @lxgicstudios/pipelint . --strict
```

## License

MIT - [LXGIC Studios](https://github.com/lxgicstudios)
