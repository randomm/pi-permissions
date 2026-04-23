import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { checkPermission, loadConfig } from './permissions';
import { saveDecision } from './persistence';

export default function (pi: ExtensionAPI): void {
	let cachedConfig: ReturnType<typeof loadConfig> | null = null;

	pi.on('session_start', async (_event, ctx) => {
		cachedConfig = loadConfig(ctx.cwd);
		if (cachedConfig) {
			ctx.ui.notify(
				`Permissions: ${Object.keys(cachedConfig.bash || {}).length} bash rules, ${Object.keys(cachedConfig.tools || {}).length} tool rules loaded`,
				'info',
			);
		}
	});

	pi.on('tool_call', async (event, ctx) => {
		if (!cachedConfig) {
			cachedConfig = loadConfig(ctx.cwd);
		}

		if (!cachedConfig) {
			return;
		}

		const decision = checkPermission(
			cachedConfig,
			event.toolName,
			JSON.stringify(event.input),
		);

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
			await saveDecision(
				ctx.cwd,
				event.toolName,
				JSON.stringify(event.input),
				true,
			);
			return;
		}

		await saveDecision(
			ctx.cwd,
			event.toolName,
			JSON.stringify(event.input),
			false,
		);
		return { block: true, reason: `Permission denied: ${event.toolName}` };
	});
}
