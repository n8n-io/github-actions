export { resolveRequiredTeams } from '../../scripts/owners.mjs';

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
