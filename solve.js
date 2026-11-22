// A fast drop-in for csv-reader 1.0.0 (make.fun's reference CSV reader).
//
// run(input) returns exactly csv-reader 1.0.0's answer for every input {text, header}: {columns, rows, errors},
// under csv-reader's broken-row policy:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is one quote, and
//     each CRLF or lone CR inside it is read as LF); what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when anything was appended); a quote that never closes is a
//     literal character and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line its record starts on (every LF,
//     CRLF and lone CR inside a quoted field counted), row its record's index in rows (null for the header).
//
// How it is fast: one left-to-right pass over the text. Unquoted fields are scanned by char code and taken as a
// single slice; quoted fields jump with indexOf to their closing quote and are taken as a single slice whenever
// they hold no doubled quote and no CR. The broken-row paths (stray CRs, doubled quotes, CRs inside quotes,
// junk after a closing quote, unterminated quotes) are read by general segment readers that run only when met.
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, computed faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value and how it ended (COMMA, BREAK or END).
  let fValue = '';
  let fEnded = END;

  // Reads unquoted characters from pos onto `value`, up to the next comma or line break: a CR not followed by
  // LF is dropped (stray_cr). Sets fValue and fEnded, advances pos and line, and returns how many characters
  // were kept (the caller of a quote's junk tail needs it for quote_junk). General path: runs for junk tails,
  // unterminated re-reads, and fields that hold a stray CR.
  function readUnquotedOnto(value) {
    let out = value;
    let added = 0;
    let segStart = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        out += text.slice(segStart, pos);
        added += pos - segStart;
        pos += 1;
        fValue = out;
        fEnded = COMMA;
        return added;
      }
      if (c === 10) {
        out += text.slice(segStart, pos);
        added += pos - segStart;
        pos += 1;
        line += 1;
        fValue = out;
        fEnded = BREAK;
        return added;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          out += text.slice(segStart, pos);
          added += pos - segStart;
          pos += 2;
          line += 1;
          fValue = out;
          fEnded = BREAK;
          return added;
        }
        out += text.slice(segStart, pos);
        added += pos - segStart;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    out += text.slice(segStart, pos);
    added += pos - segStart;
    fValue = out;
    fEnded = END;
    return added;
  }

  // What follows a quoted field's closing quote (pos is just past it): a comma, a line break, the end of the
  // text, or junk appended as it stands up to the next comma or line break (quote_junk when anything is kept).
  function afterClose() {
    if (pos >= n) {
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = BREAK;
      return;
    }
    const added = readUnquotedOnto(fValue);
    if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Reads a quoted field whose opening quote is at `open`, by segments between the specials (a quote or a CR):
  // "" is one quote, each CRLF or lone CR is one LF and one line. Runs when the fast path cannot: a doubled
  // quote, a CR inside the field, or no closing quote at all. Every scan stays inside the current segment:
  // the next quote bounds it, and the segment is walked once for a CR and its LFs.
  function readQuotedGeneral(open, openLine) {
    let i = open + 1;
    let segStart = i;
    let out = '';
    let lineDelta = 0;
    for (;;) {
      if (i >= n) break;
      const q = text.indexOf('"', i);
      if (q === -1) break; // no quote left: the field never closes, whatever CRs remain are discarded with it
      let r = -1;
      let lf = 0;
      let lfBeforeR = 0;
      for (let k = segStart; k < q; k++) {
        const c = text.charCodeAt(k);
        if (c === 13) {
          r = k;
          lfBeforeR = lf;
          break;
        }
        if (c === 10) lf += 1;
      }
      if (r !== -1) {
        // A CR inside quotes is read as one LF and counts one line; a CRLF is consumed whole.
        out += text.slice(segStart, r);
        out += '\n';
        lineDelta += lfBeforeR + 1;
        i = r + (text.charCodeAt(r + 1) === 10 ? 2 : 1);
        segStart = i;
        continue;
      }
      lineDelta += lf;
      if (text.charCodeAt(q + 1) === 34) {
        out += text.slice(segStart, q);
        out += '"';
        i = q + 2;
        segStart = i;
        continue;
      }
      // The closing quote.
      out += text.slice(segStart, q);
      fValue = out;
      line += lineDelta;
      pos = q + 1;
      afterClose();
      return;
    }
    // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    readUnquotedOnto('"');
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Fast path: the next quote closes the field and is not doubled, and the segment up to it holds no CR, so
    // the value is one slice; the segment walk counts its LFs on the way to checking for a CR.
    const q = text.indexOf('"', open + 1);
    if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
      let lf = 0;
      let hasCR = false;
      for (let k = open + 1; k < q; k++) {
        const c = text.charCodeAt(k);
        if (c === 13) {
          hasCR = true;
          break;
        }
        if (c === 10) lf += 1;
      }
      if (!hasCR) {
        fValue = text.slice(open + 1, q);
        line += lf;
        pos = q + 1;
        afterClose();
        return;
      }
    }
    readQuotedGeneral(open, openLine);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        readQuoted();
      } else {
        lastQuoted = false;
        // Unquoted field: scan to the first comma, LF or CR and take one slice. A CR that is not a CRLF is a
        // stray CR somewhere in the field: the general reader re-reads the field, dropping it.
        const start = pos;
        let i = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c <= 44 && (c === 44 || c === 10 || c === 13)) break;
          i += 1;
        }
        if (i >= n) {
          fValue = text.slice(start, n);
          fEnded = END;
          pos = n;
        } else {
          const c = text.charCodeAt(i);
          if (c === 44) {
            fValue = text.slice(start, i);
            fEnded = COMMA;
            pos = i + 1;
          } else if (c === 10) {
            fValue = text.slice(start, i);
            fEnded = BREAK;
            pos = i + 1;
            line += 1;
          } else if (text.charCodeAt(i + 1) === 10) {
            fValue = text.slice(start, i);
            fEnded = BREAK;
            pos = i + 2;
            line += 1;
          } else {
            pos = start;
            readUnquotedOnto('');
          }
        }
      }
      fields.push(fValue);
      if (fEnded !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
