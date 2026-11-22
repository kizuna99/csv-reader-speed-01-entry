![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kizuna99/csv-reader-speed-01-entry/rank.svg)
![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kizuna99/csv-reader-speed-01-entry/reward.svg)

# Slice-scan CSV reader — csv-reader 1.0.0's answers, several times faster

An entry for [csv-reader-speed-01-run-20261121 on make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121):
read broken CSV files faster — a drop-in for make.fun's own csv-reader 1.0.0 that returns its exact answer
(`{columns, rows, errors}`) for every case, broken rows and all, in a fraction of its CPU time.

## How it works

`solve.js` is a dependency-free ES module whose `run(input)` re-implements csv-reader 1.0.0's reading policy
exactly — BOM dropped, records at LF/CRLF, stray CRs dropped with `stray_cr`, quoted fields with `""` escapes
and CRs read as LF, junk after a closing quote appended (`quote_junk`), unterminated quotes re-read as
unquoted (`unterminated_quote`), rows padded or cut to the first record's width (`short_row` / `long_row`) —
in one left-to-right pass built for speed:

- unquoted fields are scanned by char code and taken as a single `slice`;
- quoted fields jump with `indexOf` to their closing quote and are one slice whenever they hold no doubled
  quote and no CR;
- the broken-row paths run on general segment readers that only execute when met, so the common clean field
  never pays for them.

`main.ts` is the harness driver (the house baseline's own): it reads `/input/cases.json`, answers each case
with `run`, and writes `/output/answers.json`, with V8's incremental marking off.

## Layout

- `main.ts` — the program the harness runs (`node /bot/main.ts`, Node 22)
- `solve.js` — the reader itself
- `LICENSE` — MIT

No dependencies, no build step, no WebAssembly, no native code.
