import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PermissionsConfig {
	default: 'allow' | 'deny';
	bash: Record<string, 'allow' | 'deny'>;
	tools: Record<string, 'allow' | 'deny'>;
	_decisions?: Record<string, Decision>;
}

export interface Decision {
	allowed: boolean;
	timestamp: string;
}

export const DENY_ALL_CONFIG: PermissionsConfig = {
	default: 'deny',
	bash: {},
	tools: {},
};

const CONFIG_FILENAME = '.pi/permissions.json';
const ALLOWED_CONFIG_KEYS = new Set(['default', 'bash', 'tools', '_decisions']);

/**
 * Validates if a value is a valid Decision object.
 */
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

/**
 * Validates if a value is a valid rule ('allow' or 'deny').
 */
export function isValidRule(value: unknown): value is 'allow' | 'deny' {
	return value === 'allow' || value === 'deny';
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

/**
 * Parses a JSON config string with optional decisions into a PermissionsConfig.
 * Returns DENY_ALL_CONFIG if JSON is invalid or structure is malformed.
 * @param json - JSON string to parse
 * @returns Validated PermissionsConfig or DENY_ALL_CONFIG
 */
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
			const decisionKeys = Object.getOwnPropertyNames(rawDecisions);
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

	return {
		default: defaultValue,
		bash: filteredBash,
		tools: filteredTools,
		_decisions: decisions,
	};
}

/**
 * Loads permissions config from .pi/permissions.json in the given directory.
 * Returns DENY_ALL_CONFIG if file doesn't exist or is invalid.
 * @param cwd - Current working directory
 * @returns PermissionsConfig
 */
export function loadConfig(cwd: string): PermissionsConfig {
	const configPath = join(cwd, CONFIG_FILENAME);
	try {
		const raw = readFileSync(configPath, 'utf-8');
		return parseConfigWithDecisions(raw);
	} catch {
		return DENY_ALL_CONFIG;
	}
}
