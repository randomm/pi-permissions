import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DENY_ALL_CONFIG,
	isValidDecision,
	isValidRule,
	loadConfig,
	parseConfigWithDecisions,
} from '../config';
import { ensureSecureDirectory } from '../security';

let tempDir: string;

beforeEach(async () => {
	const base = await mkdtemp(join(tmpdir(), 'pi-security-'));
	tempDir = base;
});

afterEach(async () => {
	try {
		await rm(tempDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
});

describe('ensureSecureDirectory', () => {
	it('creates .pi directory with secure permissions', async () => {
		const freshDir = join(tmpdir(), 'fresh-test');
		await mkdir(freshDir, { recursive: true });

		ensureSecureDirectory(freshDir);

		// Verify directory exists
		const stats = statSync(join(freshDir, '.pi'));
		expect(stats.isDirectory()).toBe(true);

		await rm(freshDir, { recursive: true, force: true });
	});

	it('F3: chmod failure succeeds if directory already has secure permissions', () => {
		// Pre-create .pi with mode 0o700
		const piDir = join(tempDir, '.pi');
		mkdirSync(piDir, { mode: 0o700 });

		// Verify it already has secure permissions
		const stats = statSync(piDir);
		const currentMode = stats.mode & 0o777;
		expect(currentMode).toBeLessThanOrEqual(0o700);

		// Should NOT throw
		expect(() => ensureSecureDirectory(tempDir)).not.toThrow();
	});

	it('F3: chmod works correctly and secure directory is actually secure', async () => {
		// Create directory and ensure secure permissions
		ensureSecureDirectory(tempDir);

		const piDir = join(tempDir, '.pi');
		const stats = statSync(piDir);
		const currentMode = stats.mode & 0o777;

		// Should be 0o700 (or less)
		expect(currentMode).toBeLessThanOrEqual(0o700);
	});
});

describe('config security', () => {
	describe('parseConfigWithDecisions - fail-closed behavior', () => {
		it('returns DENY_ALL_CONFIG for malformed JSON', () => {
			expect(parseConfigWithDecisions('not valid json')).toEqual(
				DENY_ALL_CONFIG,
			);
		});

		it('returns DENY_ALL_CONFIG for non-object JSON', () => {
			expect(parseConfigWithDecisions('"string"')).toEqual(DENY_ALL_CONFIG);
			expect(parseConfigWithDecisions('[]')).toEqual(DENY_ALL_CONFIG);
			expect(parseConfigWithDecisions('42')).toEqual(DENY_ALL_CONFIG);
		});

		it('returns DENY_ALL_CONFIG for missing file (via loadConfig)', () => {
			const result = loadConfig('/nonexistent/path');
			expect(result).toEqual(DENY_ALL_CONFIG);
		});

		it('returns DENY_ALL_CONFIG for empty file', () => {
			expect(parseConfigWithDecisions('')).toEqual(DENY_ALL_CONFIG);
		});

		it('returns DENY_ALL_CONFIG for config missing default', () => {
			const json = JSON.stringify({ bash: {}, tools: {} });
			expect(parseConfigWithDecisions(json)).toEqual(DENY_ALL_CONFIG);
		});

		it('returns DENY_ALL_CONFIG for invalid default value', () => {
			const json = JSON.stringify({
				default: 'maybe',
				bash: {},
				tools: {},
			});
			expect(parseConfigWithDecisions(json)).toEqual(DENY_ALL_CONFIG);
		});

		it('returns DENY_ALL_CONFIG for invalid bash value', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: 'not an object',
				tools: {},
			});
			expect(parseConfigWithDecisions(json)).toEqual(DENY_ALL_CONFIG);
		});

		it('returns DENY_ALL_CONFIG for invalid tools value', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: ['not', 'an', 'object'],
			});
			expect(parseConfigWithDecisions(json)).toEqual(DENY_ALL_CONFIG);
		});
	});

	describe('prototype pollution prevention', () => {
		it('rejects __proto__ key', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: {},
				__proto__: { pollute: 'attempted' },
			});
			const result = parseConfigWithDecisions(json);
			// Check that it returns DENY_ALL_CONFIG without allowing prototype pollution
			expect(result.default).toBe('deny');
			expect(result.bash).toEqual({});
			expect(result.tools).toEqual({});
			expect(result._decisions).toBeUndefined();
		});

		it('rejects constructor key', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: {},
				constructor: { pollute: 'attempted' },
			});
			const result = parseConfigWithDecisions(json);
			expect(result.default).toBe('deny');
			expect(result.bash).toEqual({});
			expect(result.tools).toEqual({});
		});

		it('rejects prototype key', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: {},
				prototype: { pollute: 'attempted' },
			});
			const result = parseConfigWithDecisions(json);
			expect(result.default).toBe('deny');
			expect(result.bash).toEqual({});
			expect(result.tools).toEqual({});
		});

		it('rejects constructor.prototype nested pollution in _decisions', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: {},
				_decisions: {
					constructor: { prototype: { isAdmin: true } },
				},
			});
			const result = parseConfigWithDecisions(json);
			expect(result.default).toBe('deny');
			expect(result.bash).toEqual({});
			expect(result.tools).toEqual({});
		});
	});

	describe('runtime validation guards', () => {
		it('isValidRule accepts allow/deny strings', () => {
			expect(isValidRule('allow')).toBe(true);
			expect(isValidRule('deny')).toBe(true);
		});

		it('isValidRule rejects invalid strings', () => {
			expect(isValidRule('maybe')).toBe(false);
			expect(isValidRule('')).toBe(false);
			expect(isValidRule('ALLOW')).toBe(false); // case-sensitive
			expect(isValidRule('DENY')).toBe(false); // case-sensitive
		});

		it('isValidRule rejects non-strings', () => {
			expect(isValidRule(null)).toBe(false);
			expect(isValidRule(undefined)).toBe(false);
			expect(isValidRule(42)).toBe(false);
			expect(isValidRule({})).toBe(false);
			expect(isValidRule([])).toBe(false);
		});

		it('isValidDecision accepts valid decision objects', () => {
			expect(
				isValidDecision({ allowed: true, timestamp: '2026-04-24T00:00:00Z' }),
			).toBe(true);
			expect(
				isValidDecision({ allowed: false, timestamp: '2026-04-24T00:00:00Z' }),
			).toBe(true);
		});

		it('isValidDecision rejects invalid decision objects', () => {
			expect(isValidDecision({ allowed: 'yes' })).toBe(false);
			expect(isValidDecision({ timestamp: '2026-04-24T00:00:00Z' })).toBe(
				false,
			);
			expect(isValidDecision({ allowed: true })).toBe(false);
			expect(isValidDecision(null)).toBe(false);
			expect(isValidDecision('not an object')).toBe(false);
		});

		it('validates bash rules during config parsing', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: { 'git *': 'allow', 'rm *': 'maybe', 'npm *': 'deny' },
				tools: {},
			});
			const result = parseConfigWithDecisions(json);
			// Should drop invalid 'maybe' rule but keep valid ones
			expect(result.bash).toEqual({
				'git *': 'allow',
				'npm *': 'deny',
			});
			expect(result.bash['rm *']).toBeUndefined();
		});

		it('validates tools rules during config parsing', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: { read: 'allow', write: 'maybe', edit: 'deny' },
			});
			const result = parseConfigWithDecisions(json);
			// Should drop invalid 'maybe' rule but keep valid ones
			expect(result.tools).toEqual({
				read: 'allow',
				edit: 'deny',
			});
			expect(result.tools.write).toBeUndefined();
		});
	});

	describe('decision validation', () => {
		it('rejects invalid _decisions entries', () => {
			const json = JSON.stringify({
				default: 'deny',
				bash: {},
				tools: {},
				_decisions: {
					'bash:valid': { allowed: true, timestamp: '2026-04-24T00:00:00Z' },
					'bash:invalid': { allowed: 'maybe' },
					'bash:missing': undefined,
				},
			});
			const result = parseConfigWithDecisions(json);
			// Should only keep valid decision
			expect(Object.keys(result._decisions || {})).toEqual(['bash:valid']);
		});
	});
});

// All imports are at the top now - no need for helper functions
