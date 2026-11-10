import assert from 'node:assert/strict'
import { close } from './independent-helpers.mjs'

function exactlyOne(elements, predicate, label) {
  const matches = elements.filter(predicate)
  assert.equal(matches.length, 1, `${label}: exactly one match`)
  return matches[0]
}

// Compare saved copper without importing the geometry generator. Ring order and
// winding may change during normalization; every physical vertex must survive.
export function auditGroundCopper(circuit, modeling, geometry) {
  const reference = selector => exactlyOne(circuit, record => record.type === 'source_port' && (selector.sourcePortId
    ? record.source_port_id === selector.sourcePortId
    : record.source_component_id === exactlyOne(circuit, component => component.type === 'source_component' && component.name === selector.component, 'Reference component').source_component_id &&
      (record.name === selector.port || record.port_hints?.includes(selector.port) || `pin${record.pin_number}` === selector.port)), 'Physical ground reference').source_port_id
  const connected = new Set([reference(modeling.channelReference)])
  const traces = circuit.filter(record => record.type === 'source_trace')
  for (let previous = -1; previous !== connected.size;) {
    previous = connected.size
    for (const trace of traces) {
      const members = [...trace.connected_source_port_ids, ...(trace.connected_source_net_ids ?? [])]
      if (members.some(id => connected.has(id))) members.forEach(id => connected.add(id))
    }
  }
  const ground = exactlyOne(circuit, record => record.type === 'source_net' && record.is_ground && connected.has(record.source_net_id), 'Net-inferred ground')
  const pours = circuit.filter(record => record.type === 'pcb_copper_pour' && connected.has(record.source_net_id))
  assert.ok(pours.length > 0, 'Physical copper on the inferred ground net')
  const ring = points => {
    const tokens = points.map(point => point.map(value => {
      assert.ok(Number.isFinite(value))
      return value.toPrecision(15)
    }).join(','))
    const rotations = values => values.map((_, i) => [...values.slice(i), ...values.slice(0, i)].join(';'))
    return [...rotations(tokens), ...rotations([...tokens].reverse())].sort()[0]
  }
  const polygon = rings => [ring(rings[0]), ...rings.slice(1).map(ring).sort()]
  return geometry.cells.map(cell => {
    const copper = cell.routedCopper
    assert.ok(copper, 'Routed reduction retains actual ground geometry')
    assert.equal(copper.sourceNetId, ground.source_net_id, 'Extracted plane belongs to independently inferred GND net')
    assert.equal(copper.referenceSourcePortIds.length, 2, 'Two physical reference contacts')
    assert.notEqual(copper.referenceSourcePortIds[0], copper.referenceSourcePortIds[1], 'Distinct driver and receiver ground contacts')
    assert.equal(copper.referenceSourcePortIds[0], reference(modeling.channelReference))
    if (modeling.groundReturn) assert.equal(copper.referenceSourcePortIds[1], reference(modeling.groundReturn))
    copper.referenceSourcePortIds.forEach(id => {
      assert.ok(connected.has(id), 'Both reference contacts connect electrically to GND')
      reference({ sourcePortId: id })
    })
    assert.deepEqual(copper.pours.map(pour => pour.pcbCopperPourId).sort(), pours.map(pour => pour.pcb_copper_pour_id).sort(), 'Every net-connected ground pour included')
    for (const pour of copper.pours) {
      const original = exactlyOne(pours, record => record.pcb_copper_pour_id === pour.pcbCopperPourId, 'Original ground pour')
      assert.equal(original.shape, 'brep', 'Ground pour has real polygon geometry')
      assert.equal(pour.layer, original.layer, 'Ground layer preserved')
      const originalRings = [original.brep_shape.outer_ring, ...original.brep_shape.inner_rings].map(ring => ring.vertices.map(point => [point.x, point.y]))
      assert.deepEqual(polygon(pour.polygon), polygon(originalRings), 'Ground boundaries and every cutout preserved')
      const stacks = circuit.filter(record => record.type === 'pcb_stackup')
      assert.equal(stacks.length, 1, 'One physical Circuit JSON stackup')
      const layers = stacks[0].layers.filter(layer => layer.layer_type !== 'soldermask').slice().reverse()
      let z = -layers[0].thickness
      let found = false
      for (const layer of layers) {
        if (layer.layer_type === 'copper' && layer.layer === pour.layer) {
          close(pour.zMinMm, z, 'Ground copper bottom from Circuit JSON stackup')
          close(pour.zMaxMm, z + layer.thickness, 'Ground copper top from Circuit JSON stackup')
          found = true
        }
        z += layer.thickness
      }
      assert.ok(found, 'Ground layer appears in Circuit JSON stackup')
    }
    return { stage: cell.stage, sourceNetId: ground.source_net_id, referenceSourcePortIds: copper.referenceSourcePortIds, groundPourIds: copper.pours.map(pour => pour.pcbCopperPourId), boundariesAndCutoutsPreserved: true }
  })
}
