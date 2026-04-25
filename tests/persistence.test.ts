import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Decision } from '../config';
import { getDecisions, saveDecision } from '../persistence';

let tempDir: string;

async function readDecisionsFile(
	dir: string,
): Promise<Record<string, Decision> | null> {
	const path = join(dir, '.pi', 'decisions.json');
	return readFile(path, 'utf-8')
		.then((raw: string) => JSON.parse(raw) as Record<string, Decision>)
		.catch(() => null);
}

beforeEach(async () => {
	const base = await mkdtemp(join(tmpdir(), 'pi-perms-'));
	tempDir = base;
	await mkdir(join(base, '.pi'), { recursive: true });
});

afterEach(async () => {
	try {
		await rm(tempDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
});

describe('saveDecision', () => {
	it('saves a decision atomically', async () => {
		await saveDecision(tempDir, 'bash', 'npm install lodash', true);
		const data = await readDecisionsFile(tempDir);
		if (!data) throw new Error('unexpected null decisions');

		expect(data['bash:npm install lodash']).toEqual({
			allowed: true,
			timestamp: expect.any(String),
		});
	});

	it('creates the .pi directory if it does not exist', async () => {
		const freshDir = await mkdtemp(join(tmpdir(), 'pi-fresh-'));
		await saveDecision(freshDir, 'bash', 'npm install lodash', true);
		const exists = await readFile(
			join(freshDir, '.pi', 'decisions.json'),
			'utf-8',
		)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);
		await rm(freshDir, { recursive: true, force: true });
	});

	it('overwrites existing decisions with atomic write', async () => {
		await saveDecision(tempDir, 'bash', 'npm install lodash', true);
		await saveDecision(tempDir, 'bash', 'npm install express', false);

		const data = await readDecisionsFile(tempDir);
		if (!data) throw new Error('unexpected null decisions');

		expect(data['bash:npm install lodash'].allowed).toBe(true);
		expect(data['bash:npm install express'].allowed).toBe(false);
	});

	it('uses minified JSON (no pretty-printing)', async () => {
		await saveDecision(tempDir, 'bash', 'npm install lodash', true);
		const raw = await readFile(join(tempDir, '.pi', 'decisions.json'), 'utf-8');

		// Minified JSON should not have newlines or spaces
		expect(raw).not.toContain('\n');
		expect(raw).not.toContain('  ');
	});
});

describe('getDecisions', () => {
	it('loads decisions from separate file', async () => {
		await saveDecision(tempDir, 'bash', 'npm install lodash', true);
		await saveDecision(tempDir, 'bash', 'rm -rf /', false);

		const decisions = getDecisions(tempDir);
		expect(decisions).toEqual({
			'bash:npm install lodash': {
				allowed: true,
				timestamp: expect.any(String),
			},
			'bash:rm -rf /': {
				allowed: false,
				timestamp: expect.any(String),
			},
		});
	});

	it('returns null when file does not exist', () => {
		const decisions = getDecisions(tempDir);
		expect(decisions).toBeNull();
	});

	it('returns null when file is corrupted', async () => {
		await writeFile(
			join(tempDir, '.pi', 'decisions.json'),
			'corrupted{{{data}}}',
		);
		const decisions = getDecisions(tempDir);
		expect(decisions).toBeNull();
	});

	it('validates JSON structure before parsing', async () => {
		// Write invalid decision structure (missing timestamp)
		await writeFile(
			join(tempDir, '.pi', 'decisions.json'),
			JSON.stringify({
				'bash:invalid': { allowed: true }, // missing timestamp
			}),
		);
		const decisions = getDecisions(tempDir);
		expect(decisions).toBeNull();
	});

	it('F2: drops decisions with invalid timestamps at load time', async () => {
		// Write a decisions file with mixed timestamps - only valid ones should be kept
		await writeFile(
			join(tempDir, '.pi', 'decisions.json'),
			JSON.stringify({
				'bash:empty': { allowed: true, timestamp: '' },
				'bash:invalid': { allowed: true, timestamp: 'invalid-date' },
				'bash:valid': {
					allowed: true,
					timestamp: '2026-04-25T00:00:00Z',
				},
			}),
			{ mode: 0o600 },
		);

		// Load - invalid timestamps are dropped, but valid ones remain
		const decisions = getDecisions(tempDir);

		// Only the valid entry should be present
		expect(decisions).not.toBeNull();
		expect(Object.keys(decisions || {})).toHaveLength(1);
		expect(decisions?.['bash:valid']).toBeDefined();
		expect(decisions?.['bash:empty']).toBeUndefined();
		expect(decisions?.['bash:invalid']).toBeUndefined();
	});

	it('F2: LRU compaction keeps most recent by Date.parse value', async () => {
		// Add 600 decisions with varying timestamps
		for (let i = 0; i < 600; i++) {
			await saveDecision(tempDir, 'bash', `command ${i}`, i % 2 === 0);
		}

		const decisions = await readDecisionsFile(tempDir);
		if (!decisions) throw new Error('unexpected null decisions');

		expect(Object.keys(decisions)).toHaveLength(500);

		// Verify the most recent decisions are kept
		const keys = Object.keys(decisions);
		const containsOldest = keys.includes('bash:command 0');
		const containsNewest = keys.includes('bash:command 599');

		expect(containsNewest).toBe(true);
		// The oldest 100 should be evicted
		expect(containsOldest).toBe(false);
	});

	it('F2: handles decisions with unparseable timestamps in compaction', async () => {
		// Create a decisions file with entries that will have parse issues
		const decisionsPath = join(tempDir, '.pi', 'decisions.json');
		const mixedDecisions: Record<string, Decision> = {};

		// Add 600 entries, some with invalid timestamps
		for (let i = 0; i < 600; i++) {
			mixedDecisions[`bash:command ${i}`] = {
				allowed: true,
				timestamp:
					i % 10 === 0
						? 'invalid'
						: i % 5 === 0
							? ''
							: new Date(i).toISOString(),
			};
		}

		await writeFile(decisionsPath, JSON.stringify(mixedDecisions), {
			mode: 0o600,
		});

		// Load and re-save - invalid timestamps should be dropped
		await saveDecision(tempDir, 'bash', 'trigger compaction', true);

		const finalDecisions = await readDecisionsFile(tempDir);
		if (!finalDecisions) throw new Error('unexpected null decisions');

		// All entries should have parseable timestamps now
		for (const value of Object.values(finalDecisions)) {
			expect(Number.isNaN(Date.parse(value.timestamp))).toBe(false);
		}

		// Should be capped at 500
		expect(Object.keys(finalDecisions).length).toBeLessThanOrEqual(500);
	});
});
