// Exact native pad geometry from the user's package; CAD and enclosure assets omitted.
const cpuRows = "ABCDEFGHJKLMNPRTUV"
const dramRows = "ABCDEFGHJKLMNPRT"
const dramColumns = [1, 2, 3, 7, 8, 9]
const dramX = [-3.199892, -2.400046, -1.599946, 1.599946, 2.400046, 3.199892]
const dramY = [5.999861, 5.199761, 4.399915, 3.599815, 2.799969, 1.999869, 1.199769, 0.399923, -0.400177, -1.200023, -2.000123, -2.800223, -3.600069, -4.400169, -5.200015, -6.000115]
export const cpuFootprint = <footprint>{[...cpuRows].flatMap((row, i) =>
  Array.from({length:18}, (_, j) => <smtpad portHints={[`${row}${j+1}`]}
    pcbX={(i-8.5)*0.8} pcbY={(j-8.5)*0.8} shape="circle" radius={0.2} />))}</footprint>
export const dramFootprint = <footprint>{dramColumns.flatMap((col, j) =>
  [...dramRows].map((row, i) => <smtpad portHints={[`${row}${col}`]}
    pcbX={dramX[j]} pcbY={dramY[i]} shape="circle" radius={0.175006} />))}</footprint>
