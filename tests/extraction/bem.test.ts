import test from 'node:test'
import assert from 'node:assert/strict'
import { solveCrossSection, solve, mu0, epsilon0, matrixResidual } from '../../src/extraction'
import type { CrossSection } from '../../src/board'

/** Finite physical microstrip fixture; thin metal approaches the published zero-thickness oracle. */
const microstrip = (): CrossSection => ({ conductors: [
  { id: 'signal', group: 0, xMin: -.5, xMax: .5, zMin: 1, zMax: 1.001, conductivitySm: 5.8e7 },
  { id: 'ground', group: -1, xMin: -20, xMax: 20, zMin: -.035, zMax: 0, conductivitySm: 5.8e7 },
], dielectrics: [{ xMin: -20, xMax: 20, zMin: 0, zMax: 1, er: 4, lossTangent: 0 }] })

test('2D microstrip independently matches Hammerstad–Jensen within 2%, with logged automatic convergence', () => {
  // E. Hammerstad & O. Jensen, Accurate Models for Microstrip Computer-Aided Design, MTT-S 1980.
  // Qucs technical manual eqs. 11.4–11.7, https://qucs.sourceforge.net/tech/node75.html
  const u = 1
  const er = 4
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + .432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7
  const b = .564 * ((er - .9) / (er + 3)) ** .053
  const ee = (er + 1) / 2 + (er - 1) / 2 * (1 + 10 / u) ** (-a * b)
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / u) ** .7528))
  const z = 60 * Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2)) / Math.sqrt(ee)
  const result = solveCrossSection(microstrip())
  const actualZ = Math.sqrt(mu0 * epsilon0 / (result.C[0][0] * result.C0[0][0]))
  assert.ok(Math.abs(actualZ / z - 1) < .02, `${actualZ} vs ${z}`)
  assert.ok(Math.abs(result.C[0][0] / result.C0[0][0] / ee - 1) < .02)
  assert.ok(result.steps.at(-1)!.residual! < .005)
  assert.ok(result.surface[0][0] > 0)
})
test('every matrix entry is checked, so small mutual changes cannot hide behind large diagonals', () => {
  assert.ok(matrixResidual([[100, -.001], [-.001, 100]], [[100, -.002], [-.002, 100]]) > .4)
  assert.equal(matrixResidual([[1,1e-25],[1e-25,1]], [[1,2e-25],[2e-25,1]]), .5)
  assert.equal(matrixResidual([[1e-25]], [[0]]), 1)
  assert.equal(matrixResidual([[0]], [[0]]), 0)
  assert.throws(() => solve([[0]], [[1]]), { code: 'matrix_singular' })
})

import { coupledMicrostrip, coupledStripline } from './closed-form'
/** A physical thin-metal stripline or microstrip pair; dimensions are millimetres. */
function coupledFixture(stripline: boolean): CrossSection {
  const signal = {zMin:1,zMax:1.001,conductivitySm:5.8e7}
  const ground = {group:-1,xMin:-20,xMax:20,conductivitySm:5.8e7}
  return {conductors:[
    {id:'a',group:0,xMin:-1.25,xMax:-.25,...signal},
    {id:'b',group:1,xMin:.25,xMax:1.25,...signal},
    {id:'lower',...ground,zMin:-.035,zMax:0},
    ...(stripline?[{id:'upper',...ground,zMin:2,zMax:2.035}]:[]),
  ],dielectrics:[{xMin:-20,xMax:20,zMin:0,zMax:stripline?2:1,er:4,lossTangent:0}]}
}
for (const stripline of [false,true]) test(`coupled ${stripline?'stripline':'microstrip'} independently matches published modes, L12 and C12 within 2%`,()=>{
  const oracle = stripline?coupledStripline(1,.5,2,4):coupledMicrostrip(1,.5,4)
  const result = solveCrossSection(coupledFixture(stripline))
  const C = result.C
  const C0 = result.C0
  const ze = Math.sqrt(mu0*epsilon0/((C[0][0]+C[0][1])*(C0[0][0]+C0[0][1])))
  const zo = Math.sqrt(mu0*epsilon0/((C[0][0]-C[0][1])*(C0[0][0]-C0[0][1])))
  const inverse = solve(C0,[[1,0],[0,1]])
  const measured = {ze,zo,l12:mu0*epsilon0*inverse[0][1],c12:C[0][1]}
  for (const key of ['ze','zo','l12','c12'] as const) assert.ok(Math.abs(measured[key]/oracle[key]-1)<.02,`${key}: ${measured[key]} vs ${oracle[key]}`)
  if (stripline) assert.ok(Math.abs((C[0][0]+C[0][1])/(C0[0][0]+C0[0][1])/4-1)<.02)
  else {
    assert.ok(Math.abs((C[0][0]+C[0][1])/(C0[0][0]+C0[0][1])/(oracle as ReturnType<typeof coupledMicrostrip>).ee-1)<.02)
    assert.ok(Math.abs((C[0][0]-C[0][1])/(C0[0][0]-C0[0][1])/(oracle as ReturnType<typeof coupledMicrostrip>).eo-1)<.02)
  }
})
test('isolated stripline matches Wheeler thin-strip limit within 2%',()=>{
  // Wheeler's thin-strip engineering equation: Z = 30*pi / (sqrt(er)*(w/b + 2*ln(2)/pi)).
  // H. A. Wheeler, IEEE MTT-13 (1965), 172–185; w/b=.5 is in the broad-strip regime.
  const fixture = coupledFixture(true)
  fixture.conductors = fixture.conductors.filter(c=>c.group!==1).map(c=>c.group===0?{...c,xMin:-.5,xMax:.5}:c)
  const r = solveCrossSection(fixture)
  const z = Math.sqrt(mu0*epsilon0/(r.C[0][0]*r.C0[0][0]))
  const expected = 30*Math.PI/(2*(.5+2*Math.log(2)/Math.PI))
  assert.ok(Math.abs(z/expected-1)<.02,`${z} vs ${expected}`)
  assert.ok(Math.abs(r.C[0][0]/r.C0[0][0]/4-1)<.02)
})

test('supported actual TSX slice logs entry-wise convergence', async () => {
  const { reviewBoard } = await import('../fixtures/review-geometry')
  const { geometryFromCircuitJson } = await import('../../src/board')
  const { circuitJson, modeling } = await reviewBoard()
  const slice = geometryFromCircuitJson(circuitJson, modeling).cells[0].slice!
  const result = solveCrossSection(slice)
  assert.ok(result.steps.at(-1)!.residual! < .005)
  for (const value of Object.values(result.steps.at(-1)!.entries!)) assert.ok(value < .005)
})

test('FR4 and solder-mask layers approach series-dielectric capacitance and loss within 2%', () => {
  // Parallel-plate energy: C'=epsilon0*w/sum(h/er), D'=C'*sum(h*tan(delta)/er)/sum(h/er).
  // Finite 40-mm plates add positive edge fringing to the infinite-width analytic reference.
  const width = 40
  const h1 = .18
  const h2 = .02
  const e1 = 4.1
  const e2 = 3.3
  const t1 = .02
  const t2 = .025
  const metal = { xMin:-width/2, xMax:width/2, conductivitySm:5.8e7 }
  const slice: CrossSection = { conductors:[
    { id:'signal', group:0, ...metal, zMin:h1+h2, zMax:h1+h2+.035 },
    { id:'ground', group:-1, ...metal, zMin:-.035, zMax:0 },
  ], dielectrics:[
    { xMin:-width/2, xMax:width/2, zMin:0, zMax:h1, er:e1, lossTangent:t1 },
    { xMin:-width/2, xMax:width/2, zMin:h1, zMax:h1+h2, er:e2, lossTangent:t2 },
  ] }
  const result = solveCrossSection(slice)
  const electrical = h1/e1+h2/e2
  const C = epsilon0*width/electrical
  const loss = C*(h1/e1*t1+h2/e2*t2)/electrical
  assert.ok(Math.abs(result.C[0][0]/C-1)<.02)
  assert.ok(Math.abs(result.loss[0][0]/loss-1)<.02)
})
