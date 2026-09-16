const RISK_RANK = Object.freeze({ low: 0, normal: 1, high: 2, critical: 3 });

export function partitionAuditTargets(targets, maximumContextBytes) {
  if (!Number.isSafeInteger(maximumContextBytes) || maximumContextBytes < 1) throw new TypeError('maximumContextBytes must be a positive safe integer');
  const normalized = targets.map((target, index) => {
    if (!target || target.path !== String(target.path) || !target.path || !Number.isSafeInteger(target.context_bytes) || target.context_bytes < 0) throw new TypeError(`invalid audit target at index ${index}`);
    if (target.context_bytes > maximumContextBytes) throw new RangeError(`audit target exceeds shard context: ${target.path}`);
    return { path: target.path, component: target.component ?? target.path.split('/')[0], risk: target.risk ?? 'normal', context_bytes: target.context_bytes };
  }).sort((left, right) => RISK_RANK[right.risk] - RISK_RANK[left.risk] || left.component.localeCompare(right.component) || left.path.localeCompare(right.path));
  const shards = [];
  for (const target of normalized) {
    const shard = shards.find(candidate => candidate.component === target.component && candidate.context_bytes + target.context_bytes <= maximumContextBytes)
      ?? shards.find(candidate => candidate.context_bytes + target.context_bytes <= maximumContextBytes);
    if (shard) { shard.targets.push(target); shard.context_bytes += target.context_bytes; shard.risk = higherRisk(shard.risk, target.risk); }
    else shards.push({ shard_id: `audit-shard-${shards.length + 1}`, component: target.component, risk: target.risk, context_bytes: target.context_bytes, targets: [target] });
  }
  return shards;
}

export function deduplicateAuditFindings(findings) {
  const unique = [];
  for (const finding of findings) {
    const index = unique.findIndex(previous => previous.rule_id === finding.rule_id && previous.path === finding.path && (previous.line ?? 0) === (finding.line ?? 0) && previous.message === finding.message);
    if (index < 0) unique.push(finding);
    else if (RISK_RANK[finding.risk ?? 'normal'] > RISK_RANK[unique[index].risk ?? 'normal']) unique[index] = finding;
  }
  return unique.sort((left, right) => RISK_RANK[right.risk ?? 'normal'] - RISK_RANK[left.risk ?? 'normal'] || left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0) || left.rule_id.localeCompare(right.rule_id));
}

function higherRisk(left, right) { return RISK_RANK[right] > RISK_RANK[left] ? right : left; }
