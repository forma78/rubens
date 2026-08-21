/* Who judges, on what.
 *
 * A judge used to be a role that ran on every vendor: four roles x three
 * vendors was twelve calls per pair, and the same persona spoke three
 * times under three different models. From 2026-08-21 a judge is one
 * persona pinned to one model — six judges, two per vendor, six calls per
 * pair. Half the calls, and every judge in the sidebar is a model you can
 * point at.
 *
 * `vendors: [...]` is the old shape. It is not silently reinterpreted:
 * a config still carrying it is a config that means something this code
 * no longer does, so it throws rather than quietly judging differently. */

function judgeVendor(role) {
  if (Array.isArray(role.vendors)) {
    throw new Error(
      `judge "${role.id}" still uses the old \`vendors\` array — a judge now names one \`vendor\` and one \`model\` (config/roles.json)`,
    );
  }
  if (!role.vendor) throw new Error(`judge "${role.id}" has no \`vendor\``);
  return role.vendor;
}

/** The judge's own model, or the vendor default for a judge without one. */
function judgeModel(role, config) {
  return role.model ?? config?.models?.[judgeVendor(role)]?.judge;
}

/** A judge with no `rounds` judges every round — which is all of them now
 *  that a shift is one real round (schema.sql's briefs.rounds default). */
function activeJudges(roles, roundNum) {
  return (roles?.judges ?? []).filter(j => !j.rounds || j.rounds.includes(roundNum));
}

export { judgeVendor, judgeModel, activeJudges };
