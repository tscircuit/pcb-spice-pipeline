import { BaseSolver } from '@tscircuit/solver-utils'
import { emptyVisualization } from '../solver'
import { snapshot, type Produced } from '../kernel'

type ItemSolver<I, O> = BaseSolver & { getOutput(): Produced<O>; getConstructorParams(): [I] }
type ItemClass<I, O> = new (input: I) => ItemSolver<I, O>

/** One flat stage drains the domain algorithm one item at a time across all admitted blocks. */
export class RoutedStageSolver<I, O> extends BaseSolver {
  private current?: ItemSolver<I, O>
  private readonly outputs: Produced<O>[] = []
  private output?: Produced<O[]>
  private readonly completedStats: Record<string, number> = {}
  /** The stage definition owns the algorithm; downloads contain only its ordered input values. */
  constructor(
    private readonly inputs: I[],
    private readonly solverClass: ItemClass<I, O>,
  ) {
    super()
  }
  /** Use the domain name in debugger breadcrumbs, without creating nested pipeline rows. */
  override getSolverName(): string {
    return this.solverClass.name
  }
  /** Only the transient algorithm requires asynchronous stepping. */
  override assertCanStepSynchronously(): void {
    if (this.inputs.length && this.solverClass.prototype._stepAsync !== BaseSolver.prototype._stepAsync) super.assertCanStepSynchronously()
  }
  /** Start the next block only after the previous block has completed successfully. */
  private prepare(): ItemSolver<I, O> | undefined {
    if (this.outputs.length === this.inputs.length) {
      this.output = { value: snapshot(this.outputs.map((output) => output.value)), artifacts: this.outputs.flatMap((output) => output.artifacts) }
      this.stats = { ...this.stats, blocks: this.inputs.length, completedBlocks: this.outputs.length }
      this.progress = 1
      this.solved = true
      return
    }
    this.current ??= new this.solverClass(this.inputs[this.outputs.length])
    return this.current
  }
  /** Include the current block in stage stats even when its step throws. */
  private recordStats(): void {
    const current = this.current!
    const stats = { ...current.stats }
    for (const [name, value] of Object.entries(current.stats)) {
      if (typeof value === 'number')
        stats[name] = name.startsWith('maximum') ? Math.max(this.completedStats[name] ?? 0, value) : (this.completedStats[name] ?? 0) + value
    }
    this.stats = { ...stats, blocks: this.inputs.length, completedBlocks: this.outputs.length + Number(current.solved) }
    if (current.solved) Object.assign(this.completedStats, stats)
  }
  /** Record only completed domain outputs; failures never expose a partial stage result. */
  private finish(): void {
    const current = this.current!
    if (current.failed) throw new Error(current.error ?? `${this.getSolverName()} failed`)
    if (current.solved) {
      this.outputs.push(current.getOutput())
      if (this.outputs.length === this.inputs.length) this.prepare()
    }
    this.progress = this.inputs.length ? (this.outputs.length + (current.solved ? 0 : current.progress)) / this.inputs.length : 1
  }
  /** Preserve synchronous compile-only stepping through all five non-native stages. */
  override _step(): void {
    if (this.current?.solved) this.current = undefined
    const current = this.prepare()
    if (!current) return
    try {
      current.step()
    } finally {
      this.recordStats()
    }
    this.finish()
  }
  /** Await one item, so ngspice calls remain strictly sequential across blocks. */
  override async _stepAsync(): Promise<void> {
    if (this.current?.solved) this.current = undefined
    const current = this.prepare()
    if (!current) return
    try {
      await current.stepAsync()
    } finally {
      this.recordStats()
    }
    this.finish()
  }
  /** The immutable stage boundary is an array in admission order. */
  override getOutput(): Produced<O[]> {
    if (!this.output) throw new Error(`${this.getSolverName()} is incomplete`)
    return this.output
  }
  /** Retain each original domain input for constructor downloads and focused diagnostics. */
  override getConstructorParams(): [I[]] {
    return [this.inputs]
  }
  /** Compatibility only; the physical scene is rendered from retained domain outputs. */
  override visualize = emptyVisualization
}

/** Bind a domain algorithm once in the static stage tuple, with no runtime stage creation. */
export function routedStage<I, O>(solverClass: ItemClass<I, O>): new (inputs: I[]) => RoutedStageSolver<I, O> {
  return class extends RoutedStageSolver<I, O> {
    /** One immutable input per admitted block; the stage owns its ordered work queue. */
    constructor(inputs: I[]) {
      super(inputs, solverClass)
    }
  }
}
