import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitStack } from '$lib/server/db';
import { syncGitStack, deployGitStack } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';

export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git stack not found' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'edit', gitStack.environmentId || undefined)) {
			return json({ error: 'Permission denied' }, { status: 403 });
		}

		const syncResult = await syncGitStack(id);
		
		// If sync detected changes that require redeploy (e.g., triggerRedeploy secrets changed),
		// automatically deploy the stack
		if (syncResult.success && syncResult.updated) {
			console.log(`[Sync:${gitStack.stackName}] Changes detected (updated=true), triggering auto-deploy...`);
			// Use force: true because syncGitStack already detected changes and saved secrets
			// The deploy's internal sync would see no changes since secrets are already updated in DB
			const deployResult = await deployGitStack(id, { force: true });
			
			// Merge deploy result into sync result
			return json({
				...syncResult,
				deployed: true,
				deploySuccess: deployResult.success,
				deployOutput: deployResult.output,
				deployError: deployResult.error
			});
		}
		
		return json({ ...syncResult, deployed: false });
	} catch (error) {
		console.error('Failed to sync git stack:', error);
		return json({ error: 'Failed to sync git stack' }, { status: 500 });
	}
};
