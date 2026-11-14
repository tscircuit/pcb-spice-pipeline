// One minimal trigger per board diagnostic code not already exercised by the other board tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRouteVias, selectPort, subcircuitTree, type PcbTrace, type SubcircuitTree } from '../../src/board'

/** Asserts `f` throws a board diagnostic with `code`, and optionally a message matching `message`. */
const rejects = (f: () => unknown, code: string, message?: RegExp): void => assert.throws(f, (e: { code?: string; message: string }) => {
  assert.equal(e.code, code)
  if (message) assert.match(e.message, message)
  return true
})

test('port selection and routed primitive type failures', () => {
  rejects(() => selectPort([], { component: 'missing', port: '1' }), 'pin_mapping', /missing: expected one source component, got 0/)
  const trace = { type: 'pcb_trace', pcb_trace_id: 't0', route: [{ route_type: 'through_pad' }] } as unknown as PcbTrace
  rejects(() => resolveRouteVias([], trace), 'route_type', /Only wire\/via routed primitives supported/)
})

test('subcircuit ownership cycles', () => {
  /** Builds a tree whose two source groups own each other, which must be rejected. */
  const tree = (): SubcircuitTree => subcircuitTree([{ type: 'source_group', source_group_id: 'a', subcircuit_id: 'sa', parent_source_group_id: 'b' }, { type: 'source_group', source_group_id: 'b', parent_source_group_id: 'a' }])
  rejects(tree, 'simulation_scope', /Cyclic source-group ownership/)
})
