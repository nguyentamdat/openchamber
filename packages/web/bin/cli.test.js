import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ensureTunnelProfilesMigrated, parseArgs, resolveTunnelProviders } from './cli.js';

describe('cli parseArgs tunnel namespace', () => {
  it('parses tunnel start canonical args', () => {
    const parsed = parseArgs([
      'tunnel',
      'start',
      '--provider', 'cloudflare',
      '--mode', 'managed-local',
      '--config', '~/.cloudflared/config.yml',
      '--port', '3200',
      '--qr',
    ]);

    expect(parsed.command).toBe('tunnel');
    expect(parsed.subcommand).toBe('start');
    expect(parsed.options.provider).toBe('cloudflare');
    expect(parsed.options.mode).toBe('managed-local');
    expect(parsed.options.configPath).toBe('~/.cloudflared/config.yml');
    expect(parsed.options.port).toBe(3200);
    expect(parsed.options.qr).toBe(true);
    expect(parsed.options.explicitPort).toBe(true);
    expect(parsed.removedFlagErrors.length).toBe(0);
  });

  it('defaults tunnel command without subcommand to help', () => {
    const parsed = parseArgs(['tunnel']);
    expect(parsed.command).toBe('tunnel');
    expect(parsed.subcommand).toBe('help');
  });

  it('parses tunnel profile nested subcommand and name', () => {
    const parsed = parseArgs(['tunnel', 'profile', 'show', '--name', 'prod-main', '--provider', 'cloudflare']);
    expect(parsed.command).toBe('tunnel');
    expect(parsed.subcommand).toBe('profile');
    expect(parsed.tunnelAction).toBe('show');
    expect(parsed.options.name).toBe('prod-main');
    expect(parsed.options.provider).toBe('cloudflare');
  });

  it('hard-fails removed legacy tunnel flags', () => {
    const parsed = parseArgs(['--try-cf-tunnel']);
    expect(parsed.removedFlagErrors.length).toBeGreaterThan(0);
    expect(parsed.removedFlagErrors[0]).toContain('--try-cf-tunnel');
  });

  it('hard-fails removed daemon flag', () => {
    const parsed = parseArgs(['--daemon']);
    expect(parsed.removedFlagErrors.length).toBeGreaterThan(0);
    expect(parsed.removedFlagErrors[0]).toContain('--daemon');
  });
});

describe('cli tunnel provider discovery', () => {
  it('uses provider capabilities from local api when available', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        providers: [{ provider: 'cloudflare', modes: [{ key: 'quick' }] }],
      }),
    });

    const result = await resolveTunnelProviders({ port: 4501 }, { readPorts: () => [], fetchImpl });

    expect(result.source).toBe('api:4501');
    expect(Array.isArray(result.providers)).toBe(true);
    expect(result.providers[0]?.provider).toBe('cloudflare');
  });

  it('falls back to built-in provider capabilities when api is unavailable', async () => {
    const fetchImpl = async () => {
      throw new Error('unreachable');
    };

    const result = await resolveTunnelProviders({ port: 4501 }, { readPorts: () => [], fetchImpl });

    expect(result.source).toBe('fallback');
    expect(Array.isArray(result.providers)).toBe(true);
    expect(result.providers[0]?.provider).toBe('cloudflare');
  });
});

describe('cli tunnel profile migration', () => {
  it('migrates legacy managed-remote config entries before profile use', () => {
    const tempDir = path.join(os.tmpdir(), `openchamber-cli-profile-test-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
    process.env.OPENCHAMBER_DATA_DIR = tempDir;

    try {
      fs.writeFileSync(
        path.join(tempDir, 'cloudflare-managed-remote-tunnels.json'),
        JSON.stringify({
          version: 1,
          tunnels: [
            {
              id: 'legacy-id',
              name: 'prod-main',
              hostname: 'app.example.com',
              token: 'secret-token',
              updatedAt: Date.now(),
            },
          ],
        }, null, 2),
        'utf8'
      );

      const migrated = ensureTunnelProfilesMigrated();
      expect(migrated.profiles.length).toBe(1);
      expect(migrated.profiles[0]?.provider).toBe('cloudflare');
      expect(migrated.profiles[0]?.mode).toBe('managed-remote');
      expect(migrated.profiles[0]?.name).toBe('prod-main');

      const persistedPath = path.join(tempDir, 'tunnel-profiles.json');
      expect(fs.existsSync(persistedPath)).toBe(true);
    } finally {
      if (typeof previousDataDir === 'string') {
        process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
      } else {
        delete process.env.OPENCHAMBER_DATA_DIR;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
