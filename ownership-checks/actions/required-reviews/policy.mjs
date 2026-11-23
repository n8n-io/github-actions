const testFile = /(?:^|\/)(?:[^/]*\.(?:test|spec)\.(?:ts|js|mjs)|[^/]*\.snap)$|(?:^|\/)(?:test|tests|__tests__|__snapshots__|fixtures|__mocks__)\/|^packages\/quality\/(?:policy|testing|environments|efficiency\/microbenchmarks)\//;

export function resolveRequiredTeams(files, content) {
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

  const teams = {};
  const rules = {};
  if (files.some(file => typeof file?.filename !== 'string' || !file.filename ||
    (file.previous_filename !== undefined && typeof file.previous_filename !== 'string'))) {
    throw new Error('GitHub did not return valid changed paths');
  }
  const paths = new Set(files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)));
  for (const path of [...paths].sort()) {
    if (testFile.test(path)) continue;
    const entry = entries.find(({ pattern }) => pattern === '*' || (pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern));
    if (!entry?.review) continue;
    (teams[entry.team] ??= []).push(path);
    const rule = rules[entry.team] ??= { approvals: 0, involved: 0 };
    const key = entry.review === 'required' ? 'approvals' : 'involved';
    rule[key] = Math.max(rule[key], entry.count);
  }
  return { teams, rules };
}

export function missingApprovals(rule, approvals, authorIsMember) {
  return Math.max(0, rule.approvals - approvals, rule.involved - (authorIsMember ? 1 : 0) - approvals);
}

export function collectApprovers(reviews) {
  const states = new Map();
  for (const review of reviews.toSorted((left, right) => new Date(left.submitted_at ?? 0) - new Date(right.submitted_at ?? 0))) {
    if (review.user?.login && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      states.set(review.user.login.toLowerCase(), review.state);
    }
  }
  return [...states].filter(([, state]) => state === 'APPROVED').map(([login]) => login);
}
