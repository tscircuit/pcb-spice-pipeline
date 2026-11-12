import test from 'node:test'
import assert from 'node:assert/strict'
import Differential from '../../../examples/level1-differential/level1-differential'
import { renderCoreSignals } from '../../support/core-render'
import { prepareBlocks } from '../../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../../src/board'
import { circuitNodes } from '../../../src/simulation'
import { readFile } from 'node:fs/promises'
import { joinSeriesMappings } from '../../../src/board/geometry/series'

test('manual real-footprint differential pair joins termination tails and retains RX taps', async () => {
  const tree = Differential()
  assert.equal(tree.props.routeRemaining, false)
  const circuit = await renderCoreSignals(tree)
  const ibis = await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/sn65hvd72.ibs`)
  const prepared = prepareBlocks(circuit, { 'models/sn65hvd72.ibs': ibis })[0]
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  assert.equal(geometry.mappings.length, 2)
  for (const mapping of geometry.mappings) {
    assert.equal(mapping.sourceTraceIds?.length, 2)
    assert.equal(mapping.intermediatePorts?.length, 1)
    assert.ok(mapping.intermediatePorts![0].fraction > .9 && mapping.intermediatePorts![0].fraction < 1)
  }
  const nodes = circuitNodes(prepared.circuit, geometry, prepared.settings)
  for (const mapping of geometry.mappings) assert.ok(![nodes.node(mapping.from), nodes.node(mapping.to)].includes(nodes.node(mapping.intermediatePorts![0].sourcePortId)))
  assert.throws(() => joinSeriesMappings([...geometry.mappings, { ...geometry.mappings[0], to: 'extra' }, { ...geometry.mappings[0], to: 'extra2' }]), /Branched/)
})
