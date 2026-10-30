import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeDdrTimeout } from './fixtures/native-ddr-timeout.js'

const board = { width: 100, height: 68 }

test('DDR ground-region reproduction keeps its physical channels and board unchanged', async () => {
  const local = await nativeDdrTimeout({ board, ground: { width: 22, height: 14 } })
  const wide = await nativeDdrTimeout({ board, ground: { width: 96, height: 64 } })
  for (const { records } of [local, wide])
    assert.deepEqual(records.filter(r => r.type.endsWith('_error')), [])

  const physicalRoutes = (records: typeof local.records) => records
    .filter(r => r.type === 'pcb_trace' || r.type === 'pcb_via')
    .map(r => r.type === 'pcb_trace' ? { type: r.type, route: r.route } : {
      type: r.type, x: r.x, y: r.y, layers: r.layers, outer_diameter: r.outer_diameter, hole_diameter: r.hole_diameter,
    })
  assert.deepEqual(physicalRoutes(wide.records), physicalRoutes(local.records))
  const withoutPourOrWarnings = (records: typeof local.records) => records.filter(r =>
    r.type !== 'pcb_copper_pour' && !r.type.endsWith('_warning'))
  assert.deepEqual(withoutPourOrWarnings(wide.records), withoutPourOrWarnings(local.records))
  const pour = (records: typeof local.records) => records.find(r => r.type === 'pcb_copper_pour')
  assert.notDeepEqual(pour(wide.records), pour(local.records))
  assert.match(local.deck, /meshMm=1.5/)
  assert.match(wide.deck, /meshMm=1.5/)
  const groundEdges = (deck: string) => (deck.match(/^Eg\d+_\d+ /gm) ?? []).length
  const localEdges = groundEdges(local.deck), wideEdges = groundEdges(wide.deck)
  assert.ok(localEdges > 0)
  assert.ok(wideEdges > 0)
  console.log(`Refined ground edges: local ${localEdges}, board-sized ${wideEdges}`)
})
