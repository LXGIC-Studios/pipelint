#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

interface LintMessage {
  level: 'error' | 'warning';
  message: string;
  line?: number;
  fix?: string;
}

interface LintResult {
  file: string;
  errors: number;
  warnings: number;
  messages: LintMessage[];
  fixed?: boolean;
}

// Simple YAML parser for GitHub Actions workflows
interface YamlNode {
  [key: string]: any;
}

function parseSimpleYaml(content: string): { data: YamlNode; error?: string; errorLine?: number } {
  const lines = content.split('\n');
  const result: YamlNode = {};
  const stack: { indent: number; obj: any; key: string }[] = [{ indent: -1, obj: result, key: '' }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Calculate indentation
    const indent = line.length - line.trimStart().length;

    // Check for key: value pairs
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1 && !trimmed.startsWith('-')) {
      // Could be a continuation or invalid
      continue;
    }

    // Pop stack to correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      // Array item
      const key = stack[stack.length - 1].key;
      if (key && parent[key] === undefined) {
        parent[key] = [];
      }
      const arr = key ? parent[key] : parent;
      if (Array.isArray(arr)) {
        const itemContent = trimmed.slice(2).trim();
        if (itemContent.includes(':')) {
          const itemKey = itemContent.substring(0, itemContent.indexOf(':')).trim();
          const itemVal = itemContent.substring(itemContent.indexOf(':') + 1).trim();
          const obj: YamlNode = {};
          obj[itemKey] = itemVal || {};
          arr.push(obj);
          stack.push({ indent, obj, key: itemKey });
        } else {
          arr.push(itemContent.replace(/^['"]|['"]$/g, ''));
        }
      }
    } else if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
      let value: any = trimmed.substring(colonIdx + 1).trim();

      if (value === '' || value === '|' || value === '>') {
        // Nested object or block scalar
        parent[key] = value === '|' || value === '>' ? '' : {};
        stack.push({ indent, obj: parent[key], key });
        // Store key reference for array detection
        stack[stack.length - 1].key = key;
        // Update parent reference
        if (typeof parent[key] === 'object' && !Array.isArray(parent[key])) {
          stack[stack.length - 1].obj = parent;
          stack[stack.length - 1].key = key;
        }
      } else {
        // Remove quotes
        value = value.replace(/^['"]|['"]$/g, '');
        // Handle booleans
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        // Handle numbers
        else if (/^\d+$/.test(value)) value = parseInt(value);
        parent[key] = value;
      }
    }
  }

  return { data: result };
}

// Valid top-level workflow keys
const VALID_WORKFLOW_KEYS = new Set([
  'name', 'on', 'env', 'defaults', 'concurrency', 'jobs',
  'permissions', 'run-name',
]);

// Valid job keys
const VALID_JOB_KEYS = new Set([
  'name', 'needs', 'runs-on', 'permissions', 'environment',
  'concurrency', 'outputs', 'env', 'defaults', 'if',
  'steps', 'timeout-minutes', 'strategy', 'continue-on-error',
  'container', 'services', 'uses', 'with', 'secrets',
]);

// Valid step keys
const VALID_STEP_KEYS = new Set([
  'name', 'id', 'if', 'uses', 'run', 'with', 'env',
  'continue-on-error', 'timeout-minutes', 'shell', 'working-directory',
]);

// Deprecated actions
const DEPRECATED_ACTIONS: Record<string, string> = {
  'actions/checkout@v1': 'actions/checkout@v4',
  'actions/checkout@v2': 'actions/checkout@v4',
  'actions/checkout@v3': 'actions/checkout@v4',
  'actions/setup-node@v1': 'actions/setup-node@v4',
  'actions/setup-node@v2': 'actions/setup-node@v4',
  'actions/setup-node@v3': 'actions/setup-node@v4',
  'actions/setup-python@v1': 'actions/setup-python@v5',
  'actions/setup-python@v2': 'actions/setup-python@v5',
  'actions/setup-python@v3': 'actions/setup-python@v5',
  'actions/setup-python@v4': 'actions/setup-python@v5',
  'actions/setup-java@v1': 'actions/setup-java@v4',
  'actions/setup-java@v2': 'actions/setup-java@v4',
  'actions/setup-java@v3': 'actions/setup-java@v4',
  'actions/upload-artifact@v1': 'actions/upload-artifact@v4',
  'actions/upload-artifact@v2': 'actions/upload-artifact@v4',
  'actions/upload-artifact@v3': 'actions/upload-artifact@v4',
  'actions/download-artifact@v1': 'actions/download-artifact@v4',
  'actions/download-artifact@v2': 'actions/download-artifact@v4',
  'actions/download-artifact@v3': 'actions/download-artifact@v4',
  'actions/cache@v1': 'actions/cache@v4',
  'actions/cache@v2': 'actions/cache@v4',
  'actions/cache@v3': 'actions/cache@v4',
};

function findYamlLine(content: string, searchKey: string, searchValue?: string): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (searchValue && line.includes(searchValue)) return i + 1;
    if (line.startsWith(searchKey + ':') || line.startsWith(`"${searchKey}":`)) return i + 1;
  }
  return undefined;
}

function lintWorkflow(filePath: string, content: string, strictMode: boolean): LintResult {
  const messages: LintMessage[] = [];
  const lines = content.split('\n');

  // Check if file is empty
  if (!content.trim()) {
    messages.push({ level: 'error', message: 'Workflow file is empty', line: 1 });
    return { file: filePath, errors: 1, warnings: 0, messages };
  }

  // Basic YAML syntax checks
  let inBlockScalar = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for tabs (YAML doesn't allow tabs for indentation)
    if (line.match(/^\t/)) {
      messages.push({
        level: 'error',
        message: 'Tab indentation detected. YAML requires spaces.',
        line: i + 1,
        fix: line.replace(/\t/g, '  '),
      });
    }

    // Check for block scalar indicators
    if (trimmed.endsWith('|') || trimmed.endsWith('>') || trimmed.endsWith('|-') || trimmed.endsWith('>-')) {
      inBlockScalar = true;
      continue;
    }

    // If in block scalar, check if we've exited
    if (inBlockScalar) {
      const indent = line.length - line.trimStart().length;
      if (indent === 0 && trimmed) inBlockScalar = false;
      else continue;
    }

    // Check for trailing spaces
    if (line.endsWith(' ') && strictMode) {
      messages.push({
        level: 'warning',
        message: 'Trailing whitespace',
        line: i + 1,
        fix: line.trimEnd(),
      });
    }

    // Check for duplicate colons in key (common mistake)
    if (trimmed.match(/^[\w-]+::/) && !trimmed.includes('::')) {
      messages.push({
        level: 'error',
        message: 'Double colon detected, likely a typo',
        line: i + 1,
      });
    }
  }

  // Parse the YAML
  const { data, error, errorLine } = parseSimpleYaml(content);

  if (error) {
    messages.push({ level: 'error', message: error, line: errorLine });
    return {
      file: filePath,
      errors: messages.filter(m => m.level === 'error').length,
      warnings: messages.filter(m => m.level === 'warning').length,
      messages,
    };
  }

  // Check for required 'on' trigger
  if (!data['on'] && !data['true']) { // 'on' sometimes parsed as boolean
    const line = findYamlLine(content, 'on');
    messages.push({ level: 'error', message: "Missing required 'on' trigger", line });
  }

  // Check for required 'jobs'
  if (!data['jobs']) {
    messages.push({ level: 'error', message: "Missing required 'jobs' section" });
  }

  // Check top-level keys
  for (const key of Object.keys(data)) {
    if (key === 'true' || key === 'false') continue; // YAML boolean parsing of 'on'
    if (!VALID_WORKFLOW_KEYS.has(key)) {
      const line = findYamlLine(content, key);
      messages.push({
        level: 'warning',
        message: `Unknown top-level key: "${key}"`,
        line,
      });
    }
  }

  // Check for deprecated actions in the raw content
  for (const [deprecated, replacement] of Object.entries(DEPRECATED_ACTIONS)) {
    const line = findYamlLine(content, 'uses', deprecated);
    if (line) {
      messages.push({
        level: 'warning',
        message: `Deprecated action: ${deprecated}. Use ${replacement} instead.`,
        line,
        fix: replacement,
      });
    }
  }

  // Check for common issues in raw content
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Check for hardcoded secrets
    if (trimmed.match(/password\s*[:=]\s*['"]\S+['"]/i) ||
        trimmed.match(/token\s*[:=]\s*['"]\S+['"]/i) ||
        trimmed.match(/secret\s*[:=]\s*['"]\S+['"]/i)) {
      if (!trimmed.includes('${{') && !trimmed.includes('secrets.')) {
        messages.push({
          level: 'error',
          message: 'Possible hardcoded secret. Use ${{ secrets.YOUR_SECRET }} instead.',
          line: i + 1,
        });
      }
    }

    // Check uses format
    if (trimmed.startsWith('uses:')) {
      const value = trimmed.substring(5).trim();
      if (value && !value.startsWith('.') && !value.includes('@') && !value.startsWith('docker://')) {
        messages.push({
          level: 'error',
          message: `Action "${value}" missing version tag. Pin to a specific version (e.g., @v4 or @sha).`,
          line: i + 1,
        });
      }
    }

    // Check for invalid expression syntax
    const exprMatches = trimmed.matchAll(/\$\{\{([^}]*)\}\}/g);
    for (const match of exprMatches) {
      const expr = match[1].trim();
      // Check for unclosed brackets, common mistakes
      const openParens = (expr.match(/\(/g) || []).length;
      const closeParens = (expr.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        messages.push({
          level: 'error',
          message: `Unbalanced parentheses in expression: \${{ ${expr} }}`,
          line: i + 1,
        });
      }
    }

    // Check for unclosed expressions
    if (trimmed.includes('${{') && !trimmed.includes('}}')) {
      // Check next few lines for closing
      let found = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].includes('}}')) { found = true; break; }
      }
      if (!found) {
        messages.push({
          level: 'error',
          message: 'Unclosed expression: ${{ without matching }}',
          line: i + 1,
        });
      }
    }

    // Check for runs-on (must be present in jobs)
    if (trimmed === 'runs-on:') {
      messages.push({
        level: 'error',
        message: 'runs-on has no value specified',
        line: i + 1,
      });
    }
  }

  const errors = messages.filter(m => m.level === 'error').length;
  const warnings = messages.filter(m => m.level === 'warning').length;

  return { file: filePath, errors, warnings, messages };
}

function applyFixes(content: string, messages: LintMessage[]): string {
  const lines = content.split('\n');

  // Apply line-based fixes in reverse order
  const fixable = messages.filter(m => m.fix && m.line).sort((a, b) => (b.line || 0) - (a.line || 0));

  for (const msg of fixable) {
    if (msg.line && msg.fix) {
      const lineIdx = msg.line - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        const line = lines[lineIdx];
        // Handle deprecated action fixes
        if (msg.message.startsWith('Deprecated action:')) {
          const oldAction = msg.message.match(/Deprecated action: (\S+)/)?.[1];
          if (oldAction && msg.fix) {
            lines[lineIdx] = line.replace(oldAction, msg.fix);
          }
        }
        // Handle tab fix
        else if (msg.message.includes('Tab indentation')) {
          lines[lineIdx] = msg.fix;
        }
        // Handle trailing whitespace fix
        else if (msg.message.includes('Trailing whitespace')) {
          lines[lineIdx] = msg.fix;
        }
      }
    }
  }

  return lines.join('\n');
}

function findWorkflowFiles(targetPath: string): string[] {
  const files: string[] = [];

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    files.push(targetPath);
    return files;
  }

  // Check for .github/workflows directory
  const workflowDir = path.join(targetPath, '.github', 'workflows');
  if (fs.existsSync(workflowDir)) {
    const entries = fs.readdirSync(workflowDir);
    for (const entry of entries) {
      if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
        files.push(path.join(workflowDir, entry));
      }
    }
  }

  // Also check target path directly for yaml files
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
        files.push(path.join(targetPath, entry));
      }
    }
  }

  return files;
}

function printResult(result: LintResult): void {
  const icon = result.errors > 0 ? `${c.red}\u2717` : result.warnings > 0 ? `${c.yellow}\u26A0` : `${c.green}\u2713`;

  console.log(`\n${icon}${c.reset} ${c.bold}${result.file}${c.reset}`);

  if (result.fixed) {
    console.log(`  ${c.green}(auto-fixed)${c.reset}`);
  }

  for (const msg of result.messages) {
    const levelIcon = msg.level === 'error' ? `${c.red}error` : `${c.yellow}warn `;
    const lineStr = msg.line ? `${c.dim}L${msg.line}${c.reset}` : `${c.dim}   ${c.reset}`;
    console.log(`  ${lineStr} ${levelIcon}${c.reset} ${msg.message}`);
    if (msg.fix && !result.fixed) {
      console.log(`        ${c.dim}fix: ${msg.fix}${c.reset}`);
    }
  }

  if (result.errors === 0 && result.warnings === 0) {
    console.log(`  ${c.green}No issues found${c.reset}`);
  }
}

function showHelp(): void {
  console.log(`
${c.bold}${c.cyan}pipelint${c.reset} - Validate GitHub Actions workflows offline

${c.bold}USAGE${c.reset}
  ${c.green}pipelint${c.reset} [path] [options]

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Lint workflows in current repo${c.reset}
  pipelint .

  ${c.dim}# Lint a specific file${c.reset}
  pipelint .github/workflows/ci.yml

  ${c.dim}# Auto-fix common issues${c.reset}
  pipelint . --fix

  ${c.dim}# Strict mode (warnings are errors)${c.reset}
  pipelint . --strict

  ${c.dim}# JSON output for CI${c.reset}
  pipelint . --json

${c.bold}OPTIONS${c.reset}
  --fix               Auto-fix common issues (deprecated actions, tabs, whitespace)
  --strict            Treat warnings as errors
  --json              Output results as JSON
  --help              Show this help message

${c.bold}CHECKS${c.reset}
  - Unknown top-level and job keys
  - Deprecated GitHub Actions versions
  - Missing required fields (on, jobs, runs-on)
  - Hardcoded secrets (should use \${{ secrets.* }})
  - Unversioned action references
  - Invalid expression syntax
  - Tab indentation (YAML requires spaces)
  - Trailing whitespace (strict mode)

${c.dim}Built by LXGIC Studios - https://github.com/lxgicstudios${c.reset}
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  const fixMode = args.includes('--fix');
  const strictMode = args.includes('--strict');

  // Get target path
  let targetPath = '.';
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      targetPath = arg;
      break;
    }
  }

  targetPath = path.resolve(targetPath);
  const files = findWorkflowFiles(targetPath);

  if (files.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: 'No workflow files found', path: targetPath }));
    } else {
      console.log(`\n${c.yellow}  No workflow files found at: ${targetPath}${c.reset}`);
      console.log(`${c.dim}  Looking for .yml/.yaml files in .github/workflows/ or the given path${c.reset}\n`);
    }
    process.exit(1);
  }

  if (!jsonMode) {
    console.log(`\n${c.bold}${c.cyan}  pipelint${c.reset} ${c.dim}Validating ${files.length} workflow file(s)${c.reset}`);
  }

  const results: LintResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const result = lintWorkflow(file, content, strictMode);

    if (fixMode) {
      const fixableMessages = result.messages.filter(m => m.fix);
      if (fixableMessages.length > 0) {
        const fixedContent = applyFixes(content, result.messages);
        fs.writeFileSync(file, fixedContent, 'utf-8');
        result.fixed = true;
        // Re-lint to get updated results
        const recheck = lintWorkflow(file, fixedContent, strictMode);
        result.errors = recheck.errors;
        result.warnings = recheck.warnings;
        result.messages = recheck.messages;
      }
    }

    totalErrors += result.errors;
    totalWarnings += result.warnings;
    results.push(result);
  }

  // In strict mode, warnings count as errors
  if (strictMode) {
    totalErrors += totalWarnings;
    totalWarnings = 0;
  }

  if (jsonMode) {
    console.log(JSON.stringify({ results, totalErrors, totalWarnings }, null, 2));
  } else {
    for (const result of results) {
      printResult(result);
    }

    console.log();
    if (totalErrors > 0) {
      console.log(`  ${c.bgRed}${c.white} FAIL ${c.reset} ${totalErrors} error(s), ${totalWarnings} warning(s)`);
    } else if (totalWarnings > 0) {
      console.log(`  ${c.bgYellow}${c.white} WARN ${c.reset} ${totalWarnings} warning(s)`);
    } else {
      console.log(`  ${c.bgGreen}${c.white} PASS ${c.reset} All workflows valid`);
    }
    console.log();
  }

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main();
