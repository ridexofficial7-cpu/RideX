import { seedRideXTestData, getRideXTestDataSummary } from "../src/services/testData";

async function main() {
  const result = await seedRideXTestData();
  const summary = await getRideXTestDataSummary();
  console.log(JSON.stringify({ result: { success: result.success, message: result.message }, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
