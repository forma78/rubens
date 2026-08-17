/* SPEC 3.4 — FINAL.md: top 7 with renders, ratings, disagreement, and the
   three sharpest quotes for and against each. Renders are relative links so
   it renders on GitHub as-is.

   Quotes are attributed by name (roles.json's judges[].name — "Ford",
   "Maeve", ...) rather than by the technical role id ("architect",
   "gallerist") — a future public site is meant to read like comments under
   a photo, and a reader follows who's talking better by name than by id. */

/* "sharpest" has no numeric definition in the spec; the longest quote is
   the closest thing to an objective proxy for "most substantive" available
   without spending another model call to rank them. */
function sharpest(quotes, n = 3) {
  return [...quotes].sort((a, b) => b.why.length - a.why.length).slice(0, n);
}

/** quotesFor(id, comparisons) -> { for: [{why, judgeId}], against: [...] } */
function quotesFor(id, comparisons) {
  const wins = comparisons.filter(c => c.winner === id && c.why).map(c => ({ why: c.why, judgeId: c.judgeId }));
  const losses = comparisons.filter(c => c.loser === id && c.why).map(c => ({ why: c.why, judgeId: c.judgeId }));
  return { for: sharpest(wins), against: sharpest(losses) };
}

function winRateBySource(variantsById, comparisons) {
  const tally = {};
  for (const c of comparisons) {
    for (const id of [c.winner, c.loser]) {
      const source = variantsById.get(id)?.source ?? 'unknown';
      tally[source] ??= { wins: 0, total: 0 };
    }
    const wSource = variantsById.get(c.winner)?.source ?? 'unknown';
    const lSource = variantsById.get(c.loser)?.source ?? 'unknown';
    tally[wSource].wins++;
    tally[wSource].total++;
    tally[lSource].total++;
  }
  return tally;
}

/** { architect: 'Ford', 'gen-loose': 'Dolores', ... } from roles.json */
function namesFromRoles(roles) {
  const names = {};
  for (const j of roles?.judges ?? []) if (j.name) names[j.id] = j.name;
  for (const g of roles?.generators ?? []) if (g.name) names[g.id] = g.name;
  return names;
}

/**
 * renderFinalMd({ brief, finalIds, variantsById, ratings, disagreements,
 * comparisons, roundsRun, costSpent, roles }) -> markdown string
 */
function renderFinalMd({ brief, finalIds, variantsById, ratings, disagreements, comparisons, roundsRun, costSpent, roles }) {
  const names = namesFromRoles(roles);
  const who = (id) => names[id] ?? id;

  const lines = [];
  lines.push(`# ${brief.id}`, '');
  lines.push(`> ${brief.instruction}`, '');
  lines.push(`Rounds run: ${roundsRun}. Spend: $${costSpent.toFixed(2)}.`, '');

  const sorted = [...finalIds].sort((a, b) => (ratings[b] ?? 0) - (ratings[a] ?? 0));

  lines.push('| rank | variant | rating | disagreement | source |', '|---|---|---|---|---|');
  sorted.forEach((id, i) => {
    const v = variantsById.get(id);
    const source = v?.generatorId ? `${v.source} (${who(v.generatorId)})` : (v?.source ?? '?');
    lines.push(`| ${i + 1} | ${id} | ${Math.round(ratings[id] ?? 1500)} | ${((disagreements[id] ?? 0) * 100).toFixed(0)}% | ${source} |`);
  });
  lines.push('');

  for (const id of sorted) {
    const v = variantsById.get(id);
    const source = v?.generatorId ? `${v.source} (${who(v.generatorId)})` : (v?.source ?? '?');
    lines.push(`## ${id}`, '');
    lines.push(`![${id}](${v.roundNum}/variants/${id}.png)`, '');
    lines.push(`Rating ${Math.round(ratings[id] ?? 1500)} · disagreement ${((disagreements[id] ?? 0) * 100).toFixed(0)}% · source: ${source} · intent: ${v?.intent ?? '—'}`, '');
    const { for: forQuotes, against } = quotesFor(id, comparisons);
    if (forQuotes.length) {
      lines.push('For:');
      for (const q of forQuotes) lines.push(`- "${q.why}" — ${who(q.judgeId)}`);
    }
    if (against.length) {
      lines.push('Against:');
      for (const q of against) lines.push(`- "${q.why}" — ${who(q.judgeId)}`);
    }
    lines.push('');
  }

  const rates = winRateBySource(variantsById, comparisons);
  lines.push('## Win rate by source', '', '| source | wins | total | rate |', '|---|---|---|---|');
  for (const [source, { wins, total }] of Object.entries(rates)) {
    lines.push(`| ${source} | ${wins} | ${total} | ${total ? ((wins / total) * 100).toFixed(0) + '%' : '—'} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export { renderFinalMd, quotesFor, sharpest, winRateBySource, namesFromRoles };
