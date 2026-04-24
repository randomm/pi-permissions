import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Decision } from './config';
import { ensureSecureDirectory } from './config';

const DECISIONS_FILENAME = '.pi/decisions.json';

function getDecisionsPath(cwd: string): string {
	return join(cwd, DECISIONS_FILENAME);
}

function loadDecisionsFile(cwd: string): Record<string, Decision> | null {
	const decisionsPath = getDecisionsPath(cwd);
	try {
		const raw = readFileSync(decisionsPath, 'utf-8');
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) {
			return null;
		}
		// Validate structure before returning
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof key !== 'string') {
				return null;
			}
			const decision = value as Record<string, unknown>;
			if (
				typeof decision.allowed !== 'boolean' ||
				typeof decision.timestamp !== 'string'
			) {
				return null;
			}
		}
		return parsed as Record<string, Decision>;
	} catch {
		return null;
	}
}

export async function saveDecision(
	cwd: string,
	toolName: string,
	input: string,
	allowed: boolean,
): Promise<void> {
	ensureSecureDirectory(cwd);

	const decisionsPath = getDecisionsPath(cwd);
	const tmpPath = `${decisionsPath}.tmp`;

	// Load existing decisions
	const existing = loadDecisionsFile(cwd) || {};
	const key = `${toolName}:${input}`;

	// Build new decisions object
	const newDecisions: Record<string, Decision> = {
		...existing,
		[key]: {
			allowed,
			timestamp: new Date().toISOString(),
		},
	};

	// Atomic write: write to tmp, then rename with secure mode
	writeFileSync(tmpPath, JSON.stringify(newDecisions), { mode: 0o600 });
	chmodSync(tmpPath, 0o600);

	try {
		renameSync(tmpPath, decisionsPath);
		chmodSync(decisionsPath, 0o600);
	} catch (err: unknown) {
		const code = (err as { code?: string })?.code;
		if (code === 'EXDEV') {
			// Cross-device: fall back to read-write-delete
			// chmod the target first to ensure we can delete it
			try {
				chmodSync(decisionsPath, 0o600);
			} catch {
				// Ignore if file doesn't exist
			}
			writeFileSync(decisionsPath, JSON.stringify(newDecisions), {
				mode: 0o600,
			});
		} else {
			// Re-throw if not EXDEV
			throw err;
		}
	}
}

export function getDecisions(cwd: string): Record<string, Decision> | null {
	return loadDecisionsFile(cwd);
}
