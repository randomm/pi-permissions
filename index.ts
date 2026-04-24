import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { PermissionsConfig } from './config';
import { loadConfig } from './config';
import { checkPermission } from './permissions';
import { getDecisions, saveDecision } from './persistence';

function updateDecisionCache(
	config: PermissionsConfig,
	toolName: string,
	inputStr: string,
	allowed: boolean,
): void {
	if (config._decisions) {
		config._decisions[`${toolName}:${inputStr}`] = {
			allowed,
			timestamp: new Date().toISOString(),
		};
	} else {
		config._decisions = {
			[`${toolName}:${inputStr}`]: {
				allowed,
				timestamp: new Date().toISOString(),
			},
		};
	}
}

export default function (pi: ExtensionAPI): void {
	let cachedConfig: ReturnType<typeof loadConfig> | null = null;
	let cwd: string | null = null;

	pi.on('session_start', async (_event, ctx) => {
		cwd = ctx.cwd;
		cachedConfig = loadConfig(ctx.cwd);
		if (cachedConfig) {
			// Load decisions from separate file
			const decisions = getDecisions(ctx.cwd);
			if (decisions && cachedConfig._decisions === undefined) {
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
			updateDecisionCache(cachedConfig, event.toolName, inputStr, true);
			return;
		}

		await saveDecision(cwd, event.toolName, inputStr, false);
		updateDecisionCache(cachedConfig, event.toolName, inputStr, false);
		return { block: true, reason: `Permission denied: ${event.toolName}` };
	});
}
