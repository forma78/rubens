/* A fake for src/syndicate/sync.js's whole exported surface — every
   function run.js can call, backed by a tiny in-memory store instead of a
   real Supabase project. Default behaviour is realistic enough (labelToUuid
   really gets extended by syncVariants, closeBrief really merges onto the
   row insertBrief created) that a test exercising the full incremental
   flow doesn't have to hand-roll it — override individual functions on
   the returned object for a specific failure case instead. */
function makeFakeSync({ claimResult, failAt } = {}) {
  let n = 0;
  const nextId = () => `synced-uuid-${++n}`;
  const briefs = new Map();
  const variants = new Map();
  const calls = { signIn: [], claimBrief: [], fetchBriefById: [], insertBrief: [], closeBrief: [], syncVariants: [], syncVariantResults: [], syncComparisons: [] };

  function maybeFail(name) {
    if (failAt === name) throw new Error(`fake sync: ${name} failed on purpose`);
  }

  const fake = {
    calls, briefs, variants,
    signIn: async (args) => { calls.signIn.push(args); maybeFail('signIn'); return { accessToken: 'jwt-abc' }; },
    claimBrief: async (args) => { calls.claimBrief.push(args); maybeFail('claimBrief'); return claimResult ?? null; },
    fetchBriefById: async (args) => { calls.fetchBriefById.push(args); maybeFail('fetchBriefById'); throw new Error('fetchBriefById not stubbed for this test'); },
    insertBrief: async (args) => {
      calls.insertBrief.push(args);
      maybeFail('insertBrief');
      const id = nextId();
      briefs.set(id, { id, slug: args.brief.id, status: 'running' });
      return { briefId: id };
    },
    closeBrief: async (args) => {
      calls.closeBrief.push(args);
      maybeFail('closeBrief');
      const b = briefs.get(args.briefId);
      if (b) Object.assign(b, { status: args.status, cost_usd: args.costUsd, rounds: args.rounds });
    },
    syncVariants: async (args) => {
      calls.syncVariants.push(args);
      maybeFail('syncVariants');
      let count = 0;
      for (const v of args.variants) {
        if (!/^round-\d+$/.test(v.roundNum ?? '')) continue;
        const id = nextId();
        variants.set(id, { id, label: v.id });
        args.labelToUuid.set(v.id, id);
        count++;
      }
      return { count };
    },
    syncVariantResults: async (args) => { calls.syncVariantResults.push(args); maybeFail('syncVariantResults'); return { count: args.variants.length }; },
    syncComparisons: async (args) => { calls.syncComparisons.push(args); maybeFail('syncComparisons'); return { count: args.comparisons.length }; },
  };
  return fake;
}

export { makeFakeSync };
