import Board from "./index.circuit";
/** The DDR solve includes real power/ground escape copper as fixed obstacles.
 * DDR is the first signal-routing phase; all peripheral signal phases are off.
 */
export default function DdrRoutingBoard() {
  return <Board ddrRoutes={[]} solveDdr routePeripherals={false} />;
}
