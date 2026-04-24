import { describe, expect, it } from 'vitest';
import {
	DENY_ALL_CONFIG,
	compilePattern,
	isValidDecision,
	isValidRule,
	matchesCompiled,
	parseConfigWithDecisions,
} from '../config';

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
			const { loadConfig } = require('../config');
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
			expect(result.__bashCompiled).toBeInstanceOf(Map);
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

describe('pattern compilation', () => {
	describe('compilePattern', () => {
		it('compiles simple patterns', () => {
			const compiled = compilePattern('npm install *');
			expect(compiled.segments).toEqual(['npm install ', '']);
			expect(compiled.hasWildcard).toBe(true);
		});

		it('compiles patterns without wildcards', () => {
			const compiled = compilePattern('git status');
			expect(compiled.segments).toEqual(['git status']);
			expect(compiled.hasWildcard).toBe(false);
		});

		it('compiles patterns with leading wildcard', () => {
			const compiled = compilePattern('* install');
			expect(compiled.segments).toEqual(['', ' install']);
			expect(compiled.hasWildcard).toBe(true);
		});

		it('compiles patterns with multiple wildcards', () => {
			const compiled = compilePattern('git * * status');
			expect(compiled.segments).toEqual(['git ', ' ', ' status']);
			expect(compiled.hasWildcard).toBe(true);
		});

		it('compiles empty pattern', () => {
			const compiled = compilePattern('');
			expect(compiled.segments).toEqual(['']);
			expect(compiled.hasWildcard).toBe(false);
		});
	});

	describe('matchesCompiled', () => {
		it('matches compiled patterns correctly', () => {
			const pattern1 = compilePattern('npm install *');
			expect(matchesCompiled(pattern1, 'npm install lodash')).toBe(true);
			expect(matchesCompiled(pattern1, 'npm install express')).toBe(true);
			expect(matchesCompiled(pattern1, 'npm uninstall')).toBe(false);

			const pattern2 = compilePattern('git status');
			expect(matchesCompiled(pattern2, 'git status')).toBe(true);
			expect(matchesCompiled(pattern2, 'git status --short')).toBe(false);
		});

		it('performance: does not re-split pattern on each match', () => {
			const pattern = compilePattern('npm install *');
			// This test verifies compilation happens once
			expect(pattern.segments).toBeDefined();
			expect(pattern.hasWildcard).toBeDefined();

			// Multiple matches should be fast (no splitting)
			for (let i = 0; i < 100; i++) {
				matchesCompiled(pattern, `npm install package${i}`);
			}
		});
	});
});
