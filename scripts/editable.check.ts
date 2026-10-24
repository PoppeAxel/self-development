// Asserts src/lib/editable.ts. Run:
//   npx rolldown scripts/editable.check.ts --platform node -f esm -o <tmp>/ec.mjs && node <tmp>/ec.mjs
import assert from 'node:assert/strict'
import { byPosition, copyName, moveItem, nameProblem, renumber } from '../src/lib/editable'

assert.equal(nameProblem('Work', ['Health']), null)
assert.equal(nameProblem('  ', []), 'Give it a name.')
assert.equal(nameProblem(' work ', ['Work']), 'That name is already used.')
assert.match(nameProblem('x'.repeat(31), [])!, /under 30/)

assert.equal(copyName('Work', ['Work']), 'Work 2')
assert.equal(copyName('Work', ['Work', 'work 2']), 'Work 3')
assert.equal(copyName('Work 2', ['Work', 'Work 2']), 'Work 3')

const list = [
  { id: 'a', position: 0, name: 'A' },
  { id: 'b', position: 1, name: 'B' },
  { id: 'c', position: 2, name: 'C' },
]
assert.deepEqual(moveItem(list, 'b', -1).map((x) => x.id), ['b', 'a', 'c'])
assert.equal(moveItem(list, 'a', -1), list)
assert.equal(moveItem(list, 'c', 1), list)

const { list: re, changed } = renumber(moveItem(list, 'c', -1))
assert.deepEqual(re.map((x) => [x.id, x.position]), [['a', 0], ['c', 1], ['b', 2]])
assert.deepEqual(changed.map((x) => x.id), ['c', 'b'])

// Ties (every legacy row at 0) fall back to name.
assert.deepEqual([{ position: 0, name: 'Work' }, { position: 0, name: 'Health' }].sort(byPosition).map((x) => x.name), ['Health', 'Work'])

console.log('editable.check ok')
