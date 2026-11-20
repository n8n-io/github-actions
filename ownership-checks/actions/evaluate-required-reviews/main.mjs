// Runs with no install step: the lib has no dependencies.
import { appendFileSync } from 'node:fs';
import { enforceRequiredReviews, passMergeGroup } from '../../lib/index.mjs';

/** @param {string} name */
function input(name) {
	return (process.env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
}

/** @param {string} name */
function env(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set; run this action in GitHub Actions.`);
	return value;
}

async function run() {
	const token = input('github-token');
	if (!token) throw new Error('Pass github-token.');
	const repository = env('GITHUB_REPOSITORY');
	const targetUrl = `${env('GITHUB_SERVER_URL')}/${repository}/actions/runs/${env('GITHUB_RUN_ID')}`;

	if (env('GITHUB_EVENT_NAME') === 'merge_group') {
		return passMergeGroup({ token, repository, headSha: env('GITHUB_SHA'), targetUrl });
	}

	const number = input('pull-request-number');
	const headSha = input('head-sha').toLowerCase();
	if (!/^[1-9][0-9]*$/.test(number)) throw new Error('Pass pull-request-number.');
	if (!/^[a-f0-9]{40,64}$/.test(headSha)) throw new Error('Pass head-sha.');
	return enforceRequiredReviews({ token, repository, pullRequestNumber: Number(number), expectedHeadSha: headSha, targetUrl });
}

try {
	const result = await run();
	console.log(JSON.stringify(result, null, 2));
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.state}\n`);
} catch (error) {
	console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
