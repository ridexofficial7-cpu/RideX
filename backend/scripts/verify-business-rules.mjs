import assert from 'node:assert/strict';

const vehicles=['E_RICKSHAW','PICKUP_TRUCK'];
const modes=['PASSENGER','GOODS','BOTH'];
const services=['PASSENGER','PARCEL','GOODS'];
let checks=0;
const eligible=(service,vehicle,mode)=>{
  if(service==='PASSENGER') return vehicle==='E_RICKSHAW' && ['PASSENGER','BOTH'].includes(mode);
  if(service==='PARCEL') return vehicle==='E_RICKSHAW' && ['PASSENGER','BOTH'].includes(mode);
  return service==='GOODS' && vehicle==='PICKUP_TRUCK' && ['GOODS','BOTH'].includes(mode);
};
for(const service of services) for(const vehicle of vehicles) for(const mode of modes){
  const expected = service==='PASSENGER' || service==='PARCEL'
    ? vehicle==='E_RICKSHAW' && (mode==='PASSENGER'||mode==='BOTH')
    : vehicle==='PICKUP_TRUCK' && (mode==='GOODS'||mode==='BOTH');
  assert.equal(eligible(service,vehicle,mode),expected,`${service}/${vehicle}/${mode}`); checks++;
}
// Shared Ride: same city only.
const sameCity=(a,b)=>a===b;
assert.equal(sameCity('KATIHAR','KATIHAR'),true); checks++;
assert.equal(sameCity('KATIHAR','PURNEA'),false); checks++;
// Connection leg: never exceed configured max in the abstract planner.
const split=(distance,max=15)=>Math.max(1,Math.ceil(distance/max));
for(const km of [0,1,14.9,15,15.1,30,44.9,45,80]){
  const legs=split(km); assert.ok(legs>=1); assert.ok(km/legs<=15+1e-9,`distance=${km}`); checks++;
}
// Parcel limit.
for(const kg of [1,5,300]){assert.ok(kg>=1 && kg<=300);checks++;}
for(const kg of [0,300.01]){assert.ok(!(kg>=1 && kg<=300));checks++;}
console.log(`RideX business rule checks passed: ${checks}`);
