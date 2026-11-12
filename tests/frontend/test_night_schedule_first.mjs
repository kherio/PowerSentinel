// tests/frontend/test_night_schedule_first.mjs
//
// The night event's start/end times (group 'horario') must be the FIRST
// thing in the event card - before the template picker and the apps
// settings - not buried after them. They are rendered by their own
// block at the top of the card body, and excluded from the "other
// fields" block so they are not shown twice.
import fs from 'node:fs';
import { assertEq } from './lib/harness.mjs';

export async function runTests() {
  const src = fs.readFileSync(new URL('../../frontend/src/views/config.js', import.meta.url), 'utf8');
  const idx = (needle) => src.indexOf(needle);

  assertEq(true, idx("const TIME_GROUP_DEFS = FIELD_DEFS.filter((d) => d.group === 'horario');") > 0, 'existe el bloque de horario propio');
  assertEq(true, src.includes("d.group !== 'apps' && d.group !== 'horario'"), 'el horario no se repite en el resto de ajustes');

  const timeDivAppended = idx('body.appendChild(timeDiv);');
  assertEq(true, timeDivAppended > 0, 'el contenedor del horario se anade al cuerpo');
  assertEq(true, timeDivAppended < idx('body.appendChild(presetRow);'), 'el horario va ANTES del selector de plantilla');
  assertEq(true, timeDivAppended < idx('body.appendChild(fieldsDiv);'), 'y antes de los ajustes de apps');
  assertEq(true, idx('renderFieldsForm(timeDiv, block.fields, TIME_GROUP_DEFS') > 0, 'y se rellena con sus campos');
}
