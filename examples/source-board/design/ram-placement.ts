import placement from "./ram-placement.json";
export {placement as ramPlacement};
export function ramPoint(x:number,y:number){
 const a=placement.rotation*Math.PI/180, localY=y+27;
 return {x:placement.x+x*Math.cos(a)-localY*Math.sin(a),y:placement.y+x*Math.sin(a)+localY*Math.cos(a)};
}
export const isRamRef = (name:string)=>name==="U3" || name.startsWith("C_DDR") || ["R_ZQ","R_VREF_H","R_VREF_L","C_VREF","R_DDR_RST"].includes(name);
