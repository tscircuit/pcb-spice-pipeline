import {mkdir,writeFile} from 'node:fs/promises'
import {solveCrossSection,solve,epsilon0,mu0} from '../src/extraction/index'
import {coupledMicrostrip,coupledStripline} from '../tests/extraction/closed-form'
// Mathematical cross-sections in mm, independent of Circuit JSON or TSX board generation.
const rows=[]
for(const paired of [false,true])for(const stripline of [false,true]) {
  const ground={group:-1,xMin:-20,xMax:20,conductivitySm:5.8e7}
  const signal={zMin:1,zMax:1.001,conductivitySm:5.8e7}
  const fixture={conductors:[{id:'a',group:0,xMin:paired?-1.25:-.5,xMax:paired?-.25:.5,...signal},
    ...(paired?[{id:'b',group:1,xMin:.25,xMax:1.25,...signal}]:[]),
    {id:'lower',...ground,zMin:-.035,zMax:0},...(stripline?[{id:'upper',...ground,zMin:2,zMax:2.035}]:[])],
    dielectrics:[{xMin:-20,xMax:20,zMin:0,zMax:stripline?2:1,er:4,lossTangent:0}]}
  const name=`${paired?'coupled':'single'} ${stripline?'stripline':'microstrip'}`
  console.log(name)
  const r=solveCrossSection(fixture,console.log)
  const ze=Math.sqrt(mu0*epsilon0/((r.C[0][0]+(r.C[0][1]??0))*(r.C0[0][0]+(r.C0[0][1]??0))))
  const zo=Math.sqrt(mu0*epsilon0/((r.C[0][0]-(r.C[0][1]??0))*(r.C0[0][0]-(r.C0[0][1]??0))))
  let measured
  let oracle
  if(paired) {
    oracle=stripline?coupledStripline(1,.5,2,4):coupledMicrostrip(1,.5,4)
    const inv=solve(r.C0,[[1,0],[0,1]])
    measured={ze,zo,l12:mu0*epsilon0*inv[0][1],c12:r.C[0][1],
      ee:(r.C[0][0]+r.C[0][1])/(r.C0[0][0]+r.C0[0][1]),eo:(r.C[0][0]-r.C[0][1])/(r.C0[0][0]-r.C0[0][1])}
    if(stripline)oracle={...oracle,ee:4,eo:4}
  } else {
    const a=1+Math.log((1+(1/52)**2)/(1+.432))/49+Math.log(1+(1/18.1)**3)/18.7
    const ee=2.5+1.5*11**(-a*.564*((4-.9)/(4+3))**.053)
    const f=6+(2*Math.PI-6)*Math.exp(-(30.666**.7528))
    oracle=stripline?{z:30*Math.PI/(2*(.5+2*Math.log(2)/Math.PI)),ee:4}:{z:60*Math.log(f+Math.sqrt(5))/Math.sqrt(ee),ee}
    measured={z:ze,ee:r.C[0][0]/r.C0[0][0]}
  }
  const row={name,oracle,measured,errorPercent:Object.fromEntries(Object.keys(measured).map(k=>[k,100*(measured[k]/oracle[k]-1)])),mesh:r.steps}
  rows.push(row)
  console.log(JSON.stringify(row))
  await mkdir('runs',{recursive:true})
  await writeFile('runs/accuracy.json',JSON.stringify(rows,null,2))
}
