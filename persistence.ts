import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Decision } from './config';
import { ensureSecureDirectory } from './security';

const DECISIONS_FILENAME = '.pi/decisions.json';
const MAX_DECISIONS = 500;

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
		// Validate structure and timestamps; drop entries with invalid timestamps
		const valid: Record<string, Decision> = {};
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
			// Drop entries with non-parseable timestamps
			if (Number.isNaN(Date.parse(decision.timestamp))) {
				continue;
			}
			valid[key] = {
				allowed: decision.allowed,
				timestamp: decision.timestamp,
			};
		}
		return valid;
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
	const backupPath = `${decisionsPath}.bak`;

	// Load existing decisions
	const existing = loadDecisionsFile(cwd) || {};
	const key = `${toolName}:${input}`;

	// Build new decisions object
	let newDecisions: Record<string, Decision> = {
		...existing,
		[key]: {
			allowed,
			timestamp: new Date().toISOString(),
		},
	};

	// Cap decisions to MAX_DECISIONS (C2 + H9)
	// Sort by timestamp descending; invalid timestamps (already filtered at load)
	// are handled in comparator by treating NaN as negative infinity
	if (Object.keys(newDecisions).length > MAX_DECISIONS) {
		const sorted = Object.entries(newDecisions).sort(([, a], [, b]) => {
			const timeA = Date.parse(a.timestamp);
			const timeB = Date.parse(b.timestamp);
			// Invalid timestamps (NaN) sort to end (evicted first)
			const safeA = Number.isNaN(timeA) ? Number.NEGATIVE_INFINITY : timeA;
			const safeB = Number.isNaN(timeB) ? Number.NEGATIVE_INFINITY : timeB;
			return safeB - safeA; // Descending: newest first
		});
		newDecisions = Object.fromEntries(sorted.slice(0, MAX_DECISIONS));
	}

	// Backup existing file (C1)
	// CRITICAL: If the original exists and backup fails, do NOT proceed
	if (existsSync(decisionsPath)) {
		try {
			writeFileSync(backupPath, JSON.stringify(existing), { mode: 0o600 });
		} catch (backupErr: unknown) {
			throw new Error(
				'Failed to create backup before decisions write, aborting to prevent data loss',
				{ cause: backupErr },
			);
		}
	}

	// Atomic write: write to tmp, then rename with secure mode
	let threw = false;
	let originalError: unknown | null = null;
	try {
		writeFileSync(tmpPath, JSON.stringify(newDecisions), { mode: 0o600 });
		chmodSync(tmpPath, 0o600);

		try {
			renameSync(tmpPath, decisionsPath);
			chmodSync(decisionsPath, 0o600);
		} catch (err: unknown) {
			threw = true;
			originalError = err;
			const code = (err as { code?: string })?.code;
			if (code === 'EXDEV') {
				// Cross-device: fall back to read-write-delete
				// chmod the target first to ensure we can delete it
				try {
					chmodSync(decisionsPath, 0o600);
				} catch (chmodErr: unknown) {
					const chmodCode = (chmodErr as { code?: string })?.code;
					if (chmodCode !== 'ENOENT') {
						// Re-throw if not ENOENT (H6)
						throw chmodErr;
					}
				}
				writeFileSync(decisionsPath, JSON.stringify(newDecisions), {
					mode: 0o600,
				});
			} else {
				// Re-throw if not EXDEV
				throw err;
			}
		}
	} catch (err: unknown) {
		threw = true;
		originalError = err;
	} finally {
		// Clean up tmp file (with logging per F4)
		try {
			unlinkSync(tmpPath);
		} catch (cleanupErr: unknown) {
			console.error(`Failed to clean up tmp file ${tmpPath}:`, cleanupErr);
		}

		// If we failed and have a backup, restore it (C1)
		if (threw && existsSync(backupPath)) {
			try {
				unlinkSync(decisionsPath);
			} catch (restoreErr: unknown) {
				const code = (restoreErr as { code?: string })?.code;
				if (code !== 'ENOENT') {
					// If we can't delete the corrupted file, log but continue
					console.error(
						`Failed to delete corrupted decisions file: ${restoreErr}`,
					);
				}
			}
			try {
				writeFileSync(decisionsPath, JSON.stringify(existing), {
					mode: 0o600,
				});
				chmodSync(decisionsPath, 0o600);
			} catch (restoreWriteErr: unknown) {
				console.error(
					`Failed to restore backup: ${restoreWriteErr}. Data may be lost.`,
				);
			}
			unlinkSync(backupPath);
		}

		// Clean up backup file on success
		if (!threw && existsSync(backupPath)) {
			try {
				unlinkSync(backupPath);
			} catch {
				// Ignore
			}
		}
	}

	if (originalError) {
		throw originalError;
	}
}

export function getDecisions(cwd: string): Record<string, Decision> | null {
	return loadDecisionsFile(cwd);
}
