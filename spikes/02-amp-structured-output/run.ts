import { execute } from '@sourcegraph/amp-sdk';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, 'schema.json'), 'utf8'));
const prompts = JSON.parse(readFileSync(resolve(here, 'prompts.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const SYSTEM_INSTRUCTION = `
You will respond with ONLY a JSON object matching this schema:
${JSON.stringify(schema, null, 2)}

No prose, no markdown fences. The first character of your response must
be '{' and the last must be '}'.
`.trim();

const STRICT_RETRY = `
Your previous response did not parse as valid JSON or did not match the
schema. Respond again with ONLY a JSON object matching the schema. No
prose, no markdown fences. First character '{', last character '}'.
`.trim();

type Trial = {
  prompt: string;
  attempt1_valid: boolean;
  attempt1_errors?: string[];
  attempt2_valid?: boolean;
  attempt2_errors?: string[];
  raw1?: string;
  raw2?: string;
};

async function ampOnce(prompt: string): Promise<string> {
  let result = '';
  for await (const msg of execute({ prompt: `${SYSTEM_INSTRUCTION}\n\n${prompt}` })) {
    if (msg.type === 'result' && !msg.is_error) {
      result = msg.result;
      break;
    }
  }
  return result;
}

function parseAndValidate(raw: string): { ok: boolean; errors: string[] } {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, errors: [`parse: ${(e as Error).message}`] }; }
  const ok = validate(parsed);
  return ok
    ? { ok: true, errors: [] }
    : { ok: false, errors: (validate.errors ?? []).map(e => `${e.instancePath} ${e.message}`) };
}

async function main() {
  if (!process.env.AMP_API_KEY) {
    console.error('AMP_API_KEY not set. Export the key and re-run.');
    process.exit(2);
  }

  const trials: Trial[] = [];

  for (const { prompt } of prompts as Array<{ prompt: string }>) {
    process.stdout.write(`prompt: ${prompt.slice(0, 60)}... `);
    const raw1 = await ampOnce(prompt);
    const r1 = parseAndValidate(raw1);
    const trial: Trial = {
      prompt,
      attempt1_valid: r1.ok,
      attempt1_errors: r1.errors,
      raw1
    };

    if (!r1.ok) {
      const raw2 = await ampOnce(`${prompt}\n\n${STRICT_RETRY}`);
      const r2 = parseAndValidate(raw2);
      trial.attempt2_valid = r2.ok;
      trial.attempt2_errors = r2.errors;
      trial.raw2 = raw2;
    }

    trials.push(trial);
    console.log(r1.ok ? 'PASS' : (trial.attempt2_valid ? 'PASS-RETRY' : 'FAIL'));
  }

  const first = trials.filter(t => t.attempt1_valid).length;
  const retry = trials.filter(t => !t.attempt1_valid && t.attempt2_valid).length;
  const fail  = trials.filter(t => !t.attempt1_valid && !t.attempt2_valid).length;

  console.log(`\n=== Results (n=${trials.length}) ===`);
  console.log(`first-try valid:    ${first} (${(first/trials.length*100).toFixed(0)}%)`);
  console.log(`retry-valid:        ${retry} (${(retry/trials.length*100).toFixed(0)}%)`);
  console.log(`failed both:        ${fail} (${(fail/trials.length*100).toFixed(0)}%)`);

  writeFileSync(resolve(here, 'trials.json'), JSON.stringify(trials, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
