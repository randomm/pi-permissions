import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DENY_ALL_CONFIG,
	checkPermission,
	loadConfig,
	parseConfigWithDecisions,
} from '../config';

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
		const result = parseConfigWithDecisions(json);
		// __bashCompiled is an internal field - test the public interface
		expect(result.default).toBe('deny');
		expect(result.bash).toEqual({ '*': 'deny', 'npm install *': 'allow' });
		expect(result.tools).toEqual({ read: 'allow', write: 'deny' });
		expect(result._decisions).toEqual({
			'npm install *': { allowed: true, timestamp: '2026-04-23T10:00:00Z' },
		});
		// Verify pre-compiled patterns exist
		expect(result.__bashCompiled).toBeInstanceOf(Map);
		expect(result.__bashCompiled?.size).toBe(2);
	});

	it('parses valid config without decisions', () => {
		const json = JSON.stringify({
			default: 'deny',
			bash: { '*': 'deny' },
			tools: {},
		});
		const result = parseConfigWithDecisions(json);
		// __bashCompiled is an internal field - test the public interface
		expect(result.default).toBe('deny');
		expect(result.bash).toEqual({ '*': 'deny' });
		expect(result.tools).toEqual({});
		expect(result._decisions).toBeUndefined();
	});

	it('returns DENY_ALL_CONFIG for invalid JSON', () => {
		expect(parseConfigWithDecisions('not valid json')).toEqual(DENY_ALL_CONFIG);
	});

	it('returns DENY_ALL_CONFIG for non-object JSON', () => {
		expect(parseConfigWithDecisions('"string"')).toEqual(DENY_ALL_CONFIG);
		expect(parseConfigWithDecisions('[]')).toEqual(DENY_ALL_CONFIG);
		expect(parseConfigWithDecisions('42')).toEqual(DENY_ALL_CONFIG);
	});

	it('returns DENY_ALL_CONFIG for config missing default', () => {
		const json = JSON.stringify({
			bash: {},
			tools: {},
		});
		expect(parseConfigWithDecisions(json)).toEqual(DENY_ALL_CONFIG);
	});

	it('returns DENY_ALL_CONFIG for config with invalid default value', () => {
		const json = JSON.stringify({
			default: 'maybe',
			bash: {},
			tools: {},
		});
		expect(parseConfigWithDecisions(json)).toEqual(DENY_ALL_CONFIG);
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
		// __bashCompiled is added during parsing
		expect(result.default).toEqual(config.default);
		expect(result.bash).toEqual(config.bash);
		expect(result.tools).toEqual(config.tools);
		expect(result.__bashCompiled).toBeInstanceOf(Map);
	});

	it('returns DENY_ALL_CONFIG when config file does not exist', async () => {
		const result = loadConfig(tempDir);
		expect(result).toEqual(DENY_ALL_CONFIG);
	});

	it('returns DENY_ALL_CONFIG when config file is corrupted', async () => {
		await writeFile(
			join(tempDir, '.pi', 'permissions.json'),
			'not valid json{{{}}}',
		);
		const result = loadConfig(tempDir);
		expect(result).toEqual(DENY_ALL_CONFIG);
	});
});

describe('checkPermission', () => {
	const config: import('../config').PermissionsConfig = {
		default: 'deny',
		bash: {
			'npm install *': 'allow',
			'git diff *': 'allow',
			'*': 'deny',
		},
		tools: { read: 'allow', write: 'deny', edit: 'deny' },
	};

	it('allows when bash rule matches', () => {
		expect(checkPermission(config, 'bash', 'npm install lodash')).toBe('allow');
		expect(checkPermission(config, 'bash', 'git diff --staged')).toBe('allow');
	});

	it('denies when bash rule matches deny', () => {
		expect(checkPermission(config, 'bash', 'git push origin')).toBe('deny');
		expect(checkPermission(config, 'bash', 'rm -rf /')).toBe('deny');
	});

	it('allows tool with exact match in tools', () => {
		expect(checkPermission(config, 'read', 'package.json')).toBe('allow');
	});

	it('denies tool with exact match in tools', () => {
		expect(checkPermission(config, 'write', 'package.json')).toBe('deny');
		expect(checkPermission(config, 'edit', 'package.json')).toBe('deny');
	});

	it('uses default when no rule matches', () => {
		expect(checkPermission(config, 'delete', 'package.json')).toBe('deny');
	});

	it('respects cached decisions (allow)', () => {
		const configWithDecisions: import('../config').PermissionsConfig = {
			...config,
			_decisions: {
				'npm:*': { allowed: true, timestamp: '2026-04-23T10:00:00Z' },
			},
		};
		expect(checkPermission(configWithDecisions, 'npm', '*')).toBe('allow');
	});

	it('respects cached decisions (deny)', () => {
		const configWithDecisions: import('../config').PermissionsConfig = {
			...config,
			_decisions: {
				'rm:*': { allowed: false, timestamp: '2026-04-23T10:00:00Z' },
			},
		};
		expect(checkPermission(configWithDecisions, 'rm', '*')).toBe('deny');
	});
});
