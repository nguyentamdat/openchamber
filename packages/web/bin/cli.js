#!/usr/bin/env node

import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { cloudflareTunnelProviderCapabilities } from '../server/lib/tunnels/providers/cloudflare.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3000;
const DEFAULT_TAIL_LINES = 200;
const LOG_ROTATE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_ROTATE_KEEP = 5;
const TUNNEL_PROFILES_VERSION = 1;
const TUNNEL_PROFILES_FILE_NAME = 'tunnel-profiles.json';
const LEGACY_CLOUDFLARE_MANAGED_REMOTE_FILE_NAME = 'cloudflare-managed-remote-tunnels.json';
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const DEFAULT_TUNNEL_PROVIDER_CAPABILITIES = [cloudflareTunnelProviderCapabilities];

const STYLE_ENABLED = process.stdout.isTTY && process.env.NO_COLOR !== '1';
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  info: '\x1b[94m',
  success: '\x1b[92m',
  warning: '\x1b[93m',
  error: '\x1b[91m',
};

const STATUS_SYMBOL = {
  success: '✓',
  neutral: '○',
  warning: '⚠',
  error: '✗',
};

function color(text, tone = 'reset') {
  if (!STYLE_ENABLED) return text;
  const start = ANSI[tone] || ANSI.reset;
  return `${start}${text}${ANSI.reset}`;
}

function printSectionStart(title) {
  console.log(`┌  ${title}`);
  console.log('│');
}

function printSectionEnd(text) {
  console.log(`└  ${text}`);
}

function printListItem({ status = 'neutral', line, detail }) {
  const symbol = STATUS_SYMBOL[status] || STATUS_SYMBOL.neutral;
  const tone = status === 'success' ? 'success' : status === 'warning' ? 'warning' : status === 'error' ? 'error' : 'info';
  console.log(`${color('●', tone)}  ${color(symbol, tone)} ${line}`);
  if (detail) {
    console.log(`│      ${color(detail, 'dim')}`);
  }
  console.log('│');
}

function importFromFilePath(filePath) {
  return import(pathToFileURL(filePath).href);
}

function getBunBinary() {
  if (typeof process.env.BUN_BINARY === 'string' && process.env.BUN_BINARY.trim().length > 0) {
    return process.env.BUN_BINARY.trim();
  }
  if (typeof process.env.BUN_INSTALL === 'string' && process.env.BUN_INSTALL.trim().length > 0) {
    return path.join(process.env.BUN_INSTALL.trim(), 'bin', 'bun');
  }
  return 'bun';
}

const BUN_BIN = getBunBinary();

function isBunRuntime() {
  return typeof globalThis.Bun !== 'undefined';
}

function isBunInstalled() {
  try {
    const result = spawnSync(BUN_BIN, ['--version'], { stdio: 'ignore', env: process.env });
    return result.status === 0;
  } catch {
    return false;
  }
}

function getPreferredServerRuntime() {
  return isBunInstalled() ? 'bun' : 'node';
}

async function displayTunnelQrCode(url) {
  try {
    const qrcode = await import('qrcode-terminal');
    console.log('\n📱 Scan this QR code to access the tunnel:\n');
    qrcode.default.generate(url, { small: true });
    console.log('');
  } catch (error) {
    console.warn(`Warning: Could not generate QR code: ${error.message}`);
  }
}

function splitOptionToken(arg) {
  if (!arg.startsWith('-')) return null;
  if (arg.startsWith('--')) {
    const eqIndex = arg.indexOf('=');
    return {
      name: eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2),
      inlineValue: eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined,
      long: true,
    };
  }
  return {
    name: arg.slice(1),
    inlineValue: undefined,
    long: false,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const options = {
    port: DEFAULT_PORT,
    uiPassword: process.env.OPENCHAMBER_UI_PASSWORD || undefined,
    json: false,
    all: false,
    follow: true,
    lines: DEFAULT_TAIL_LINES,
    provider: undefined,
    mode: undefined,
    profile: undefined,
    name: undefined,
    configPath: undefined,
    token: undefined,
    hostname: undefined,
    qr: false,
    force: false,
    explicitPort: false,
    explicitUiPassword: false,
  };

  const removedFlagErrors = [];
  const positional = [];
  let helpRequested = false;
  let versionRequested = false;

  const consumeValue = (index, inlineValue) => {
    if (typeof inlineValue === 'string' && inlineValue.length > 0) {
      return { value: inlineValue, nextIndex: index };
    }
    const candidate = args[index + 1];
    if (typeof candidate === 'string' && !candidate.startsWith('-')) {
      return { value: candidate, nextIndex: index + 1 };
    }
    return { value: undefined, nextIndex: index };
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const parsedToken = splitOptionToken(arg);
    if (!parsedToken) {
      positional.push(arg);
      continue;
    }

    const { name, inlineValue, long } = parsedToken;
    switch (name) {
      case 'port':
      case 'p': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        const parsed = parseInt(value ?? '', 10);
        options.port = Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
        options.explicitPort = true;
        break;
      }
      case 'ui-password': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.uiPassword = typeof value === 'string' ? value : '';
        options.explicitUiPassword = true;
        break;
      }
      case 'provider': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.provider = typeof value === 'string' ? value : options.provider;
        break;
      }
      case 'mode': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.mode = typeof value === 'string' ? value : options.mode;
        break;
      }
      case 'profile': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.profile = typeof value === 'string' ? value : options.profile;
        break;
      }
      case 'name': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.name = typeof value === 'string' ? value : options.name;
        break;
      }
      case 'config': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.configPath = typeof value === 'string' ? value : null;
        break;
      }
      case 'token': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.token = typeof value === 'string' ? value : options.token;
        break;
      }
      case 'hostname': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        options.hostname = typeof value === 'string' ? value : options.hostname;
        break;
      }
      case 'json':
        options.json = true;
        break;
      case 'all':
        options.all = true;
        break;
      case 'no-follow':
        options.follow = false;
        break;
      case 'lines': {
        const { value, nextIndex } = consumeValue(i, inlineValue);
        i = nextIndex;
        const parsed = parseInt(value ?? '', 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          options.lines = parsed;
        }
        break;
      }
      case 'qr':
        options.qr = true;
        break;
      case 'force':
        options.force = true;
        break;
      case 'help':
      case 'h':
        helpRequested = true;
        break;
      case 'version':
      case 'v':
        versionRequested = true;
        break;
      case 'daemon':
      case 'd':
        removedFlagErrors.push('`--daemon` was removed. OpenChamber now always runs in daemon mode.');
        break;
      case 'try-cf-tunnel':
        removedFlagErrors.push('`--try-cf-tunnel` was removed. Use: openchamber tunnel start --provider cloudflare --mode quick');
        break;
      case 'tunnel-qr':
        removedFlagErrors.push('`--tunnel-qr` was removed. Use: openchamber tunnel start ... --qr');
        break;
      case 'tunnel-password-url':
        removedFlagErrors.push('`--tunnel-password-url` was removed. Use UI password auth directly after tunnel start.');
        break;
      case 'tunnel-provider':
      case 'tunnel-mode':
      case 'tunnel-config':
      case 'tunnel-token':
      case 'tunnel-hostname':
      case 'tunnel':
        removedFlagErrors.push(`\`--${name}\` was removed from top-level serve flow. Use: openchamber tunnel start ...`);
        break;
      default:
        if (!long && name.length === 1) {
          removedFlagErrors.push(`Unknown option: -${name}`);
        } else {
          removedFlagErrors.push(`Unknown option: --${name}`);
        }
        break;
    }
  }

  const command = positional[0] || 'serve';
  const subcommand = command === 'tunnel' ? (positional[1] || 'help') : null;
  const tunnelAction = command === 'tunnel' ? (positional[2] || null) : null;

  return {
    command,
    subcommand,
    tunnelAction,
    options,
    removedFlagErrors,
    helpRequested,
    versionRequested,
  };
}

function showHelp() {
  console.log(`
 OpenChamber - Web interface for the OpenCode AI coding agent

USAGE:
  openchamber [COMMAND] [OPTIONS]

COMMANDS:
  serve          Start the web server (daemon default)
  stop           Stop running instance(s)
  restart        Stop and start the server
  status         Show server status
  tunnel         Tunnel lifecycle commands
  logs           Tail OpenChamber logs
  update         Check for and install updates

OPTIONS:
  -p, --port              Web server port (default: ${DEFAULT_PORT})
  --ui-password           Protect browser UI with single password
  -h, --help              Show help
  -v, --version           Show version

ENVIRONMENT:
  OPENCHAMBER_UI_PASSWORD      Alternative to --ui-password flag
  OPENCHAMBER_DATA_DIR         Override OpenChamber data directory
  OPENCODE_HOST               External OpenCode server base URL, e.g. http://hostname:4096
  OPENCODE_PORT               Port of external OpenCode server to connect to
  OPENCODE_SKIP_START          Skip starting OpenCode, use external server

EXAMPLES:
  openchamber                    # Start in daemon mode on default port 3000 (or free port)
  openchamber --port 8080        # Start on port 8080 (daemon)
  openchamber tunnel help        # Show tunnel lifecycle help
  openchamber logs               # Follow logs for latest running instance
`);
}

function showTunnelHelp() {
  console.log(`
 Tunnel Lifecycle Commands

USAGE:
  openchamber tunnel <SUBCOMMAND> [OPTIONS]

SUBCOMMANDS:
  help        Show this tunnel help
  providers   Show available tunnel providers and capabilities
  check       Check tunnel dependencies for a provider
  status      Show tunnel status
  start       Start a tunnel
  stop        Stop active tunnel (keep server running)
  profile     Manage saved managed-remote profiles

COMMON OPTIONS:
  -p, --port              Target OpenChamber instance port
  --json                  Output machine-readable JSON
  --all                   Apply to all running instances (status/stop)

START OPTIONS:
  --provider <id>         Tunnel provider id (required)
  --mode <id>             Tunnel mode (required)
  --profile <name>        Start tunnel from saved profile name
  --config [path]         Managed-local config path (optional)
  --token <token>         Managed-remote token
  --hostname <hostname>   Managed-remote hostname
  --qr                    Print QR code for resulting tunnel URL

PROFILE USAGE:
  openchamber tunnel profile list [--provider <id>] [--json]
  openchamber tunnel profile show --name <name> [--provider <id>] [--json]
  openchamber tunnel profile add --provider <id> --mode managed-remote --name <name> --hostname <host> --token <token> [--force] [--json]
  openchamber tunnel profile remove --name <name> [--provider <id>] [--json]

EXAMPLES:
  openchamber tunnel providers
  openchamber tunnel check --provider cloudflare
  openchamber tunnel status --all
  openchamber tunnel start --provider cloudflare --mode quick --qr
  openchamber tunnel start --profile prod-main
  openchamber tunnel start --provider cloudflare --mode managed-remote --token <token> --hostname app.example.com
  openchamber tunnel start --provider cloudflare --mode managed-local --config ~/.cloudflared/config.yml
  openchamber tunnel profile add --provider cloudflare --mode managed-remote --name prod-main --hostname app.example.com --token <token>
  openchamber tunnel profile list --provider cloudflare
  openchamber tunnel stop --port 3000
`);
}

function getDataDir() {
  if (typeof process.env.OPENCHAMBER_DATA_DIR === 'string' && process.env.OPENCHAMBER_DATA_DIR.trim().length > 0) {
    return path.resolve(process.env.OPENCHAMBER_DATA_DIR.trim());
  }
  return path.join(os.homedir(), '.config', 'openchamber');
}

function getLogsDir() {
  return path.join(getDataDir(), 'logs');
}

function ensureLogsDir() {
  fs.mkdirSync(getLogsDir(), { recursive: true });
}

function getLogFilePath(port) {
  return path.join(getLogsDir(), `openchamber-${port}.log`);
}

function getTunnelProfilesFilePath() {
  return path.join(getDataDir(), TUNNEL_PROFILES_FILE_NAME);
}

function getLegacyCloudflareManagedRemoteFilePath() {
  return path.join(getDataDir(), LEGACY_CLOUDFLARE_MANAGED_REMOTE_FILE_NAME);
}

function normalizeProfileProvider(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeProfileMode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeProfileName(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeProfileHostname(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeProfileToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function maskToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return '***';
  }
  if (token.length <= 4) {
    return '*'.repeat(token.length);
  }
  return `${'*'.repeat(Math.max(4, token.length - 4))}${token.slice(-4)}`;
}

function sanitizeTunnelProfilesData(data) {
  const parsed = data && typeof data === 'object' ? data : {};
  const list = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  const seen = new Set();
  const profiles = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : crypto.randomUUID();
    const provider = normalizeProfileProvider(entry.provider);
    const mode = normalizeProfileMode(entry.mode);
    const name = normalizeProfileName(entry.name);
    const hostname = normalizeProfileHostname(entry.hostname);
    const token = normalizeProfileToken(entry.token);
    if (!provider || !mode || !name || !hostname || !token) continue;
    const key = `${provider}::${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({
      id,
      name,
      provider,
      mode,
      hostname,
      token,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
    });
  }
  return { version: TUNNEL_PROFILES_VERSION, profiles };
}

function readTunnelProfilesFromDisk() {
  try {
    const raw = fs.readFileSync(getTunnelProfilesFilePath(), 'utf8');
    return sanitizeTunnelProfilesData(JSON.parse(raw));
  } catch {
    return { version: TUNNEL_PROFILES_VERSION, profiles: [] };
  }
}

function writeTunnelProfilesToDisk(data) {
  const filePath = getTunnelProfilesFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sanitizeTunnelProfilesData(data), null, 2), { encoding: 'utf8', mode: 0o600 });
}

function readLegacyManagedRemoteEntries() {
  try {
    const raw = fs.readFileSync(getLegacyCloudflareManagedRemoteFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const tunnels = Array.isArray(parsed?.tunnels) ? parsed.tunnels : [];
    return tunnels
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : crypto.randomUUID();
        const name = normalizeProfileName(entry.name);
        const hostname = normalizeProfileHostname(entry.hostname);
        const token = normalizeProfileToken(entry.token);
        if (!name || !hostname || !token) return null;
        return {
          id,
          name,
          provider: 'cloudflare',
          mode: 'managed-remote',
          hostname,
          token,
          createdAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
          updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function makeUniqueProfileName(provider, desiredName, existingProfiles) {
  const normalizedDesired = normalizeProfileName(desiredName);
  if (!normalizedDesired) {
    return '';
  }
  const existingNames = new Set(
    existingProfiles
      .filter((entry) => entry.provider === provider)
      .map((entry) => entry.name.toLowerCase())
  );

  if (!existingNames.has(normalizedDesired.toLowerCase())) {
    return normalizedDesired;
  }

  let index = 2;
  while (true) {
    const candidate = `${normalizedDesired}-${index}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
}

function ensureTunnelProfilesMigrated() {
  const current = readTunnelProfilesFromDisk();
  if (current.profiles.length > 0) {
    return current;
  }

  const legacyEntries = readLegacyManagedRemoteEntries();
  if (legacyEntries.length === 0) {
    return current;
  }

  const migratedProfiles = [];
  for (const entry of legacyEntries) {
    const name = makeUniqueProfileName(entry.provider, entry.name, migratedProfiles);
    migratedProfiles.push({ ...entry, name });
  }

  const migrated = sanitizeTunnelProfilesData({ version: TUNNEL_PROFILES_VERSION, profiles: migratedProfiles });
  writeTunnelProfilesToDisk(migrated);
  return migrated;
}

function resolveProfileByName(profiles, profileName, provider) {
  const normalizedName = normalizeProfileName(profileName).toLowerCase();
  const normalizedProvider = normalizeProfileProvider(provider);
  const matches = profiles.filter((entry) => {
    if (entry.name.toLowerCase() !== normalizedName) return false;
    if (!normalizedProvider) return true;
    return entry.provider === normalizedProvider;
  });

  if (matches.length === 0) {
    return { profile: null, error: `No tunnel profile found for name '${profileName}'. Run 'openchamber tunnel profile list'.` };
  }
  if (matches.length > 1) {
    return { profile: null, error: `Profile name '${profileName}' exists for multiple providers. Use --provider <id>.` };
  }
  return { profile: matches[0], error: null };
}

function rotateLogFile(logPath) {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size < LOG_ROTATE_MAX_BYTES) {
      return;
    }
  } catch {
    return;
  }

  for (let i = LOG_ROTATE_KEEP - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`;
    const dst = `${logPath}.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dst);
      } catch {
      }
    }
  }

  try {
    if (fs.existsSync(logPath)) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
  }
}

const WINDOWS_EXTENSIONS = process.platform === 'win32'
  ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((ext) => ext.trim().toLowerCase())
      .filter(Boolean)
      .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
  : [''];

function isExecutable(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExplicitBinary(candidate) {
  if (!candidate) {
    return null;
  }
  if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    return isExecutable(resolved) ? resolved : null;
  }
  return null;
}

function searchPathFor(command) {
  const pathValue = process.env.PATH || '';
  const segments = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of segments) {
    for (const ext of WINDOWS_EXTENSIONS) {
      const fileName = process.platform === 'win32' ? `${command}${ext}` : command;
      const candidate = path.join(dir, fileName);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function checkOpenCodeCLI() {
  if (process.env.OPENCODE_BINARY) {
    const override = resolveExplicitBinary(process.env.OPENCODE_BINARY);
    if (override) {
      process.env.OPENCODE_BINARY = override;
      return override;
    }
    console.warn(`Warning: OPENCODE_BINARY="${process.env.OPENCODE_BINARY}" is not an executable file. Falling back to PATH lookup.`);
  }

  const resolvedFromPath = searchPathFor('opencode');
  if (resolvedFromPath) {
    process.env.OPENCODE_BINARY = resolvedFromPath;
    return resolvedFromPath;
  }

  console.error('Error: Unable to locate the opencode CLI on PATH.');
  console.error(`Current PATH: ${process.env.PATH || '<empty>'}`);
  console.error('Ensure the CLI is installed and reachable, or set OPENCODE_BINARY to its full path.');
  process.exit(1);
}

async function isPortAvailable(port) {
  if (!Number.isFinite(port) || port <= 0) {
    return false;
  }

  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function resolveAvailablePort(desiredPort, explicitPort = false) {
  const startPort = Number.isFinite(desiredPort) ? Math.trunc(desiredPort) : DEFAULT_PORT;
  if (explicitPort) {
    return startPort;
  }
  if (await isPortAvailable(startPort)) {
    return startPort;
  }
  console.warn(`Port ${startPort} in use; using a free port`);
  return 0;
}

async function getPidFilePath(port) {
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, `openchamber-${port}.pid`);
}

async function getInstanceFilePath(port) {
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, `openchamber-${port}.json`);
}

function readPidFile(pidFilePath) {
  try {
    const content = fs.readFileSync(pidFilePath, 'utf8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(pidFilePath, pid) {
  try {
    fs.writeFileSync(pidFilePath, String(pid));
  } catch (error) {
    console.warn(`Warning: Could not write PID file: ${error.message}`);
  }
}

function removePidFile(pidFilePath) {
  try {
    if (fs.existsSync(pidFilePath)) {
      fs.unlinkSync(pidFilePath);
    }
  } catch {
  }
}

function readInstanceOptions(instanceFilePath) {
  try {
    return JSON.parse(fs.readFileSync(instanceFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeInstanceOptions(instanceFilePath, options) {
  try {
    const toStore = {
      port: options.port,
      uiPassword: typeof options.uiPassword === 'string' ? options.uiPassword : undefined,
      hasUiPassword: typeof options.uiPassword === 'string',
    };
    fs.writeFileSync(instanceFilePath, JSON.stringify(toStore, null, 2));
  } catch (error) {
    console.warn(`Warning: Could not write instance file: ${error.message}`);
  }
}

function removeInstanceFile(instanceFilePath) {
  try {
    if (fs.existsSync(instanceFilePath)) {
      fs.unlinkSync(instanceFilePath);
    }
  } catch {
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function requestServerShutdown(port) {
  if (!Number.isFinite(port) || port <= 0) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/system/shutdown`, {
      method: 'POST',
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(port, endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverRunningInstances() {
  const instances = [];
  const tmpDir = os.tmpdir();
  try {
    const files = fs.readdirSync(tmpDir);
    const pidFiles = files.filter((file) => file.startsWith('openchamber-') && file.endsWith('.pid'));
    for (const file of pidFiles) {
      const port = parseInt(file.replace('openchamber-', '').replace('.pid', ''), 10);
      if (!Number.isFinite(port) || port <= 0) continue;
      const pidFilePath = path.join(tmpDir, file);
      const pid = readPidFile(pidFilePath);
      if (!pid || !isProcessRunning(pid)) {
        removePidFile(pidFilePath);
        removeInstanceFile(path.join(tmpDir, `openchamber-${port}.json`));
        continue;
      }
      const instanceFilePath = path.join(tmpDir, `openchamber-${port}.json`);
      let mtime = 0;
      try {
        mtime = fs.statSync(pidFilePath).mtimeMs;
      } catch {
      }
      instances.push({ port, pid, pidFilePath, instanceFilePath, mtime });
    }
  } catch {
  }
  instances.sort((a, b) => a.port - b.port);
  return instances;
}

function getLatestInstance(instances) {
  if (!instances.length) return null;
  return [...instances].sort((a, b) => b.mtime - a.mtime)[0];
}

async function fetchTunnelProvidersFromPort(port, fetchImpl = globalThis.fetch) {
  if (!Number.isFinite(port) || port <= 0 || typeof fetchImpl !== 'function') {
    return null;
  }
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/openchamber/tunnel/providers`);
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.providers)) return null;
    return body.providers;
  } catch {
    return null;
  }
}

async function resolveTunnelProviders(options = {}, deps = {}) {
  const readPorts = typeof deps.readPorts === 'function'
    ? deps.readPorts
    : async () => (await discoverRunningInstances()).map((entry) => entry.port);
  const fetchImpl = typeof deps.fetchImpl === 'function' ? deps.fetchImpl : globalThis.fetch;

  const candidatePorts = [];
  if (Number.isFinite(options.port) && options.port > 0) {
    candidatePorts.push(options.port);
  }

  const discoveredPorts = await Promise.resolve(readPorts());
  if (Array.isArray(discoveredPorts)) {
    candidatePorts.push(...discoveredPorts);
  }

  if (!candidatePorts.includes(DEFAULT_PORT)) {
    candidatePorts.push(DEFAULT_PORT);
  }

  for (const port of candidatePorts) {
    const providers = await fetchTunnelProvidersFromPort(port, fetchImpl);
    if (providers) {
      return { providers, source: `api:${port}` };
    }
  }

  return { providers: DEFAULT_TUNNEL_PROVIDER_CAPABILITIES, source: 'fallback' };
}

async function resolveTargetInstance({
  options,
  allowAutoStart,
  requireAll = false,
}) {
  let running = await discoverRunningInstances();

  if (options.all && requireAll) {
    if (running.length === 0) {
      throw new Error('No running OpenChamber instance found. Start one with `openchamber serve`.');
    }
    return running;
  }

  if (options.explicitPort) {
    const found = running.find((entry) => entry.port === options.port);
    if (found) {
      return found;
    }
    if (allowAutoStart) {
      await commands.serve({ port: options.port, explicitPort: true, uiPassword: options.uiPassword });
      running = await discoverRunningInstances();
      const started = running.find((entry) => entry.port === options.port);
      if (started) return started;
    }
    throw new Error(`No running OpenChamber instance found on port ${options.port}.`);
  }

  if (running.length === 1) {
    return running[0];
  }

  if (running.length === 0) {
    if (allowAutoStart) {
      const startedPort = await commands.serve({ ...options, explicitPort: false });
      running = await discoverRunningInstances();
      const started = running.find((entry) => entry.port === startedPort) || getLatestInstance(running);
      if (started) return started;
    }
    throw new Error('No running OpenChamber instance found. Start one with `openchamber serve`.');
  }

  const ports = running.map((entry) => entry.port).join(', ');
  throw new Error(`Multiple OpenChamber instances found: ${ports}. Use --port <port> or --all.`);
}

function formatTunnelStatusLine(statusBody, port) {
  const active = Boolean(statusBody?.active);
  const provider = statusBody?.provider || 'unknown';
  const mode = statusBody?.mode || 'unknown';
  const url = statusBody?.url || 'n/a';
  return {
    status: active ? 'success' : 'neutral',
    line: `port ${port} ${active ? 'active' : 'inactive'} (${provider}/${mode})`,
    detail: url,
  };
}

function readTailLines(filePath, lineCount = DEFAULT_TAIL_LINES) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(Math.max(0, lines.length - lineCount));
}

function followFile(filePath, onLine) {
  let position = 0;
  try {
    position = fs.statSync(filePath).size;
  } catch {
    position = 0;
  }

  let remainder = '';
  const interval = setInterval(() => {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size < position) {
        position = 0;
      }
      if (stats.size === position) {
        return;
      }

      const fd = fs.openSync(filePath, 'r');
      try {
        const length = stats.size - position;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, position);
        position = stats.size;
        const chunk = remainder + buffer.toString('utf8');
        const parts = chunk.split(/\r?\n/);
        remainder = parts.pop() || '';
        for (const line of parts) {
          onLine(line);
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
    }
  }, 400);

  return () => {
    clearInterval(interval);
  };
}

async function handleTunnelProfileSubcommand(options, action) {
  const sub = action || 'list';
  const store = ensureTunnelProfilesMigrated();

  if (sub === 'list') {
    const providerFilter = normalizeProfileProvider(options.provider);
    const profiles = providerFilter
      ? store.profiles.filter((entry) => entry.provider === providerFilter)
      : store.profiles;
    if (options.json) {
      console.log(JSON.stringify({ profiles }, null, 2));
      return;
    }

    printSectionStart('Tunnel Profiles');
    for (const profile of profiles) {
      printListItem({
        status: 'success',
        line: `${profile.name} (${profile.provider}/${profile.mode})`,
        detail: `${profile.hostname} token:${maskToken(profile.token)}`,
      });
    }
    printSectionEnd(`${profiles.length} profile(s)`);
    return;
  }

  if (sub === 'show') {
    const name = normalizeProfileName(options.name);
    if (!name) {
      throw new Error('`tunnel profile show` requires --name <name>.');
    }
    const { profile, error } = resolveProfileByName(store.profiles, name, options.provider);
    if (!profile) {
      throw new Error(error);
    }
    if (options.json) {
      console.log(JSON.stringify({ profile }, null, 2));
      return;
    }
    printSectionStart('Tunnel Profile');
    printListItem({
      status: 'success',
      line: `${profile.name} (${profile.provider}/${profile.mode})`,
      detail: `${profile.hostname} token:${maskToken(profile.token)}`,
    });
    printSectionEnd('show complete');
    return;
  }

  if (sub === 'add') {
    const provider = normalizeProfileProvider(options.provider);
    const mode = normalizeProfileMode(options.mode);
    const name = normalizeProfileName(options.name);
    const hostname = normalizeProfileHostname(options.hostname);
    const token = normalizeProfileToken(options.token);

    if (!provider || !mode || !name || !hostname || !token) {
      throw new Error('`tunnel profile add` requires --provider, --mode managed-remote, --name, --hostname, and --token.');
    }
    if (mode !== 'managed-remote') {
      throw new Error('`tunnel profile add` currently supports only --mode managed-remote.');
    }

    const existingIndex = store.profiles.findIndex(
      (entry) => entry.provider === provider && entry.name.toLowerCase() === name.toLowerCase()
    );

    if (existingIndex >= 0 && !options.force) {
      throw new Error(`Profile '${name}' already exists for provider '${provider}'. Use --force to overwrite.`);
    }

    const next = [...store.profiles];
    const now = Date.now();
    if (existingIndex >= 0) {
      const current = next[existingIndex];
      next[existingIndex] = {
        ...current,
        mode,
        hostname,
        token,
        updatedAt: now,
      };
    } else {
      next.push({
        id: crypto.randomUUID(),
        name,
        provider,
        mode,
        hostname,
        token,
        createdAt: now,
        updatedAt: now,
      });
    }

    const persisted = { version: TUNNEL_PROFILES_VERSION, profiles: next };
    writeTunnelProfilesToDisk(persisted);
    const added = persisted.profiles.find((entry) => entry.provider === provider && entry.name.toLowerCase() === name.toLowerCase());

    if (options.json) {
      console.log(JSON.stringify({ ok: true, profile: added }, null, 2));
      return;
    }

    printSectionStart('Tunnel Profile Saved');
    printListItem({
      status: 'success',
      line: `${added.name} (${added.provider}/${added.mode})`,
      detail: `${added.hostname} token:${maskToken(added.token)}`,
    });
    printSectionEnd('save complete');
    return;
  }

  if (sub === 'remove') {
    const name = normalizeProfileName(options.name);
    if (!name) {
      throw new Error('`tunnel profile remove` requires --name <name>.');
    }
    const { profile, error } = resolveProfileByName(store.profiles, name, options.provider);
    if (!profile) {
      throw new Error(error);
    }

    const next = store.profiles.filter((entry) => entry.id !== profile.id);
    writeTunnelProfilesToDisk({ version: TUNNEL_PROFILES_VERSION, profiles: next });

    if (options.json) {
      console.log(JSON.stringify({ ok: true, removed: profile }, null, 2));
      return;
    }

    printSectionStart('Tunnel Profile Removed');
    printListItem({
      status: 'success',
      line: `${profile.name} (${profile.provider}/${profile.mode})`,
      detail: profile.hostname,
    });
    printSectionEnd('remove complete');
    return;
  }

  throw new Error(`Unknown tunnel profile subcommand '${sub}'. Use 'openchamber tunnel help'.`);
}

const commands = {
  async serve(options) {
    const explicitPort = options.explicitPort === true;
    const targetPort = await resolveAvailablePort(options.port, explicitPort);

    if (targetPort !== 0) {
      const pidFilePath = await getPidFilePath(targetPort);
      const existingPid = readPidFile(pidFilePath);
      if (existingPid && isProcessRunning(existingPid)) {
        throw new Error(`OpenChamber is already running on port ${targetPort} (PID: ${existingPid})`);
      }
    }

    const opencodeBinary = await checkOpenCodeCLI();
    const serverPath = path.join(__dirname, '..', 'server', 'index.js');
    const preferredRuntime = getPreferredServerRuntime();
    const runtimeBin = preferredRuntime === 'bun' ? BUN_BIN : process.execPath;

    ensureLogsDir();
    const initialLogPort = targetPort === 0 ? 'auto' : String(targetPort);
    const initialLogPath = getLogFilePath(initialLogPort);
    rotateLogFile(initialLogPath);
    const logFd = fs.openSync(initialLogPath, 'a');

    const effectiveUiPassword = typeof options.uiPassword === 'string' ? options.uiPassword : undefined;
    const serverArgs = [serverPath, '--port', String(targetPort)];
    if (effectiveUiPassword) {
      serverArgs.push('--ui-password', effectiveUiPassword);
    }

    const child = spawn(runtimeBin, serverArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd, 'ipc'],
      env: {
        ...process.env,
        OPENCHAMBER_PORT: String(targetPort),
        OPENCODE_BINARY: opencodeBinary,
        ...(effectiveUiPassword ? { OPENCHAMBER_UI_PASSWORD: effectiveUiPassword } : {}),
        ...(process.env.OPENCODE_SKIP_START ? { OPENCHAMBER_SKIP_OPENCODE_START: process.env.OPENCODE_SKIP_START } : {}),
      },
    });

    child.unref();

    const resolvedPort = await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(targetPort);
      }, 5000);

      child.on('message', (msg) => {
        if (settled) return;
        if (msg && msg.type === 'openchamber:ready' && typeof msg.port === 'number') {
          settled = true;
          clearTimeout(timeout);
          resolve(msg.port);
        }
      });

      child.on('exit', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(targetPort);
      });
    });

    try {
      if (typeof child.disconnect === 'function' && child.connected) {
        child.disconnect();
      }
    } catch {
    }

    try {
      fs.closeSync(logFd);
    } catch {
    }

    const resolvedLogPath = getLogFilePath(resolvedPort);
    if (initialLogPath !== resolvedLogPath && !fs.existsSync(resolvedLogPath)) {
      try {
        fs.renameSync(initialLogPath, resolvedLogPath);
      } catch {
      }
    }

    if (!isProcessRunning(child.pid)) {
      throw new Error('Failed to start server in daemon mode');
    }

    const pidFilePath = await getPidFilePath(resolvedPort);
    const instanceFilePath = await getInstanceFilePath(resolvedPort);
    writePidFile(pidFilePath, child.pid);
    writeInstanceOptions(instanceFilePath, {
      port: resolvedPort,
      uiPassword: effectiveUiPassword,
    });

    console.log(`OpenChamber started in daemon mode on port ${resolvedPort}`);
    console.log(`PID: ${child.pid}`);
    console.log(`Visit: http://localhost:${resolvedPort}`);
    console.log(`Logs: ${resolvedLogPath}`);

    return resolvedPort;
  },

  async stop(options) {
    let runningInstances = await discoverRunningInstances();
    if (runningInstances.length === 0) {
      console.log('No running OpenChamber instances found');
      return;
    }

    if (options.explicitPort) {
      runningInstances = runningInstances.filter((entry) => entry.port === options.port);
      if (runningInstances.length === 0) {
        console.log(`No OpenChamber instance found running on port ${options.port}`);
        return;
      }
    }

    for (const instance of runningInstances) {
      console.log(`Stopping OpenChamber on port ${instance.port} (PID: ${instance.pid})...`);
      try {
        await requestServerShutdown(instance.port);
        process.kill(instance.pid, 'SIGTERM');
        let attempts = 0;
        while (isProcessRunning(instance.pid) && attempts < 20) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          attempts++;
        }
        if (isProcessRunning(instance.pid)) {
          process.kill(instance.pid, 'SIGKILL');
        }
        removePidFile(instance.pidFilePath);
        removeInstanceFile(instance.instanceFilePath);
      } catch (error) {
        console.error(`Error stopping port ${instance.port}: ${error.message}`);
      }
    }
  },

  async restart(options) {
    let runningInstances = await discoverRunningInstances();
    if (runningInstances.length === 0) {
      console.log('No running OpenChamber instances to restart');
      return;
    }

    if (options.explicitPort) {
      runningInstances = runningInstances.filter((entry) => entry.port === options.port);
      if (runningInstances.length === 0) {
        console.log(`No OpenChamber instance found running on port ${options.port}`);
        return;
      }
    }

    for (const instance of runningInstances) {
      const storedOptions = readInstanceOptions(instance.instanceFilePath) || { port: instance.port };
      await this.stop({ explicitPort: true, port: instance.port });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await this.serve({
        port: options.explicitPort ? options.port : (storedOptions.port || instance.port),
        explicitPort: true,
        uiPassword: options.explicitUiPassword ? options.uiPassword : storedOptions.uiPassword,
      });
    }
  },

  async status() {
    const runningInstances = await discoverRunningInstances();
    if (runningInstances.length === 0) {
      console.log('OpenChamber Status:');
      console.log('  Status: Stopped');
      return;
    }

    console.log('OpenChamber Status:');
    for (const instance of runningInstances) {
      console.log(`  ✓ Port ${instance.port} (PID: ${instance.pid})`);
    }
  },

  async tunnel(options, subcommand, action) {
    switch (subcommand) {
      case 'help':
        showTunnelHelp();
        return;
      case 'profile':
        await handleTunnelProfileSubcommand(options, action);
        return;
      case 'providers': {
        const result = await resolveTunnelProviders(options, {
          readPorts: async () => (await discoverRunningInstances()).map((entry) => entry.port),
        });
        if (options.json) {
          console.log(JSON.stringify({ providers: result.providers, source: result.source }, null, 2));
          return;
        }
        printSectionStart('Tunnel Providers');
        for (const provider of result.providers) {
          const modeCount = Array.isArray(provider?.modes) ? provider.modes.length : 0;
          printListItem({
            status: 'success',
            line: `${provider.provider}`,
            detail: `${modeCount} mode(s)`,
          });
        }
        printSectionEnd(`${result.providers.length} provider(s)`);
        return;
      }
      case 'check': {
        const instance = await resolveTargetInstance({ options, allowAutoStart: false });
        const provider = typeof options.provider === 'string' && options.provider.trim().length > 0
          ? options.provider.trim().toLowerCase()
          : 'cloudflare';
        const { response, body } = await requestJson(instance.port, `/api/openchamber/tunnel/check?provider=${encodeURIComponent(provider)}`);
        if (!response.ok) {
          throw new Error(body?.error || `Tunnel check failed (${response.status})`);
        }
        if (options.json) {
          console.log(JSON.stringify({ port: instance.port, ...body }, null, 2));
          return;
        }
        printSectionStart('Tunnel Check');
        printListItem({
          status: body?.available ? 'success' : 'warning',
          line: `port ${instance.port} provider ${body?.provider || provider}`,
          detail: body?.available ? `available (${body?.version || 'unknown version'})` : 'missing dependency',
        });
        printSectionEnd('check complete');
        return;
      }
      case 'status': {
        let entries;
        if (options.all) {
          entries = await resolveTargetInstance({ options, allowAutoStart: false, requireAll: true });
        } else {
          entries = [await resolveTargetInstance({ options, allowAutoStart: false })];
        }

        const results = [];
        for (const entry of entries) {
          try {
            const { response, body } = await requestJson(entry.port, '/api/openchamber/tunnel/status');
            if (!response.ok) {
              results.push({ port: entry.port, error: body?.error || `status ${response.status}` });
              continue;
            }
            results.push({ port: entry.port, status: body });
          } catch (error) {
            results.push({ port: entry.port, error: error instanceof Error ? error.message : String(error) });
          }
        }

        if (options.json) {
          console.log(JSON.stringify({ instances: results }, null, 2));
          return;
        }
        printSectionStart('Tunnel Status');
        for (const result of results) {
          if (result.error) {
            printListItem({ status: 'error', line: `port ${result.port} failed`, detail: result.error });
            continue;
          }
          printListItem(formatTunnelStatusLine(result.status, result.port));
        }
        printSectionEnd(`${results.length} instance(s)`);
        return;
      }
      case 'start': {
        let provider = typeof options.provider === 'string' && options.provider.trim().length > 0
          ? options.provider.trim().toLowerCase()
          : '';
        let mode = typeof options.mode === 'string' && options.mode.trim().length > 0
          ? options.mode.trim().toLowerCase()
          : '';
        let token = typeof options.token === 'string' ? options.token : undefined;
        let hostname = typeof options.hostname === 'string' ? options.hostname : undefined;
        let selectedProfile = null;

        if (typeof options.profile === 'string' && options.profile.trim().length > 0) {
          const store = ensureTunnelProfilesMigrated();
          const resolved = resolveProfileByName(store.profiles, options.profile, provider || options.provider);
          if (!resolved.profile) {
            throw new Error(resolved.error);
          }
          selectedProfile = resolved.profile;
          provider = provider || selectedProfile.provider;
          mode = mode || selectedProfile.mode;
          token = typeof options.token === 'string' && options.token.trim().length > 0 ? options.token : selectedProfile.token;
          hostname = typeof options.hostname === 'string' && options.hostname.trim().length > 0 ? options.hostname : selectedProfile.hostname;
        }

        if (!provider || !mode) {
          throw new Error('`tunnel start` requires --provider and --mode. Run `openchamber tunnel help` for examples.');
        }
        if (mode === 'managed-remote') {
          if (!(typeof token === 'string' && token.trim().length > 0)) {
            throw new Error('Managed-remote mode requires --token <token>.');
          }
          if (!(typeof hostname === 'string' && hostname.trim().length > 0)) {
            throw new Error('Managed-remote mode requires --hostname <hostname>.');
          }
        }

        const instance = await resolveTargetInstance({ options, allowAutoStart: true });

        if (selectedProfile && mode === 'managed-remote') {
          const tokenSyncPayload = {
            presetId: selectedProfile.id,
            presetName: selectedProfile.name,
            managedRemoteTunnelHostname: hostname,
            managedRemoteTunnelToken: token,
          };
          const { response: presetResponse, body: presetBody } = await requestJson(instance.port, '/api/openchamber/tunnel/managed-remote-token', {
            method: 'PUT',
            body: JSON.stringify(tokenSyncPayload),
          });
          if (!presetResponse.ok || !presetBody?.ok) {
            throw new Error(presetBody?.error || `Failed to sync tunnel profile token (${presetResponse.status})`);
          }
        }

        const payload = {
          provider,
          mode,
          ...(options.configPath === null ? { configPath: null } : {}),
          ...(typeof options.configPath === 'string' ? { configPath: options.configPath } : {}),
          ...(typeof token === 'string' ? { token } : {}),
          ...(typeof hostname === 'string' ? { hostname } : {}),
          ...(selectedProfile ? {
            managedRemoteTunnelPresetId: selectedProfile.id,
            managedRemoteTunnelPresetName: selectedProfile.name,
          } : {}),
        };

        const { response, body } = await requestJson(instance.port, '/api/openchamber/tunnel/start', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (!response.ok || !body?.ok) {
          throw new Error(body?.error || `Tunnel start failed (${response.status})`);
        }

        if (options.json) {
          console.log(JSON.stringify({ port: instance.port, ...body }, null, 2));
        } else {
          printSectionStart('Tunnel Started');
          printListItem({
            status: 'success',
            line: `port ${instance.port} ${body.provider}/${body.mode}`,
            detail: body.url || 'n/a',
          });
          if (body.connectUrl) {
            printListItem({ status: 'info', line: 'connect link', detail: body.connectUrl });
          }
          printSectionEnd('start complete');
        }

        if (options.qr) {
          const url = body.connectUrl || body.url;
          if (typeof url === 'string' && url.length > 0) {
            await displayTunnelQrCode(url);
          }
        }
        return;
      }
      case 'stop': {
        let entries;
        if (options.all) {
          entries = await resolveTargetInstance({ options, allowAutoStart: false, requireAll: true });
        } else {
          entries = [await resolveTargetInstance({ options, allowAutoStart: false })];
        }

        const results = [];
        for (const entry of entries) {
          try {
            const { response, body } = await requestJson(entry.port, '/api/openchamber/tunnel/stop', {
              method: 'POST',
            });
            if (!response.ok) {
              results.push({ port: entry.port, error: body?.error || `stop ${response.status}` });
              continue;
            }
            results.push({ port: entry.port, result: body });
          } catch (error) {
            results.push({ port: entry.port, error: error instanceof Error ? error.message : String(error) });
          }
        }

        if (options.json) {
          console.log(JSON.stringify({ instances: results }, null, 2));
          return;
        }
        printSectionStart('Tunnel Stop');
        for (const result of results) {
          if (result.error) {
            printListItem({ status: 'error', line: `port ${result.port} failed`, detail: result.error });
            continue;
          }
          printListItem({
            status: 'success',
            line: `port ${result.port} stopped`,
            detail: `revoked ${result.result?.revokedBootstrapCount || 0}, invalidated ${result.result?.invalidatedSessionCount || 0}`,
          });
        }
        printSectionEnd(`${results.length} instance(s)`);
        return;
      }
      default:
        throw new Error(`Unknown tunnel subcommand '${subcommand}'. Use 'openchamber tunnel help'.`);
    }
  },

  async logs(options) {
    let targets = [];
    const running = await discoverRunningInstances();

    if (options.all) {
      targets = running;
      if (targets.length === 0) {
        throw new Error('No running OpenChamber instance found.');
      }
    } else if (options.explicitPort) {
      const found = running.find((entry) => entry.port === options.port);
      if (!found) {
        throw new Error(`No running OpenChamber instance found on port ${options.port}.`);
      }
      targets = [found];
    } else {
      const latest = getLatestInstance(running);
      if (!latest) {
        throw new Error('No running OpenChamber instance found.');
      }
      targets = [latest];
    }

    printSectionStart('OpenChamber Logs');

    for (const target of targets) {
      const logPath = getLogFilePath(target.port);
      const lines = readTailLines(logPath, options.lines);
      printListItem({
        status: 'info',
        line: `port ${target.port}`,
        detail: logPath,
      });

      for (const line of lines) {
        if (options.all) {
          console.log(`[${target.port}] ${line}`);
        } else {
          console.log(line);
        }
      }
    }

    printSectionEnd(options.follow ? 'following (Ctrl+C to stop)' : 'tail complete');

    if (!options.follow) {
      return;
    }

    const unsubs = targets.map((target) => {
      const logPath = getLogFilePath(target.port);
      return followFile(logPath, (line) => {
        if (options.all) {
          console.log(`[${target.port}] ${line}`);
        } else {
          console.log(line);
        }
      });
    });

    await new Promise((resolve) => {
      const onSignal = () => {
        for (const unsub of unsubs) {
          unsub();
        }
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        resolve();
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    });
  },

  async update() {
    const packageManagerPath = path.join(__dirname, '..', 'server', 'lib', 'package-manager.js');
    const {
      checkForUpdates,
      executeUpdate,
      detectPackageManager,
      getCurrentVersion,
    } = await importFromFilePath(packageManagerPath);

    const runningInstances = await discoverRunningInstances();

    console.log('Checking for updates...');
    console.log(`Current version: ${getCurrentVersion()}`);

    const updateInfo = await checkForUpdates();
    if (updateInfo.error) {
      throw new Error(updateInfo.error);
    }
    if (!updateInfo.available) {
      console.log('You are running the latest version.');
      return;
    }

    if (runningInstances.length > 0) {
      for (const instance of runningInstances) {
        try {
          await requestServerShutdown(instance.port);
          process.kill(instance.pid, 'SIGTERM');
          let attempts = 0;
          while (isProcessRunning(instance.pid) && attempts < 20) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            attempts++;
          }
          if (isProcessRunning(instance.pid)) {
            process.kill(instance.pid, 'SIGKILL');
          }
          removePidFile(instance.pidFilePath);
        } catch {
        }
      }
    }

    const pm = detectPackageManager();
    const result = executeUpdate(pm);
    if (!result.success) {
      throw new Error(`Update failed with exit code ${result.exitCode}`);
    }

    if (runningInstances.length > 0) {
      for (const instance of runningInstances) {
        const storedOptions = readInstanceOptions(instance.instanceFilePath) || { port: instance.port };
        await this.serve({
          port: storedOptions.port || instance.port,
          explicitPort: true,
          uiPassword: storedOptions.uiPassword,
        });
      }
    }
  },
};

async function main() {
  const parsed = parseArgs();
  const { command, subcommand, tunnelAction, options, removedFlagErrors, helpRequested, versionRequested } = parsed;

  if (versionRequested) {
    console.log(PACKAGE_JSON.version);
    return;
  }

  if (removedFlagErrors.length > 0) {
    for (const error of removedFlagErrors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  if (helpRequested) {
    if (command === 'tunnel') {
      showTunnelHelp();
    } else {
      showHelp();
    }
    return;
  }

  if (command === 'tunnel') {
    await commands.tunnel(options, subcommand, tunnelAction);
    return;
  }

  if (!commands[command]) {
    console.error(`Error: Unknown command '${command}'`);
    console.error('Use --help to see available commands');
    process.exit(1);
  }

  await commands[command](options);
}

const isCliExecution = (() => {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) {
    return false;
  }
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isCliExecution) {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

export {
  commands,
  parseArgs,
  getPidFilePath,
  resolveTunnelProviders,
  fetchTunnelProvidersFromPort,
  discoverRunningInstances,
  ensureTunnelProfilesMigrated,
};
