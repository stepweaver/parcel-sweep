import "../loadEnv.js";
import { describe, it } from "node:test";
import {
  isGoogleAddressValidationConfigured,
  validateQuickRouteAddress,
} from "./googleAddressValidation.js";
import { evaluateGoogleValidation } from "./googleAddressValidationAdapter.js";
import { houseNumbersMatch, requestedStreetMatchesCandidate } from "./addressMatch.js";

const SIX_GAPS = [
  "2107 South Mead St",
  "2239 South Mead St",
  "1616 Philippa St",
  "1830 Philippa St",
  "1818 South Jackson St",
  "1917 South Jackson St",
];

const FIELD_TEST_15 = [
  "2221 South Olive St",
  "2107 South Mead St",
  "1918 W Indiana Ave",
  "1619 South Warren St",
  "1818 South Jackson St",
  "1916 Wabash St",
  "2002 South Carlisle St",
  "3001 West Calvert St",
  "1616 Philippa St",
  "1925 W Indiana Ave",
  "2239 South Mead St",
  "2014 South Brookfield St",
  "1830 Philippa St",
  "3201 West Calvert St",
  "1917 South Jackson St",
];

const configured = isGoogleAddressValidationConfigured();

describe("live Google Address Validation (optional)", () => {
  it("reports the six field-test coverage gaps without exposing the key", { skip: !configured }, async () => {
    for (const input of SIX_GAPS) {
      const decision = await validateQuickRouteAddress(input);
      if (!decision) continue;
      const streetLine = [decision.meta.houseNumber, decision.meta.street].filter(Boolean).join(" ");
      console.log(
        JSON.stringify({
          input,
          googleReturnedAddress: decision.meta.formattedAddress ?? null,
          returnedZip: decision.meta.zip ?? null,
          validationGranularity: decision.meta.validationGranularity,
          geocodeGranularity: decision.meta.geocodeGranularity,
          addressComplete: decision.meta.addressComplete,
          componentChanges: decision.meta.changedComponents,
          latLngAvailable: decision.meta.geometryOk,
          phase1HouseMatch: houseNumbersMatch(
            input.match(/^(\d+)/)?.[1],
            decision.meta.houseNumber
          ),
          phase1StreetMatch: requestedStreetMatchesCandidate(input, streetLine || input),
          parcelSweepStatus: decision.status,
        })
      );
    }
  });

  it("reports all fifteen field-test addresses", { skip: !configured }, async () => {
    const tallies = { verified: 0, needs_review: 0, unresolved: 0 };
    for (const input of FIELD_TEST_15) {
      const decision = await validateQuickRouteAddress(input);
      const status = decision?.status ?? "unresolved";
      tallies[status] += 1;
      console.log(JSON.stringify({ input, status, zip: decision?.meta.zip ?? null }));
    }
    console.log(JSON.stringify({ fieldTest15: tallies, configured: true }));
  });

  it("adapter still classifies without a live key", () => {
    const decision = evaluateGoogleValidation("1918 W Indiana Ave", { result: undefined });
    if (!configured) {
      console.log(JSON.stringify({ googleAddressValidationConfigured: false }));
    }
    void decision;
  });
});
