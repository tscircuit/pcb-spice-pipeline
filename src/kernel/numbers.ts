/** Minimum without JavaScript's function-argument count limit; empty input matches Math.min(). */
export const min = (values: readonly number[]): number => values.reduce((a, b) => Math.min(a, b), Infinity)
/** Maximum without JavaScript's function-argument count limit; empty input matches Math.max(). */
export const max = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), -Infinity)
