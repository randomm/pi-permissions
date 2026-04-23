import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matches } from '../matcher';
import { checkPermission } from '../permissions';

let tempDir: string;

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

describe('checkPermission', () => {
	const config = {
		default: 'deny',
		bash: {
			'npm install *': 'allow',
			'git diff *': 'allow',
			'*': 'deny',
		},
		tools: { read: 'allow', write: 'deny', edit: 'deny' },
		_decisions: {},
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
		const configWithDecisions = {
			...config,
			_decisions: {
				'npm:*': { allowed: true, timestamp: '2026-04-23T10:00:00Z' },
			},
		};
		expect(checkPermission(configWithDecisions, 'npm', '*')).toBe('allow');
	});

	it('respects cached decisions (deny)', () => {
		const configWithDecisions = {
			...config,
			_decisions: {
				'rm:*': { allowed: false, timestamp: '2026-04-23T10:00:00Z' },
			},
		};
		expect(checkPermission(configWithDecisions, 'rm', '*')).toBe('deny');
	});

	it('uses matcher for bash pattern matching', () => {
		expect(checkPermission(config, 'bash', 'npm install lodash')).toBe('allow');
		expect(checkPermission(config, 'bash', 'git diff --staged')).toBe('allow');
		expect(checkPermission(config, 'bash', 'git push origin')).toBe('deny');
		expect(checkPermission(config, 'bash', 'rm -rf /')).toBe('deny');
	});

	it('falls back to default deny for unknown tool', () => {
		expect(checkPermission(config, 'unknown_tool', 'some input')).toBe('deny');
	});
});
