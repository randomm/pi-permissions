import { describe, expect, it } from 'vitest';
import { matches } from '../matcher';

describe('matcher performance and security', () => {
	describe('memoization', () => {
		it('handles pathological pattern without exponential backtracking', () => {
			const pattern = '*'.repeat(40);
			const input = 'x'.repeat(40);

			// This should complete quickly (bounded by memoization)
			const start = Date.now();
			const result = matches(pattern, input);
			const duration = Date.now() - start;

			expect(result).toBe(true);
			expect(duration).toBeLessThan(100); // Should complete in under 100ms
		});

		it('handles multiple wildcards efficiently', () => {
			const pattern = '*a*b*c*d*e*f*g*h*i*j*';
			const input = 'some_a_b_c_d_e_f_g_h_i_j_string';

			// Should handle this quickly
			const start = Date.now();
			const result = matches(pattern, input);
			const duration = Date.now() - start;

			expect(result).toBe(true);
			expect(duration).toBeLessThan(100);
		});

		it('does not degrade with repeated matches of same pattern', () => {
			const pattern = 'npm install *';
			// Warm up
			matches(pattern, 'npm install lodash');
			matches(pattern, 'npm install express');

			// Now time multiple matches
			const start = Date.now();
			for (let i = 0; i < 100; i++) {
				matches(pattern, `npm install package${i}`);
			}
			const duration = Date.now() - start;

			// 100 matches should be very fast
			expect(duration).toBeLessThan(50);
		});
	});

	describe('path matching edge cases', () => {
		it('matches paths with wildcards', () => {
			expect(matches('./scripts/*', './scripts/test.sh')).toBe(true);
			expect(matches('./scripts/*', './scripts/nested/test.sh')).toBe(true);
			expect(matches('./scripts/*', './scripts.sh')).toBe(false);
		});

		it('matches exact paths', () => {
			expect(matches('./test/e2e/e2e-qa.sh', './test/e2e/e2e-qa.sh')).toBe(
				true,
			);
			expect(matches('./test/e2e/e2e-qa.sh', './test/e2e/e2e-qa-test.sh')).toBe(
				false,
			);
		});

		it('handles absolute paths', () => {
			expect(matches('/usr/local/*', '/usr/local/bin/node')).toBe(true);
			expect(matches('/usr/local/*', '/usr/bin/node')).toBe(false);
		});
	});
});
