import type { PermissionsConfig } from './config';
import { matches } from './matcher';

export interface CompiledPattern {
	segments: string[];
	hasWildcard: boolean;
	// Outer-level memo: input string → result
	_memo: Map<string, boolean>;
}

/**
 * Compiles a wildcard pattern into a structured form for efficient matching.
 * @param pattern - The pattern string (may contain * wildcards)
 * @returns Compiled pattern with segments and memoization cache
 */
export function compilePattern(pattern: string): CompiledPattern {
	const segments = pattern.split('*');
	return {
		segments,
		hasWildcard: pattern.includes('*'),
		_memo: new Map(),
	};
}

/**
 * Matches a compiled pattern against an input string.
 * @param compiled - Compiled pattern with memo cache
 * @param input - Input string to match
 * @returns True if pattern matches input
 */
export function matchesCompiled(
	compiled: CompiledPattern,
	input: string,
): boolean {
	if (compiled.segments.length === 1 && !compiled.hasWildcard) {
		// No wildcards: exact match
		return compiled.segments[0] === input;
	}

	const outerMemo = compiled._memo;
	const outerMemoKey = input;
	if (outerMemo.has(outerMemoKey)) {
		return outerMemo.get(outerMemoKey) ?? false;
	}

	// Create a new inner memo for this specific input to avoid cache pollution
	const innerMemo = new Map<string, boolean>();
	const result = matchSegments(
		compiled.segments,
		input,
		0,
		0,
		compiled.hasWildcard,
		innerMemo,
	);
	outerMemo.set(outerMemoKey, result);
	return result;
}

function matchSegments(
	segments: string[],
	input: string,
	inputPos: number,
	segIdx: number,
	hasWildcard: boolean,
	memo: Map<string, boolean>,
): boolean {
	const memoKey = `${inputPos}|${segIdx}`;
	if (memo.has(memoKey)) {
		return memo.get(memoKey) ?? false;
	}

	while (segIdx < segments.length) {
		const segment = segments[segIdx];

		if (segment === '') {
			// Empty segment from a `*`
			if (segIdx === segments.length - 1) {
				// Last segment is empty → pattern ends with `*`
				memo.set(memoKey, true);
				return true;
			}
			// Skip to next segment, mark wildcard as seen
			const result = matchSegments(
				segments,
				input,
				inputPos,
				segIdx + 1,
				true,
				memo,
			);
			memo.set(memoKey, result);
			return result;
		}

		// Non-empty segment
		if (!hasWildcard) {
			// Before any `*`: must match at position 0
			if (!input.startsWith(segment, 0)) {
				memo.set(memoKey, false);
				return false;
			}
			const result = matchSegments(
				segments,
				input,
				segment.length,
				segIdx + 1,
				true,
				memo,
			);
			memo.set(memoKey, result);
			return result;
		}

		// After `*`: try matching at every position from inputPos onward
		for (let i = inputPos; i <= input.length; i++) {
			if (input.startsWith(segment, i)) {
				if (
					matchSegments(
						segments,
						input,
						i + segment.length,
						segIdx + 1,
						true,
						memo,
					)
				) {
					memo.set(memoKey, true);
					return true;
				}
			}
		}

		memo.set(memoKey, false);
		return false;
	}

	const result = inputPos === input.length;
	memo.set(memoKey, result);
	return result;
}

// Module-private cache: config identity → compiled patterns
// This allows lazy compilation on first use while avoiding re-compilation
const compiledCache = new WeakMap<
	PermissionsConfig,
	Map<string, { decision: 'allow' | 'deny'; compiled: CompiledPattern }>
>();

/**
 * Checks whether a tool call with given input is allowed, denied, or requires asking.
 * Pattern compilation is lazy: compiled patterns are cached on first use.
 * @param config - Permissions configuration
 * @param toolName - Name of the tool being called
 * @param input - Serialized input to the tool
 * @returns 'allow', 'deny', or 'ask'
 */
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

	// Check bash rules with pattern matching
	if (toolName === 'bash') {
		// Get or create compiled patterns for this config
		let compiled = compiledCache.get(config);
		if (!compiled) {
			compiled = new Map();
			for (const [pattern, decision] of Object.entries(config.bash)) {
				compiled.set(pattern, {
					decision,
					compiled: compilePattern(pattern),
				});
			}
			compiledCache.set(config, compiled);
		}

		// Check compiled patterns
		for (const item of compiled.values()) {
			if (matchesCompiled(item.compiled, input)) {
				return item.decision;
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
