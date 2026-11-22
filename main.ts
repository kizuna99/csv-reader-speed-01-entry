import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

// Warm-up: exercise every parser path on synthetic text so the JIT tiers the hot loops up
// before the real (cold) cases run. The block mixes plain fields, quoted fields (commas,
// doubled quotes, embedded LF/CR/CRLF), junk after a closing quote, a stray CR, an
// unterminated quote, and short/long rows.
const BLOCK =
  'name,age,note\r\n' +
  '"Smith, John",42,"said ""hi""\nthen left"\n' +
  'plain,7,simple\r\n' +
  '"multi\r\nline",1,"cr\ronly"\n' +
  'junk,"abc"tail,3\n' +
  'stray\rcr,9,9\n' +
  'short,1\n' +
  'long,1,2,3,4\n' +
  '"unterminated,5,6\n' +
  'last,0,""""\n';
const WARM = BLOCK.repeat(6);
for (let i = 0; i < 60; i++) run({ text: WARM, header: i % 2 === 0 });

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
