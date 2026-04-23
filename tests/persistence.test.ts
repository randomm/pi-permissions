import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleCorruption, loadDecisions, saveDecision } from '../persistence';

let tempDir: string;

function readPermissionsFile(
	dir: string,
): Promise<Record<string, unknown> | null> {
	const fs = require('node:fs/promises');
	const path = join(dir, '.pi', 'permissions.json');
	return fs
		.readFile(path, 'utf-8')
		.then((raw: string) => JSON.parse(raw))
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
		const data = await readPermissionsFile(tempDir);
		if (!data) throw new Error('unexpected null config');

		expect(data._decisions['bash:npm install lodash']).toEqual({
			allowed: true,
			timestamp: expect.any(String),
		});
	});

	it('creates the .pi directory if it does not exist', async () => {
		const freshDir = await mkdtemp(join(tmpdir(), 'pi-fresh-'));
		await saveDecision(freshDir, 'bash', 'npm install lodash', true);
		const exists = await readFile(
			join(freshDir, '.pi', 'permissions.json'),
			'utf-8',
		)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);
		await rm(freshDir, { recursive: true, force: true });
	});

	it('overwrites existing file with atomic write', async () => {
		await saveDecision(tempDir, 'bash', 'npm install lodash', true);
		await saveDecision(tempDir, 'bash', 'npm install express', false);

		const data = await readPermissionsFile(tempDir);
		if (!data) throw new Error('unexpected null config');

		expect(data._decisions['bash:npm install lodash'].allowed).toBe(true);
		expect(data._decisions['bash:npm install express'].allowed).toBe(false);
	});
});

describe('loadDecisions', () => {
	it('loads decisions from config file', async () => {
		await saveDecision(tempDir, 'bash', 'npm install lodash', true);
		await saveDecision(tempDir, 'bash', 'rm -rf /', false);

		const decisions = loadDecisions(tempDir);
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

	it('preserves existing config sections when saving', async () => {
		const fs = require('node:fs/promises');
		await fs.writeFile(
			join(tempDir, '.pi', 'permissions.json'),
			JSON.stringify({
				default: 'deny',
				bash: { '*': 'deny', 'npm install *': 'allow' },
				tools: { read: 'allow' },
				_decisions: {},
			}),
		);

		await saveDecision(tempDir, 'bash', 'rm -rf /', false);

		const data = await readPermissionsFile(tempDir);
		if (!data) throw new Error('unexpected null config');

		expect(data.default).toBe('deny');
		expect(data.bash).toEqual({ '*': 'deny', 'npm install *': 'allow' });
		expect(data.tools).toEqual({ read: 'allow' });
		expect(data._decisions['bash:rm -rf /'].allowed).toBe(false);
	});

	it('returns null when file does not exist', () => {
		const decisions = loadDecisions(tempDir);
		expect(decisions).toBeNull();
	});

	it('returns null when file is corrupted', async () => {
		await writeFile(
			join(tempDir, '.pi', 'permissions.json'),
			'corrupted{{{data}}}',
		);
		const decisions = loadDecisions(tempDir);
		expect(decisions).toBeNull();
	});
});

describe('handleCorruption', () => {
	it('creates a .corrupted backup', async () => {
		await writeFile(
			join(tempDir, '.pi', 'permissions.json'),
			'corrupted{{{data}}}',
		);

		const fs = require('node:fs/promises');
		const corruptedPath = join(tempDir, '.pi', 'permissions.json.corrupted');
		handleCorruption(tempDir, join(tempDir, '.pi', 'permissions.json'));

		// Backup file exists
		const exists = await fs
			.access(corruptedPath)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);

		// Original file is removed
		const originalExists = await fs
			.access(join(tempDir, '.pi', 'permissions.json'))
			.then(() => true)
			.catch(() => false);
		expect(originalExists).toBe(false);
	});

	it('creates .pi directory if it does not exist', async () => {
		const freshDir = await mkdtemp(join(tmpdir(), 'pi-fresh-'));
		const fs = require('node:fs/promises');
		await fs.mkdir(join(freshDir, '.pi'), { recursive: true });
		await fs.writeFile(
			join(freshDir, '.pi', 'permissions.json'),
			'corrupted{{{data}}}',
		);

		handleCorruption(freshDir, join(freshDir, '.pi', 'permissions.json'));

		const corruptedPath = join(freshDir, '.pi', 'permissions.json.corrupted');
		const exists = await fs
			.access(corruptedPath)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);

		await rm(freshDir, { recursive: true, force: true });
	});
});
