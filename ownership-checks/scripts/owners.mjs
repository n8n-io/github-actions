import { readFileSync } from 'node:fs';

const testFile = /(?:^|\/)(?:[^/]*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)|[^/]*\.snap)$|(?:^|\/)(?:test|tests|__tests__|__snapshots__|fixtures|__mocks__)\/|^packages\/quality\/(?:policy|testing|environments|efficiency\/microbenchmarks)\//;

const handlePattern = /^@[\w.-]+\/[\w.-]+$/;

/** @typedef {{ filename: string, previous_filename?: string }} ChangedFile */
/** @typedef {{ teams: string[], approvals: number, involved: number }} ReviewRule */
// Alias handle to `or` groups of team handles; every group must approve.
/** @typedef {Map<string, string[][]>} TeamAliases */

/** @param {string} content */
function lines(content) {
  return content.split('\n').flatMap((raw, index) => {
    const comment = raw.search(/(^|\s)#/);
    const line = (comment < 0 ? raw : raw.slice(0, comment)).trim();
    return line ? [{ fields: line.split(/\s+/), number: index + 1 }] : [];
  });
}

/** @param {string} content @returns {TeamAliases} */
export function parseTeamAliases(content) {
  /** @type {TeamAliases} */
  const aliases = new Map();
  const parsed = lines(content).map(({ fields: [alias, mode, ...targets], number }) => {
    const handles = targets.map(target => target.toLowerCase());
    const org = alias?.toLowerCase().split('/')[0];
    if (!handlePattern.test(alias ?? '') || !['or', 'and'].includes(mode) || !handles.length ||
      new Set(handles).size !== handles.length ||
      handles.some(handle => !handlePattern.test(handle) || handle.split('/')[0] !== org)) {
      throw new Error(`Invalid team alias on line ${number}`);
    }
    return { alias: alias.toLowerCase(), groups: mode === 'or' ? [handles.toSorted()] : handles.map(handle => [handle]), number };
  });
  for (const { alias, groups, number } of parsed) {
    if (aliases.has(alias)) throw new Error(`Duplicate team alias on line ${number}`);
    aliases.set(alias, groups);
  }
  for (const { groups, number } of parsed) {
    if (groups.flat().some(handle => aliases.has(handle))) throw new Error(`Team alias on line ${number} targets an alias`);
  }
  return aliases;
}

const teamAliases = parseTeamAliases(readFileSync(new URL('../TEAM_ALIASES', import.meta.url), 'utf8'));

/**
 * @param {ChangedFile[]} files
 * @param {string} content
 * @param {boolean} requiredOnly
 * @param {TeamAliases} aliases
 */
function resolveOwnership(files, content, requiredOnly, aliases) {
  const entries = lines(content).map(({ fields: [pattern, team, option, ...extra], number }) => {
    const review = /^(required|involved)(?:\((\d+)\))?$/.exec(option ?? '');
    const count = Number(review?.[2] ?? 1);
    if (!handlePattern.test(team ?? '') || extra.length || (option && !review) || count < 1 || count > 5) {
      throw new Error(`Invalid OWNERS rule on line ${number}`);
    }
    if (pattern.startsWith('/') || pattern.startsWith('./') || (pattern !== '*' && /[*?[]/.test(pattern))) {
      throw new Error(`Unsupported OWNERS pattern on line ${number}`);
    }
    const handle = team.toLowerCase();
    return { pattern, groups: aliases.get(handle) ?? [[handle]], review: review?.[1], count };
  }).reverse();

  /** @type {Record<string, string[]>} */
  const teams = {};
  /** @type {Record<string, ReviewRule>} */
  const rules = {};
  if (files.some(file => typeof file?.filename !== 'string' || !file.filename ||
    (file.previous_filename !== undefined && typeof file.previous_filename !== 'string'))) {
    throw new Error('GitHub did not return valid changed paths');
  }
  const paths = new Set(files.flatMap(file => file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]));
  for (const path of [...paths].sort()) {
    if (requiredOnly && testFile.test(path)) continue;
    const entry = entries.find(({ pattern }) => pattern === '*' || (pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern));
    if (!entry || (requiredOnly && !entry.review)) continue;
    for (const group of entry.groups) {
      for (const team of group) (teams[team] ??= []).push(path);
      const rule = rules[group.join(' ')] ??= { teams: group, approvals: 0, involved: 0 };
      if (entry.review) {
        const key = entry.review === 'required' ? 'approvals' : 'involved';
        rule[key] = Math.max(rule[key], entry.count);
      }
    }
  }
  return { teams, rules };
}

/** @param {ChangedFile[]} files @param {string} content @param {TeamAliases} [aliases] */
export function resolveRequiredTeams(files, content, aliases = teamAliases) {
  return resolveOwnership(files, content, true, aliases);
}

/** @param {ChangedFile[]} files @param {string} content @param {boolean} requiredOnly @param {TeamAliases} [aliases] */
export function resolveOwnerTeamHandles(files, content, requiredOnly, aliases = teamAliases) {
  return Object.keys(resolveOwnership(files, content, requiredOnly, aliases).teams);
}
