import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const CONFIG_FILENAME = '.pi/permissions.json';
const DECISIONS_KEY = '_decisions';

function getConfigPath(cwd: string): string {
	return join(cwd, CONFIG_FILENAME);
}

function loadFullConfig(cwd: string): Record<string, unknown> | null {
	const configPath = getConfigPath(cwd);
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const raw = readFileSync(configPath, 'utf-8');
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function loadDecisions(
	cwd: string,
): Record<string, { allowed: boolean; timestamp: string }> | null {
	const config = loadFullConfig(cwd);
	if (!config) {
		return null;
	}
	return (
		(config[DECISIONS_KEY] as Record<
			string,
			{ allowed: boolean; timestamp: string }
		>) || null
	);
}

export async function saveDecision(
	cwd: string,
	toolName: string,
	input: string,
	allowed: boolean,
): Promise<void> {
	const configPath = getConfigPath(cwd);
	const tmpPath = `${configPath}.tmp`;

	// Load existing full config to preserve bash/tools sections
	const existing = loadFullConfig(cwd) || {};
	const key = `${toolName}:${input}`;

	// Build new config preserving existing sections
	const newConfig: Record<string, unknown> = {
		...existing,
		[DECISIONS_KEY]: {
			...(existing[DECISIONS_KEY] as Record<string, unknown>),
			[key]: {
				allowed,
				timestamp: new Date().toISOString(),
			},
		},
	};

	// Create .pi directory if it doesn't exist
	const piDir = join(cwd, '.pi');
	if (!existsSync(piDir)) {
		mkdirSync(piDir, { recursive: true });
	}

	// Atomic write: write to tmp, then rename
	writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2));
	try {
		renameSync(tmpPath, configPath);
	} catch (err: unknown) {
		const code = (err as { code?: string })?.code;
		if (code === 'EXDEV') {
			// Cross-device: fall back to read-write-delete
			unlinkSync(configPath);
			renameSync(tmpPath, configPath);
		} else {
			// Re-throw if not EXDEV
			throw err;
		}
	}
}

export function handleCorruption(cwd: string, originalPath: string): void {
	const corruptedPath = `${originalPath}.corrupted`;

	// Create .pi directory if it doesn't exist
	const piDir = join(cwd, '.pi');
	if (!existsSync(piDir)) {
		mkdirSync(piDir, { recursive: true });
	}

	// Move corrupted file to backup
	try {
		renameSync(originalPath, corruptedPath);
	} catch {
		// If rename fails (e.g., file already moved), just delete the original
		try {
			unlinkSync(originalPath);
		} catch {
			// File already gone, nothing to do
		}
	}
}
