import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedSlice, snapshotSlices, restoreSlices } from '../../src/extraction/cache'

test('cached field solutions are isolated from caller mutation', () => {
  const slice = {conductors:[{id:'s',group:0,xMin:0,xMax:1,zMin:1,zMax:1.035,conductivitySm:5.8e7},{id:'g',group:-1,xMin:-10,xMax:10,zMin:-.035,zMax:0,conductivitySm:5.8e7}],dielectrics:[]}
  const first = cachedSlice('vacuum-cache-test',slice,()=>{})
  const value = first.C[0][0]
  first.C[0][0] = -1
  assert.equal(cachedSlice('vacuum-cache-test',slice,()=>{}).C[0][0],value)
  const entry = snapshotSlices().find(([hash])=>hash==='vacuum-cache-test')!
  entry[0] = 'restored-vacuum-cache-test'
  restoreSlices([entry])
  entry[1].C[0][0] = -2
  assert.equal(cachedSlice(entry[0],slice,()=>{}).C[0][0],value)
  const old = snapshotSlices().find(([hash]) => hash === 'vacuum-cache-test')!
  delete old[1].surfaces
  assert.throws(() => restoreSlices([old]), { code: 'loss_fit' })
  const invalid = structuredClone(entry)
  invalid[1].steps = []
  assert.throws(()=>restoreSlices([invalid]),{code:'mesh_convergence'})
})
