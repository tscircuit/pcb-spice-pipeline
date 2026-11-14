import test from 'node:test'
import assert from 'node:assert/strict'
import * as root from '../../src'
import * as node from '../../src/adapters'

// The routed compiler/execution entry points and the public board/stimulus helpers.
// (Type-only exports are pinned by `pnpm typecheck` of the consumer tests, not here.)
const ROOT = ['RouteTransientSolver', 'RoutedPipelineSolver', 'stackupFromCircuitJson', 'transmittedBits']
const NODE = ['createNativeSolver', 'loadIbisSources']

test('root entry exports exactly today\'s runtime names, all functions', () => {
  assert.deepEqual(Object.keys(root).sort(), ROOT)
  for (const name of ROOT) assert.equal(typeof (root as Record<string, unknown>)[name], 'function', name)
})

test('/node entry exports exactly today\'s runtime names, all functions', () => {
  assert.deepEqual(Object.keys(node).sort(), NODE)
  for (const name of NODE) assert.equal(typeof (node as Record<string, unknown>)[name], 'function', name)
})
