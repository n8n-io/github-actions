export { resolveRequiredTeams } from '../../scripts/owners.mjs';

export function missingApprovals(rule, approvals, authorIsMember) {
  return Math.max(0, rule.approvals - approvals, rule.involved - (authorIsMember ? 1 : 0) - approvals);
}

// An approval with `!required` in its body covers only files that have a required owner.
const requiredOnlyMarker = /(?:^|\s)!required(?=\s|$)/i;

/** @returns {{ login: string, requiredOnly: boolean }[]} */
export function collectApprovers(reviews) {
  const latest = new Map();
  for (const review of reviews.toSorted((left, right) => new Date(left.submitted_at ?? 0) - new Date(right.submitted_at ?? 0))) {
    if (review.user?.login && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      latest.set(review.user.login.toLowerCase(), review);
    }
  }
  return [...latest]
    .filter(([, review]) => review.state === 'APPROVED')
    .map(([login, review]) => ({ login, requiredOnly: requiredOnlyMarker.test(review.body ?? '') }));
}
