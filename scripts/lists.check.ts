// Asserts the step-3 getters that replaced the hardcoded lists (food.ts meals + ingredient
// categories, media.ts kinds + goal sources, finance.ts accounts). Run:
//   npx rolldown scripts/lists.check.ts --platform node -f esm -o <tmp>/lc.mjs && node <tmp>/lc.mjs
import assert from 'node:assert/strict'
import { listRows } from './listsFixture'
import { setOptionRows } from '../src/lib/optionStore'
import { categoryLook, defaultMealTypeForNow, ingredientCategories, mealInfo, mealTypes, orderedCategoryKeys, UNCATEGORIZED } from '../src/lib/food'
import { isMediaMetric, mediaInfo, mediaKindOf, mediaKinds, mediaMetricOf, mediaMetrics } from '../src/lib/media'
import { accountInfo, bufferAccounts, periodTotals, savingsAccounts } from '../src/lib/finance'
import { muscleGroups, trackedLifts } from '../src/lib/exercises'
import { balanceRegions } from '../src/lib/training'
import { getSportStyle } from '../src/lib/workouts'
import { goalNudge, ratingInfo } from '../src/lib/checkins'

const at = (h: number) => new Date(2026, 9, 24, h, 30)

// Meals: same order, look and time-of-day default as the old constants.
assert.deepEqual(mealTypes(), ['breakfast', 'lunch', 'dinner', 'snack'])
assert.deepEqual(
  [at(7), at(10), at(14), at(15), at(20), at(21), at(23)].map((d) => defaultMealTypeForNow(d)),
  ['breakfast', 'lunch', 'lunch', 'dinner', 'dinner', 'snack', 'snack'],
)
assert.deepEqual([mealInfo('dinner').accent, mealInfo('dinner').icon, mealInfo('breakfast').ink], ['#a8563f', '🍽', '#8a6321'])
assert.equal(mealInfo('gone').label, 'gone') // an unknown key never crashes

// Ingredient categories: order, exact old looks, custom A–Z then Uncategorised.
assert.equal(ingredientCategories().length, 10)
assert.deepEqual(categoryLook('Protein'), { glyph: '🥩', accent: '#a8563f', tint: '#f6ebe4' })
assert.deepEqual(categoryLook(UNCATEGORIZED), { glyph: '🧂', tint: '#efe9dc', accent: '#8b8577' })
assert.equal(categoryLook('Baljväxter').glyph, '🏷')
assert.deepEqual(orderedCategoryKeys([UNCATEGORIZED, 'Baljväxter', 'Dairy', 'Protein']), ['Protein', 'Dairy', 'Baljväxter', UNCATEGORIZED])

// Media: kinds and goal sources; the four old metric names still resolve, new kinds get media:<key>.
assert.deepEqual(mediaKinds().map((k) => k.key), ['book', 'game', 'movie', 'series'])
assert.deepEqual(mediaMetrics(), ['books_finished', 'games_finished', 'movies_finished', 'series_finished'])
assert.equal(mediaKindOf('books_finished'), 'book')
assert.equal(mediaInfo('book').plural, 'Books')
assert.ok(isMediaMetric('media:podcast') && !isMediaMetric('steps'))

// Accounts: same order, buffers in fill order.
assert.deepEqual(savingsAccounts().map((a) => a.key), ['buffer', 'car_buffer', 'travel_buffer', 'investments', 'mortgage'])
assert.deepEqual(bufferAccounts(), ['buffer', 'car_buffer', 'travel_buffer'])
assert.equal(accountInfo('investments').label, 'ETF & stocks')

// After editing: a new kind shows up with its own goal source; an archived account still names
// its old entries and still counts in totals, but no longer fills from bank savings.
setOptionRows([
  ...listRows.map((r) => (r.kind === 'savings_account' && r.key === 'car_buffer' ? { ...r, archived_at: '2026-10-24T10:00:00Z' } : r)),
  { ...listRows[0], id: 'new', kind: 'media_kind', key: 'media_kind_ab12cd34', label: 'Podcast', icon: '🎧', position: 4, meta: { plural: 'Podcasts' } },
])
assert.equal(mediaMetricOf('media_kind_ab12cd34'), 'media:media_kind_ab12cd34')
assert.equal(mediaKindOf('media:media_kind_ab12cd34'), 'media_kind_ab12cd34')
assert.deepEqual(bufferAccounts(), ['buffer', 'travel_buffer'])
assert.equal(accountInfo('car_buffer').label, 'Car buffer')
const t = periodTotals([{ date: '2026-10-01', account: 'car_buffer', amount: 500 }, { date: '2026-10-01', account: 'buffer', amount: 1000 }], '2026-10-01', '2026-10-31')
assert.equal(t.net, 1500)
assert.equal(t.byAccount.car_buffer, 500)

console.log('lists.check ok')

// Step 4b lists (migration 0051): same order/values as the old constants.
setOptionRows(listRows)
assert.deepEqual(muscleGroups().length, 13)
assert.deepEqual(balanceRegions().map((r) => [r.label, r.muscles.length]), [['Back', 2], ['Chest', 1], ['Shoulders', 1], ['Arms', 3], ['Legs', 4], ['Core', 2]])
assert.deepEqual(trackedLifts().map((l) => l.exercise), ['Squat', 'Bench press', 'Deadlift', 'Military press (overhead press)'])
assert.equal(trackedLifts()[3].label, 'Overhead press')
assert.deepEqual(getSportStyle('Ride'), { label: 'Ride', icon: '🚴', color: '#e6b39f' }) // what the chart drew
assert.deepEqual(getSportStyle('Kitesurf'), { label: 'Kitesurf', icon: '🏅', color: '#a09a8c' }) // unknown → neutral
assert.deepEqual([ratingInfo('stuck').label, ratingInfo('stuck').color, ratingInfo('done').color], ['Stuck', '#a33327', null])
assert.equal(goalNudge('steps'), 'A single longer walk most days covers it.')
assert.equal(goalNudge('savings'), null)
console.log('lists.check 4b ok')
