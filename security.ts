import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ensures the .pi directory exists with secure permissions (700).
 * @param cwd - Current working directory
 * @throws Error if directory cannot be created or has insecure permissions
 */
export function ensureSecureDirectory(cwd: string): void {
	const piDir = join(cwd, '.pi');
	mkdirSync(piDir, { recursive: true, mode: 0o700 });

	// Always try to chmod in case umask changed it or directory already existed with wrong perms
	try {
		chmodSync(piDir, 0o700);
	} catch (err: unknown) {
		const code = (err as { code?: string })?.code;
		// Check actual permissions; if they're already secure, tolerate chmod failure
		try {
			const stats = statSync(piDir);
			const currentMode = stats.mode;
			const MASK = 0o777;
			const ALLOWED_MAX = 0o700;
			if ((currentMode & MASK & ~ALLOWED_MAX) === 0) {
				// No bits set beyond 0o700 — directory is at least as restrictive as required
				console.warn(
					`chmod failed for ${piDir} (code: ${code}), but permissions are already secure (${(currentMode & MASK).toString(8).padStart(3, '0')})`,
				);
				return;
			}
			// Too permissive; real security issue
			const error = err instanceof Error ? err : new Error(String(err));
			throw new Error(
				`Directory ${piDir} has insecure permissions (${currentMode.toString(8).padStart(3, '0')}) and chmod failed`,
				{ cause: error },
			);
		} catch (statErr: unknown) {
			// stat failed too; rethrow original chmod error
			throw err;
		}
	}
}
