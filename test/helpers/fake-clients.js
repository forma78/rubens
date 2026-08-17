/* Fake Anthropic/xAI/OpenAI clients for exercising the real (non-mocked)
   code path in round.js and run.js — request building, response parsing,
   cost tracking — with no network call, no API key, and no spend. Shared
   by round.test.js and run.test.js. */

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

function makeFakeAnthropicClient() {
  const batches = new Map();
  let batchCounter = 0;
  return {
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
}

function chatCompletionsCreate({ proposePatch, judgeVerdict }) {
  return async (params) => {
    const system = params.messages.find(m => m.role === 'system')?.content ?? '';
    const body = isJudgeCall(system) ? judgeVerdict : proposePatch;
    return { choices: [{ message: { content: JSON.stringify(body) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'c' };
  };
}

function makeFakeXaiClient() {
  return {
    chat: {
      completions: {
        create: chatCompletionsCreate({
          proposePatch: { patch: { scatter: 15 }, intent: 'Loosen it.' },
          judgeVerdict: { winner: 'A', why: 'Reads bolder.' },
        }),
      },
    },
  };
}

/** OpenAI's batch path is file-based: upload a .jsonl of requests, create a
 *  batch pointed at that file's id, download a .jsonl of results once
 *  status is 'completed'. This fake mirrors that shape closely enough for
 *  vendors/openai.js's submit/poll/fetch functions to run unmodified
 *  against it — see test/vendors-openai.test.js for the isolated version. */
function makeFakeOpenaiClient() {
  const files = new Map();
  const batches = new Map();
  let fileCounter = 0, batchCounter = 0;
  return {
    chat: {
      completions: {
        create: chatCompletionsCreate({
          proposePatch: { patch: { grain: 40 }, intent: 'Add texture.' },
          judgeVerdict: { winner: 'A', why: 'Feels more deliberate.' },
        }),
      },
    },
    files: {
      create: async ({ file }) => {
        const id = `file_${fileCounter++}`;
        files.set(id, await file.text());
        return { id };
      },
      content: async (fileId) => {
        const lines = files.get(fileId).trim().split('\n').map(l => JSON.parse(l));
        const outLines = lines.map((l, i) => {
          const winner = i % 2 === 0 ? 'A' : 'B';
          return JSON.stringify({
            custom_id: l.custom_id,
            response: { status_code: 200, body: { id: 'r_' + l.custom_id, choices: [{ message: { content: JSON.stringify({ winner, why: `Prefers ${winner} here.` }) } }], usage: { prompt_tokens: 40, completion_tokens: 8 } } },
          });
        });
        return { text: async () => outLines.join('\n') + '\n' };
      },
    },
    batches: {
      create: async ({ input_file_id }) => {
        const id = `batch_${batchCounter++}`;
        batches.set(id, { id, input_file_id, status: 'completed', output_file_id: input_file_id });
        return batches.get(id);
      },
      retrieve: async (id) => batches.get(id),
    },
  };
}

function makeFakeClients() {
  return { anthropic: makeFakeAnthropicClient(), xai: makeFakeXaiClient(), openai: makeFakeOpenaiClient() };
}

export { makeFakeClients, textMessage, isJudgeCall };
