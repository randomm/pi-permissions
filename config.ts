import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matches } from './matcher';

export interface PermissionsConfig {
	default: 'allow' | 'deny';
	bash: Record<string, 'allow' | 'deny'>;
	tools: Record<string, 'allow' | 'deny'>;
	_decisions?: Record<string, Decision>;
	// Internal: pre-compiled bash patterns for performance
	__bashCompiled?: Map<
		string,
		{ decision: 'allow' | 'deny'; compiled: CompiledPattern }
	>;
}

export interface Decision {
	allowed: boolean;
	timestamp: string;
}

export interface CompiledPattern {
	segments: string[];
	hasWildcard: boolean;
}

export const DENY_ALL_CONFIG: PermissionsConfig = {
	default: 'deny',
	bash: {},
	tools: {},
	__bashCompiled: new Map(),
};

const CONFIG_FILENAME = '.pi/permissions.json';
const ALLOWED_CONFIG_KEYS = new Set(['default', 'bash', 'tools', '_decisions']);

export function isValidDecision(value: unknown): value is Decision {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const decision = value as Record<string, unknown>;
	return (
		typeof decision.allowed === 'boolean' &&
		typeof decision.timestamp === 'string'
	);
}

export function isValidRule(value: unknown): value is 'allow' | 'deny' {
	return value === 'allow' || value === 'deny';
}

export function compilePattern(pattern: string): CompiledPattern {
	const segments = pattern.split('*');
	return {
		segments,
		hasWildcard: pattern.includes('*'),
	};
}

export function matchesCompiled(
	compiled: CompiledPattern,
	input: string,
): boolean {
	// Use the existing matches function which is well-tested
	// This is a temporary wrapper - the real optimization is avoiding split('*') at callsite
	const pattern = compiled.segments.join('*');
	return matches(pattern, input);
}

function validateAndFilterRules(
	rules: Record<string, unknown>,
): Record<string, 'allow' | 'deny'> {
	const filtered: Record<string, 'allow' | 'deny'> = {};
	for (const [pattern, value] of Object.entries(rules)) {
		if (isValidRule(value)) {
			filtered[pattern] = value;
		}
	}
	return filtered;
}

function validateAndFilterDecisions(
	decisions: Record<string, unknown>,
): Record<string, Decision> {
	const filtered: Record<string, Decision> = {};
	for (const [key, value] of Object.entries(decisions)) {
		if (isValidDecision(value)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

export function parseConfigWithDecisions(json: string): PermissionsConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return DENY_ALL_CONFIG;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return DENY_ALL_CONFIG;
	}

	const obj = parsed as Record<string, unknown>;

	// Validate allowed keys (prototype pollution prevention)
	// Use Object.keys to get actual property names, not prototype chain
	const actualKeys = Object.keys(obj);
	for (const key of actualKeys) {
		// Check for prototype pollution attempts
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			return DENY_ALL_CONFIG;
		}
		if (!ALLOWED_CONFIG_KEYS.has(key)) {
			return DENY_ALL_CONFIG; // Reject unknown keys
		}
	}

	// Validate default value
	const defaultValue = obj.default;
	if (!isValidRule(defaultValue)) {
		return DENY_ALL_CONFIG;
	}

	// Validate bash rules
	const bash = obj.bash;
	if (typeof bash !== 'object' || bash === null || Array.isArray(bash)) {
		return DENY_ALL_CONFIG;
	}

	// Validate tools rules
	const tools = obj.tools;
	if (typeof tools !== 'object' || tools === null || Array.isArray(tools)) {
		return DENY_ALL_CONFIG;
	}

	// Validate and filter decisions if present
	let decisions: Record<string, Decision> | undefined = undefined;
	if ('_decisions' in obj && obj._decisions !== undefined) {
		const rawDecisions = obj._decisions;

		// Check for nested prototype pollution in _decisions
		if (typeof rawDecisions === 'object' && rawDecisions !== null) {
			// Use Object.getOwnPropertyNames to get all properties including constructor
			const decisionKeys = Object.getOwnPropertyNames(rawDecisions as object);
			for (const key of decisionKeys) {
				if (
					key === '__proto__' ||
					key === 'constructor' ||
					key === 'prototype'
				) {
					return DENY_ALL_CONFIG; // Reject prototype pollution in decisions
				}
			}

			if (!Array.isArray(rawDecisions)) {
				const filtered = validateAndFilterDecisions(
					rawDecisions as Record<string, unknown>,
				);
				// Only set decisions if we have some valid entries
				if (Object.keys(filtered).length > 0) {
					decisions = filtered;
				}
			}
		}
	}

	const filteredBash = validateAndFilterRules(bash as Record<string, unknown>);
	const filteredTools = validateAndFilterRules(
		tools as Record<string, unknown>,
	);

	// Pre-compile bash patterns for performance (C5)
	const bashCompiled = new Map<
		string,
		{ decision: 'allow' | 'deny'; compiled: CompiledPattern }
	>();
	for (const [pattern, decision] of Object.entries(filteredBash)) {
		bashCompiled.set(pattern, { decision, compiled: compilePattern(pattern) });
	}

	return {
		default: defaultValue,
		bash: filteredBash,
		tools: filteredTools,
		_decisions: decisions,
		__bashCompiled: bashCompiled,
	};
}

export function loadConfig(cwd: string): PermissionsConfig {
	const configPath = join(cwd, CONFIG_FILENAME);
	try {
		const raw = readFileSync(configPath, 'utf-8');
		return parseConfigWithDecisions(raw);
	} catch {
		return DENY_ALL_CONFIG;
	}
}

export function ensureSecureDirectory(cwd: string): void {
	const piDir = join(cwd, '.pi');
	if (mkdirSync(piDir, { recursive: true, mode: 0o700 })) {
		// chmod in case umask changed it
		chmodSync(piDir, 0o700);
	}
}

export function checkPermission(
	config: PermissionsConfig,
	toolName: string,
	input: string,
): 'allow' | 'deny' | 'ask' {
	const key = `${toolName}:${input}`;

	// Check cached decisions first
	if (config._decisions?.[key]) {
		return config._decisions[key].allowed ? 'allow' : 'deny';
	}

	// Check bash rules with pattern matching (uses pre-compiled patterns for performance)
	if (toolName === 'bash') {
		// Use pre-compiled patterns if available (from parseConfigWithDecisions)
		if (config.__bashCompiled) {
			for (const item of config.__bashCompiled.values()) {
				if (matchesCompiled(item.compiled, input)) {
					return item.decision;
				}
			}
		} else {
			// Fallback for configs created manually without compilation
			for (const [pattern, decision] of Object.entries(config.bash)) {
				if (matches(pattern, input)) {
					return decision;
				}
			}
		}
	}

	// Check tool-specific rules (exact match)
	if (config.tools[toolName]) {
		return config.tools[toolName];
	}

	// Fall back to default
	return config.default;
}
