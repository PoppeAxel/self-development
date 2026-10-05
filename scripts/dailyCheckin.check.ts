// Asserts src/lib/dailyCheckin.ts. Run:
//   npx rolldown scripts/dailyCheckin.check.ts --platform node -f esm -o <tmp>/dc.mjs && node <tmp>/dc.mjs
import assert from 'node:assert/strict'
import { descriptor, headline, sortMoments, type Moment } from '../src/lib/dailyCheckin'

assert.equal(descriptor('body', 1), 'Beat up')
assert.equal(descriptor('body', 4), 'Below par')
assert.equal(descriptor('body', 6), 'Okay')
assert.equal(descriptor('body', 8), 'Good')
assert.equal(descriptor('body', 9), 'Fresh')

const day = (o: Partial<Record<string, number | null>>) => ({ mood: 6, energy: 6, calm: 6, focus: 6, connection: 6, body: 6, ...o })
const week = [day({}), day({})]
assert.equal(headline(day({}), []), null)
assert.equal(headline(day({ mood: 6.3 }), week), 'A pretty typical day — right on your weekly average.')
assert.equal(headline(day({ mood: 8 }), week), 'Mood stood out — above your week.')
assert.equal(headline(day({ mood: 8, body: 3 }), week), 'Mood was up, Body dipped.')
assert.equal(headline(day({ body: 3 }), week), 'Body dipped below your week.')
assert.equal(headline(day({ mood: null, energy: 9 }), week), 'Energy stood out — above your week.')

const m = (time: string | null, title: string): Moment => ({ source: 'task', sourceId: title, time, icon: '', title, meta: '' })
assert.deepEqual(sortMoments([m(null, 'steps'), m('18:10', 'b'), m('07:05', 'a')]).map((x) => x.title), ['a', 'b', 'steps'])

console.log('dailyCheckin.check: ok')
