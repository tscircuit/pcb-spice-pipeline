import { numerics } from '../kernel'
import { fail } from './diagnostics'
import type { Matrix } from './linalg'

// Generated from lu.c by scripts/build-lu.mjs. No native process or approximate solver fallback.
const binary = Uint8Array.from(atob('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'),c=>c.charCodeAt(0))
interface Kernel {memory:WebAssembly.Memory;base:number;eliminate:(base:number,rows:number,columns:number,floor:number)=>number}
let loaded: Kernel | undefined
/** Initializes the standard WebAssembly backend; unsupported hosts get a named error, never another physics path. */
function kernel(): Kernel {
  if (loaded) return loaded
  try {
    const memory = new WebAssembly.Memory({initial:numerics.luInitialMemoryPages})
    const instance = new WebAssembly.Instance(new WebAssembly.Module(binary),{env:{memory}})
    loaded = {memory,base:Number((instance.exports.__heap_base as WebAssembly.Global).value),eliminate:instance.exports.lu as Kernel['eliminate']}
    return loaded
  } catch (error) {
    fail('matrix_backend',`IEEE-double WebAssembly is unavailable: ${String(error)}`)
  }
}
/** Dense partial-pivot LU in IEEE-double WebAssembly, with storage derived only from matrix dimensions. */
export function solveDense(matrix: Matrix, rhs: Matrix): Matrix {
  const {memory,base,eliminate} = kernel()
  const n = matrix.length
  const m = rhs[0].length
  const count = n*(n+m)
  try {
    const required = Math.ceil((base+count*Float64Array.BYTES_PER_ELEMENT)/numerics.wasmPageBytes)
    const allocated = memory.buffer.byteLength/numerics.wasmPageBytes
    if (required>allocated) memory.grow(required-allocated)
  } catch (error) {
    fail('matrix_storage',`Cannot allocate ${count} IEEE-double matrix entries: ${String(error)}`)
  }
  const values = new Float64Array(memory.buffer,base,count)
  for (let i=0;i<n;i++) {
    values.set(matrix[i],i*(n+m))
    values.set(rhs[i],i*(n+m)+n)
  }
  const pivot = eliminate(base,n,m,numerics.pivotAbsoluteFloor)
  if (pivot) fail('matrix_singular',`Singular field matrix at pivot ${pivot-1}`)
  const result = Array.from({length:n},(_,i)=>Array.from(values.subarray(i*(n+m)+n,(i+1)*(n+m))))
  if (result.some(row=>row.some(v=>!Number.isFinite(v)))) fail('matrix_singular','Nonfinite dense-solve result')
  return result
}
