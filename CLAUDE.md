# Working notes for Claude Code

Read `docs/SPEC.md` before writing anything. It is the contract. This file is
how to work in this repository, not what to build.

## Ground rules

**The generator's geometry is frozen.** `generator/index.html` contains a
deformation model that was derived by hand over many sessions: convex clipping
into panels, per-edge offsets, the Gaussian drape field, the rounded outline.
When extracting it into `src/engine/`, move it **byte for byte**. Do not
refactor it, do not rename its variables, do not "improve" the maths. The only
permitted changes are removing DOM access and adding `export`.

If you believe you found a bug in the geometry, stop and say so. Do not fix it.

**One source of truth.** After extraction, the browser and the command line
must run the same functions from `src/engine/`. If a change makes them diverge,
the change is wrong. There is a test for this; keep it green.

**Determinism is a feature.** Same state plus same seeds must produce a
byte-identical SVG, on any machine, on any run. Never call `Math.random()`
inside the engine — the seeded hash `h3` and the xorshift `mk` are there for
this. A run that cannot be reproduced cannot be published, and publishing the
runs is the entire point of the project.

**Never invent numbers into the record.** Anything written to `runs/` or to the
database must have actually happened: a real API response, a real render. No
placeholder verdicts, no synthetic scores while a provider is down, no
back-filling a missing judge. If a call fails, record the failure.

## Style

Plain ES modules, Node 20+, no TypeScript, no bundler, no framework in the
engine or the runner. The generator must keep working as a single file opened
from disk. Dependencies are a cost — the current count is four, and each new
one needs a reason in the pull request.

Small commits with a real message. `runs/` is committed; it is the evidence.

## Costs are real

Every model call spends the owner's money. Before adding a call to a loop, work
out how many times the loop runs. The runner has a hard spend cap; respect it,
never raise it to make a test pass. Test on two variants and one judge, not on
a full shift.

## When something is ambiguous

Ask. This repository belongs to an artist, not a software team — a wrong
assumption implemented cleanly is worse than a question.
