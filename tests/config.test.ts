import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPermissionAllowed, loadConfig, parseConfig } from '../config';

let tempDir: string;

function readPermissionsFile(dir: string): string | null {
	const fs = require('node:fs/promises');
	const path = join(dir, '.pi', 'permissions.json');
	return fs.readFile(path, 'utf-8').catch(() => null);
}

beforeEach(async () => {
	const base = await mkdtemp(join(tmpdir(), 'pi-perms-'));
	tempDir = base;
	await mkdir(join(base, '.pi'), { recursive: true });
});

afterEach(async () => {
	try {
		await unlink(tempDir);
	} catch {
		// ignore cleanup errors
	}
});

describe('parseConfig', () => {
	it('parses valid config with decisions', () => {
		const json = JSON.stringify({
			_decisions: {
				'npm install *': { allowed: true, timestamp: '2026-04-23T10:00:00Z' },
			},
			default: 'deny',
			bash: { '*': 'deny', 'npm install *': 'allow' },
			tools: { read: 'allow', write: 'deny' },
		});
		const result = parseConfig(json);
		expect(result).toEqual({
			default: 'deny',
			bash: { '*': 'deny', 'npm install *': 'allow' },
			tools: { read: 'allow', write: 'deny' },
		});
	});

	it('parses valid config without decisions', () => {
		const json = JSON.stringify({
			default: 'deny',
			bash: { '*': 'deny' },
			tools: {},
		});
		const result = parseConfig(json);
		expect(result).toEqual({
			default: 'deny',
			bash: { '*': 'deny' },
			tools: {},
		});
	});

	it('returns null for invalid JSON', () => {
		expect(parseConfig('not valid json')).toBeNull();
	});

	it('returns null for non-object JSON', () => {
		expect(parseConfig('"string"')).toBeNull();
		expect(parseConfig('[]')).toBeNull();
		expect(parseConfig('42')).toBeNull();
	});

	it('returns null for config missing default', () => {
		const json = JSON.stringify({
			bash: {},
			tools: {},
		});
		expect(parseConfig(json)).toBeNull();
	});

	it('returns null for config with invalid default value', () => {
		const json = JSON.stringify({
			default: 'maybe',
			bash: {},
			tools: {},
		});
		expect(parseConfig(json)).toBeNull();
	});
});

describe('loadConfig', () => {
	it('loads and parses a valid config file', async () => {
		const config = {
			default: 'deny',
			bash: { '*': 'deny', 'npm install *': 'allow' },
			tools: { read: 'allow', write: 'deny' },
		};
		await writeFile(
			join(tempDir, '.pi', 'permissions.json'),
			JSON.stringify(config, null, 2),
		);

		const result = loadConfig(tempDir);
		expect(result).toEqual(config);
	});

	it('returns null when config file does not exist', async () => {
		const result = loadConfig(tempDir);
		expect(result).toBeNull();
	});

	it('returns null when config file is corrupted', async () => {
		await writeFile(
			join(tempDir, '.pi', 'permissions.json'),
			'not valid json{{{}}}',
		);
		const result = loadConfig(tempDir);
		expect(result).toBeNull();
	});
});

describe('isPermissionAllowed', () => {
	const config = {
		default: 'deny',
		bash: {
			'npm install *': 'allow',
			'git diff *': 'allow',
			'*': 'deny',
		},
		tools: { read: 'allow', write: 'deny', edit: 'deny' },
	};

	it('allows when bash rule matches', () => {
		expect(isPermissionAllowed(config, 'bash', 'npm install lodash')).toBe(
			'allow',
		);
		expect(isPermissionAllowed(config, 'bash', 'git diff --staged')).toBe(
			'allow',
		);
	});

	it('denies when bash rule matches deny', () => {
		expect(isPermissionAllowed(config, 'bash', 'git push origin')).toBe('deny');
		expect(isPermissionAllowed(config, 'bash', 'rm -rf /')).toBe('deny');
	});

	it('allows tool with exact match in tools', () => {
		expect(isPermissionAllowed(config, 'read', 'package.json')).toBe('allow');
	});

	it('denies tool with exact match in tools', () => {
		expect(isPermissionAllowed(config, 'write', 'package.json')).toBe('deny');
		expect(isPermissionAllowed(config, 'edit', 'package.json')).toBe('deny');
	});

	it('uses default when no rule matches', () => {
		expect(isPermissionAllowed(config, 'delete', 'package.json')).toBe('deny');
	});

	it('respects decisions from config (not implemented in this version)', () => {
		// Decisions are handled in checkPermission in permissions.ts
		// This function only checks config rules
		expect(isPermissionAllowed(config, 'bash', 'npm install lodash')).toBe(
			'allow',
		);
	});
});
