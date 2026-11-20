import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	findOwningEntry,
	isTestFile,
	missingApprovals,
	parseOwnersContent,
	resolveOwningTeams,
	resolveRequiredTeams
} from '../owners.mjs';

describe('OWNERS parsing', () => {
	test('parses comments, teams, and required options', () => {
		assert.deepEqual(parseOwnersContent([
			'# Default owner',
			'* @n8n-io/catalysts',
			'packages/cli/ @n8n-io/cli required # approval gate'
		].join('\n')), [
			{ pattern: '*', team: '@n8n-io/catalysts', review: null, line: 2 },
			{ pattern: 'packages/cli/', team: '@n8n-io/cli', review: { rule: 'required', count: 1 }, line: 3 }
		]);
	});

	test('parses involved options and review counts', () => {
		assert.deepEqual(parseOwnersContent([
			'a/ @n8n-io/a involved',
			'b/ @n8n-io/b required(2)',
			'c/ @n8n-io/c involved(5)',
			'd/ @n8n-io/d required(1)',
			'e/ @n8n-io/e involved(1)'
		].join('\n')).map(entry => entry.review), [
			{ rule: 'involved', count: 1 },
			{ rule: 'required', count: 2 },
			{ rule: 'involved', count: 5 },
			{ rule: 'required', count: 1 },
			{ rule: 'involved', count: 1 }
		]);
	});

	test('rejects review counts outside 1 to 5 and combined options', () => {
		for (const token of ['involved(6)', 'required(10)', 'required(0)', 'required()', 'required(02x)', 'involved (2)']) {
			assert.throws(() => parseOwnersContent(`pkg/ @n8n-io/a ${token}`), /OWNERS line 1: (count in|unknown token)/, token);
		}
		assert.throws(() => parseOwnersContent('pkg/ @n8n-io/a required involved'), /only one of "required" and "involved"/);
		assert.throws(() => parseOwnersContent('pkg/ involved @n8n-io/a'), /must come before options/);
	});

	test('rejects malformed entries with their line number', () => {
		assert.throws(() => parseOwnersContent('\npkg/ required'), /OWNERS line 2: no team/);
		assert.throws(() => parseOwnersContent('pkg/ @n8n-io/a unknown'), /unknown token/);
		assert.throws(() => parseOwnersContent('pkg/ @n8n-io/a @n8n-io/b'), /only one team/);
	});
});

describe('required ownership resolution', () => {
	const entries = parseOwnersContent([
		'* @n8n-io/default',
		'.github/ @n8n-io/qa',
		'.github/workflows/ @n8n-io/qa required',
		'packages/cli/ @n8n-io/cli required',
		'packages/cli/test/ @n8n-io/cli'
	].join('\n'));

	test('uses last-match-wins and groups required files deterministically', () => {
		assert.deepEqual(resolveRequiredTeams([
			'packages/cli/src/z.ts',
			'.github/workflows/ci.yml',
			'packages/cli/src/a.ts',
			'README.md'
		], entries).teams, {
			'@n8n-io/qa': ['.github/workflows/ci.yml'],
			'@n8n-io/cli': ['packages/cli/src/a.ts', 'packages/cli/src/z.ts']
		});
		assert.equal(findOwningEntry('packages/cli/test/helper.ts', entries)?.review, null);
	});

	test('matches the catch-all, directory, and exact-path shapes only', () => {
		const shapes = parseOwnersContent([
			'* @n8n-io/default',
			'packages/cli/ @n8n-io/cli required',
			'packages/cli/src/config.ts @n8n-io/config'
		].join('\n'));
		assert.equal(findOwningEntry('packages/cli/nested/deep/worker.ts', shapes)?.team, '@n8n-io/cli');
		assert.equal(findOwningEntry('packages/cli/src/config.ts', shapes)?.team, '@n8n-io/config');
		assert.equal(findOwningEntry('packages/cli/src/configXts', shapes)?.team, '@n8n-io/cli');
		assert.equal(findOwningEntry('packages/cli-extra/index.ts', shapes)?.team, '@n8n-io/default');
		assert.equal(findOwningEntry('nested/packages/cli/index.ts', shapes)?.team, '@n8n-io/default');
		assert.equal(findOwningEntry('packages/cli', shapes)?.team, '@n8n-io/default');
	});

	test('rejects glob patterns with their line number', () => {
		for (const pattern of ['packages/cli/**', 'packages/*/src/', '*.md', 'docs/file?.md', 'docs/[ab].md', '**']) {
			assert.throws(() => parseOwnersContent(`* @n8n-io/default\n${pattern} @n8n-io/cli`), /OWNERS line 2: glob pattern .* is not supported/, pattern);
		}
	});

	test('groups every changed file by its winning owner', () => {
		assert.deepEqual(resolveOwningTeams([
			'README.md',
			'packages/cli/src/a.test.ts',
			'.github/workflows/ci.yml'
		], entries), {
			'@n8n-io/qa': ['.github/workflows/ci.yml'],
			'@n8n-io/default': ['README.md'],
			'@n8n-io/cli': ['packages/cli/src/a.test.ts']
		});
	});

	test('excludes the same test paths as the n8n enforcement', () => {
		for (const file of [
			'packages/cli/src/a.test.ts',
			'packages/cli/tests/a.ts',
			'packages/cli/__snapshots__/a.snap',
			'packages/quality/testing/a.ts'
		]) {
			assert.equal(isTestFile(file), true, file);
		}
		assert.deepEqual(resolveRequiredTeams([
			'packages/cli/src/a.test.ts',
			'packages/cli/src/a.ts'
		], entries).teams, { '@n8n-io/cli': ['packages/cli/src/a.ts'] });
	});

	test('keeps the highest required and involved counts of each team', () => {
		const rules = parseOwnersContent([
			'a/ @n8n-io/cli required',
			'b/ @n8n-io/cli required(3)',
			'c/ @n8n-io/cli involved(4)',
			'd/ @n8n-io/qa involved',
			'e/ @n8n-io/qa involved(2)'
		].join('\n'));
		assert.deepEqual(resolveRequiredTeams(['a/1.ts', 'b/1.ts', 'c/1.ts', 'd/1.ts', 'e/1.ts'], rules).rules, {
			'@n8n-io/cli': { approvals: 3, involved: 4 },
			'@n8n-io/qa': { approvals: 0, involved: 2 }
		});
	});
});

describe('missing approvals', () => {
	test('counts the author only for involved teams', () => {
		assert.equal(missingApprovals({ approvals: 1, involved: 0 }, 0, true), 1);
		assert.equal(missingApprovals({ approvals: 0, involved: 1 }, 0, true), 0);
		assert.equal(missingApprovals({ approvals: 0, involved: 1 }, 0, false), 1);
		assert.equal(missingApprovals({ approvals: 0, involved: 3 }, 1, true), 1);
		assert.equal(missingApprovals({ approvals: 0, involved: 3 }, 2, true), 0);
		assert.equal(missingApprovals({ approvals: 2, involved: 2 }, 1, true), 1);
		assert.equal(missingApprovals({ approvals: 2, involved: 4 }, 2, true), 1);
	});
});
