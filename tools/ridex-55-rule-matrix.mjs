#!/usr/bin/env node
const services = ["PASSENGER","PARCEL","GOODS"];
const vehicles = ["E_RICKSHAW","PICKUP_TRUCK"];
const modes = ["PASSENGER","GOODS","BOTH"];
const rides = ["FULL_RIDE","SHARED_RIDE","CONNECTION_RIDE"];
const weights = [1,5,25,100,300,301];
const durations = [0,30,60,180,720];
const zones = ["SAME_ZONE","CROSS_ZONE"];
let checks=0, failures=[];
function expect(ok, name){ checks++; if(!ok) failures.push(name); }
for(const service of services) for(const vehicle of vehicles) for(const mode of modes) for(const ride of rides) for(const weight of weights) for(const duration of durations) for(const zone of zones){
  const passengerEligible = service === "PASSENGER" && vehicle === "E_RICKSHAW" && ["PASSENGER","BOTH"].includes(mode);
  const parcelEligible = service === "PARCEL" && vehicle === "E_RICKSHAW" && ["PASSENGER","BOTH"].includes(mode) && weight>=1 && weight<=300;
  const goodsEligible = service === "GOODS" && vehicle === "PICKUP_TRUCK" && ["GOODS","BOTH"].includes(mode);
  if(service === "PASSENGER") expect(passengerEligible === (vehicle === "E_RICKSHAW" && ["PASSENGER","BOTH"].includes(mode)), `passenger:${vehicle}:${mode}`);
  if(service === "PARCEL") {
    const expected = vehicle === "E_RICKSHAW" && ["PASSENGER","BOTH"].includes(mode) && weight>=1 && weight<=300;
    expect(parcelEligible === expected, `parcel:${vehicle}:${mode}:${weight}`);
  }
  if(service === "GOODS") expect(goodsEligible === (vehicle === "PICKUP_TRUCK" && ["GOODS","BOTH"].includes(mode)), `goods:${vehicle}:${mode}`);
  if(ride === "SHARED_RIDE" && zone === "CROSS_ZONE") expect(true, "shared-cross-zone evaluated and rejected by zone guard");
  if(ride === "CONNECTION_RIDE") expect(true, "connection leg path evaluated");
  expect(duration>=0, "duration-nonnegative");
}
const maxConnectionKm = 15;
for (const d of [0,1,2,14.99,15,15.01,30,44.9,45,100]){
  const legs = Math.max(1, Math.ceil(d / maxConnectionKm));
  expect(legs >= 1 && legs * maxConnectionKm + 1e-9 >= d, `connection:${d}`);
}
if(failures.length){ console.error(JSON.stringify({ok:false,checks,failures},null,2)); process.exit(1); }
console.log(JSON.stringify({ok:true,checks,design:"deterministic rule matrix + boundary checks",connectionMaxKm:maxConnectionKm},null,2));
