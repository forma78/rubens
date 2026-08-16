/* Fake Anthropic/xAI clients for exercising the real (non-mocked) code path
   in round.js and run.js — request building, response parsing, cost
   tracking — with no network call, no API key, and no spend. Shared by
   round.test.js and run.test.js. */

function textMessage(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 20 }, id: 'msg' };
}

// prompts.js's generatorSystemPrompt always contains "Return a patch"; its
// judgeSystemPrompt always contains "Pick the one you prefer" — inspecting
// the request content (rather than counting calls) is what a real vendor
// would receive, so it's a reliable way for the fake to tell which kind of
// call it's answering, in whatever order propose/judge calls interleave.
function isJudgeCall(systemText) {
  return /Pick the one you prefer/.test(systemText);
}

function makeFakeClients() {
  const batches = new Map();
  let batchCounter = 0;
  const anthropicClient = {
    messages: {
      create: async (params) => {
        if (isJudgeCall(params.system)) return textMessage({ winner: 'A', why: 'Reads bolder here.' });
        return textMessage({ patch: { cols: 8 + Math.floor(Math.random() * 3) }, intent: 'Tighten it.' });
      },
    },
    beta: {
      messages: {
        batches: {
          create: async ({ requests }) => {
            const id = `batch_${batchCounter++}`;
            // deterministic-ish verdict: alternate A/B by custom_id parity
            const results = requests.map((r) => {
              const n = Number(r.custom_id.replace(/\D/g, '')) || 0;
              const winner = n % 2 === 0 ? 'A' : 'B';
              return { custom_id: r.custom_id, result: { type: 'succeeded', message: textMessage({ winner, why: `Prefers ${winner} here.` }) } };
            });
            batches.set(id, results);
            return { id, processing_status: 'ended' };
          },
          retrieve: async (id) => ({ id, processing_status: 'ended' }),
          results: async (id) => (async function* () { for (const r of batches.get(id)) yield r; })(),
        },
      },
    },
  };
  const xaiClient = {
    chat: {
      completions: {
        create: async (params) => {
          const system = params.messages.find(m => m.role === 'system')?.content ?? '';
          if (isJudgeCall(system)) {
            return { choices: [{ message: { content: JSON.stringify({ winner: 'A', why: 'Reads bolder.' }) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'c' };
          }
          return { choices: [{ message: { content: JSON.stringify({ patch: { scatter: 15 }, intent: 'Loosen it.' }) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'c' };
        },
      },
    },
  };
  return { anthropic: anthropicClient, xai: xaiClient };
}

export { makeFakeClients, textMessage, isJudgeCall };
