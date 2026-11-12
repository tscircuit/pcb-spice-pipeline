/** The same declarative transient deck is consumed by native batch ngspice and WASM. */
export function routedControl(saved: string, step: number, duration: number): string[] {
  return [`.save ${saved}`, `.tran ${step} ${duration} 0 ${step}`, '.end']
}
