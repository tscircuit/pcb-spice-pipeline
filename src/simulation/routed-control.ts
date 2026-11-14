/** A single declarative transient deck is consumed by local native batch ngspice. */
export function routedControl(saved: string, step: number, duration: number): string[] {
  return [`.save ${saved}`, `.tran ${step} ${duration} 0 ${step}`, '.end']
}
