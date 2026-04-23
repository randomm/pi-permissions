import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matches } from './matcher';

export interface PermissionsConfig {
	default: 'allow' | 'deny';
	bash: Record<string, 'allow' | 'deny'>;
	tools: Record<string, 'allow' | 'deny'>;
}

const CONFIG_FILENAME = '.pi/permissions.json';

export function loadConfig(cwd: string): PermissionsConfig | null {
	const configPath = join(cwd, CONFIG_FILENAME);
	try {
		const raw = readFileSync(configPath, 'utf-8');
		return parseConfig(raw);
	} catch {
		return null;
	}
}

export function parseConfig(json: string): PermissionsConfig | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const obj = parsed as Record<string, unknown>;
	const defaultValue = obj.default;
	if (defaultValue !== 'allow' && defaultValue !== 'deny') {
		return null;
	}

	const bash = obj.bash;
	const tools = obj.tools;

	if (typeof bash !== 'object' || bash === null || Array.isArray(bash)) {
		return null;
	}
	if (typeof tools !== 'object' || tools === null || Array.isArray(tools)) {
		return null;
	}

	return {
		default: defaultValue as 'allow' | 'deny',
		bash: bash as Record<string, 'allow' | 'deny'>,
		tools: tools as Record<string, 'allow' | 'deny'>,
	};
}

export function isPermissionAllowed(
	config: PermissionsConfig,
	toolName: string,
	input: string,
): 'allow' | 'deny' | 'ask' {
	// Check bash rules with pattern matching
	if (toolName === 'bash') {
		for (const [pattern, decision] of Object.entries(config.bash)) {
			if (matches(pattern, input)) {
				return decision;
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
