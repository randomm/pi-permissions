import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { checkPermission, loadConfig } from './config';
import { getDecisions, saveDecision } from './persistence';

export default function (pi: ExtensionAPI): void {
	let cachedConfig: ReturnType<typeof loadConfig> | null = null;
	let cwd: string | null = null;

	pi.on('session_start', async (_event, ctx) => {
		cwd = ctx.cwd;
		cachedConfig = loadConfig(ctx.cwd);
		if (cachedConfig) {
			// Load decisions from separate file
			const decisions = getDecisions(ctx.cwd);
			if (decisions) {
				cachedConfig._decisions = decisions;
			}
			ctx.ui.notify(
				`Permissions: ${Object.keys(cachedConfig.bash || {}).length} bash rules, ${Object.keys(cachedConfig.tools || {}).length} tool rules loaded`,
				'info',
			);
		}
	});

	pi.on('tool_call', async (event, ctx) => {
		// Fail-closed: if config is not loaded, block everything
		if (!cachedConfig || !cwd) {
			return { block: true, reason: 'No permissions config loaded' };
		}

		// Safely serialize input - if it fails, block the call
		let inputStr: string;
		try {
			inputStr = JSON.stringify(event.input);
		} catch {
			return {
				block: true,
				reason: `Permission denied: ${event.toolName} (non-serializable input)`,
			};
		}

		const decision = checkPermission(cachedConfig, event.toolName, inputStr);

		if (decision === 'allow') {
			return;
		}

		if (decision === 'deny') {
			return { block: true, reason: `Permission denied: ${event.toolName}` };
		}

		// decision === 'ask'
		if (!('hasUI' in ctx) || !ctx.hasUI) {
			return {
				block: true,
				reason: `Permission denied: ${event.toolName} (no UI available)`,
			};
		}

		const confirmed = await ctx.ui.confirm(
			'Permission Request',
			`Allow ${event.toolName}?`,
		);

		if (confirmed) {
			await saveDecision(cwd, event.toolName, inputStr, true);
			// Update cache
			if (cachedConfig._decisions) {
				cachedConfig._decisions[`${event.toolName}:${inputStr}`] = {
					allowed: true,
					timestamp: new Date().toISOString(),
				};
			}
			return;
		}

		await saveDecision(cwd, event.toolName, inputStr, false);
		// Update cache
		if (cachedConfig._decisions) {
			cachedConfig._decisions[`${event.toolName}:${inputStr}`] = {
				allowed: false,
				timestamp: new Date().toISOString(),
			};
		}
		return { block: true, reason: `Permission denied: ${event.toolName}` };
	});
}
