import { describe, expect, it } from 'vitest';
import { matches } from '../matcher';

describe('matcher', () => {
	describe('wildcard matching', () => {
		it('matches * against any input', () => {
			expect(matches('*', 'anything at all')).toBe(true);
			expect(matches('*', '')).toBe(true);
			expect(matches('*', 'foo bar baz')).toBe(true);
		});

		it('matches pattern with leading wildcard', () => {
			expect(matches('* install', 'npm install')).toBe(true);
			expect(matches('* install', 'yarn install')).toBe(true);
			expect(matches('* install', 'install')).toBe(false);
		});

		it('matches pattern with trailing wildcard', () => {
			expect(matches('npm install *', 'npm install lodash')).toBe(true);
			expect(matches('npm install *', 'npm install foo bar')).toBe(true);
			expect(matches('git diff *', 'git diff --staged')).toBe(true);
			expect(matches('rm -rf *', 'rm -rf /')).toBe(true);
		});

		it('matches pattern with wildcard in middle', () => {
			expect(matches('git * diff', 'git status diff')).toBe(true);
			expect(matches('git * diff', 'git log diff')).toBe(true);
		});

		it('does not match when prefix differs', () => {
			expect(matches('npm install *', 'yarn install lodash')).toBe(false);
			expect(matches('git diff *', 'git push origin')).toBe(false);
			expect(matches('rm -rf *', 'rm -f /')).toBe(false);
		});

		it('does not match when suffix differs', () => {
			expect(matches('npm install *', 'npm uninstall lodash')).toBe(false);
			expect(matches('git diff *', 'git diff')).toBe(false);
		});
	});

	describe('literal matching (no wildcard)', () => {
		it('matches exact strings', () => {
			expect(matches('exact', 'exact')).toBe(true);
		});

		it('does not match different strings', () => {
			expect(matches('exact', 'exact2')).toBe(false);
			expect(matches('exact', 'not exact')).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('matches empty pattern against empty input', () => {
			expect(matches('', '')).toBe(true);
		});

		it('does not match empty pattern against non-empty input', () => {
			expect(matches('', 'anything')).toBe(false);
		});

		it('matches pattern with only wildcard against any input', () => {
			expect(matches('*', 'a')).toBe(true);
			expect(matches('*', 'a b c')).toBe(true);
		});

		it('matches pattern with consecutive wildcards', () => {
			expect(matches('**', 'anything')).toBe(true);
			expect(matches('a**b', 'aXYb')).toBe(true);
		});

		it('is case-sensitive', () => {
			expect(matches('NPM install', 'npm install')).toBe(false);
			expect(matches('npm install', 'NPM install')).toBe(false);
		});
	});
});
