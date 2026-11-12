/** Copy and freeze domain values; completed stages never share mutable work state. */
export function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(entry => snapshot(entry))) as T
  if (value && typeof value === 'object') {
    if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) throw new Error('Stage snapshots require plain values')
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)]))) as T
  }
  if (typeof value === 'function') throw new Error('Stage snapshots cannot contain functions')
  return value
}
