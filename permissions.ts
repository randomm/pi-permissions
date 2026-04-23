import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matches } from './matcher';

const CONFIG_FILENAME = '.pi/permissions.json';

export interface PermissionsConfig {
	default: 'allow' | 'deny';
	bash: Record<string, 'allow' | 'deny'>;
	tools: Record<string, 'allow' | 'deny'>;
	_decisions?: Record<string, { allowed: boolean; timestamp: string }>;
}

export function loadConfig(cwd: string): PermissionsConfig | null {
	const configPath = join(cwd, CONFIG_FILENAME);
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const raw = readFileSync(configPath, 'utf-8');
		const parsed = JSON.parse(raw);
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
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
			_decisions:
				(obj._decisions as Record<
					string,
					{ allowed: boolean; timestamp: string }
				>) || undefined,
		};
	} catch {
		return null;
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
