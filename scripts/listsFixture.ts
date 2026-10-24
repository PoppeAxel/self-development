// Loads the step-3 lists (meal types, ingredient categories, media kinds, savings accounts) into
// optionStore, exactly as migration 0049 seeded them — check scripts import this first.
import { setOptionRows } from '../src/lib/optionStore'
import type { OptionRow } from '../src/lib/editable'
import fixture from './lists.fixture.json'

export const listRows = (fixture as Omit<OptionRow, 'id' | 'archived_at'>[]).map((r, i) => ({ archived_at: null, ...r, id: 'l' + i }) as OptionRow)
setOptionRows(listRows)
