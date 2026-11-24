const testFile = /(?:^|\/)(?:[^/]*\.(?:test|spec)\.(?:ts|js|mjs)|[^/]*\.snap)$|(?:^|\/)(?:test|tests|__tests__|__snapshots__|fixtures|__mocks__)\/|^packages\/quality\/(?:policy|testing|environments|efficiency\/microbenchmarks)\//;

/** @typedef {{ filename: string, previous_filename?: string }} ChangedFile */
/** @typedef {{ approvals: number, involved: number }} ReviewRule */

/**
 * @param {ChangedFile[]} files
 * @param {string} content
 * @param {boolean} requiredOnly
 */
function resolveOwnership(files, content, requiredOnly) {
  const entries = content.split('\n').flatMap((raw, index) => {
    const comment = raw.search(/(^|\s)#/);
    const line = (comment < 0 ? raw : raw.slice(0, comment)).trim();
    if (!line) return [];
    const [pattern, team, option, ...extra] = line.split(/\s+/);
    const review = /^(required|involved)(?:\((\d+)\))?$/.exec(option ?? '');
    const count = Number(review?.[2] ?? 1);
    if (!/^@[\w.-]+\/[\w.-]+$/.test(team ?? '') || extra.length || (option && !review) || count < 1 || count > 5) {
      throw new Error(`Invalid OWNERS rule on line ${index + 1}`);
    }
    if (pattern.startsWith('/') || (pattern !== '*' && /[*?[]/.test(pattern))) {
      throw new Error(`Unsupported OWNERS pattern on line ${index + 1}`);
    }
    return [{ pattern, team, review: review?.[1], count }];
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
    (teams[entry.team] ??= []).push(path);
    const rule = rules[entry.team] ??= { approvals: 0, involved: 0 };
    if (entry.review) {
      const key = entry.review === 'required' ? 'approvals' : 'involved';
      rule[key] = Math.max(rule[key], entry.count);
    }
  }
  return { teams, rules };
}

/** @param {ChangedFile[]} files @param {string} content */
export function resolveRequiredTeams(files, content) {
  return resolveOwnership(files, content, true);
}

/** @param {ChangedFile[]} files @param {string} content @param {boolean} requiredOnly */
export function resolveOwnerTeamHandles(files, content, requiredOnly) {
  return Object.keys(resolveOwnership(files, content, requiredOnly).teams);
}
