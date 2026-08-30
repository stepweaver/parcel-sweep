import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptGoogleValidationResponse,
  evaluateGoogleValidation,
  extractUserZip,
  streetLineForValidation,
  type GoogleAddressValidationResponse,
} from "./googleAddressValidationAdapter.js";
import { buildGoogleValidationRequest } from "./googleAddressValidation.js";

function component(
  type: string,
  text: string,
  extras: {
    confirmationLevel?: string;
    inferred?: boolean;
    spellCorrected?: boolean;
    replaced?: boolean;
  } = {}
) {
  return {
    componentName: { text, languageCode: "en" },
    componentType: type,
    confirmationLevel: extras.confirmationLevel ?? "CONFIRMED",
    ...extras,
  };
}

function premiseResponse(opts: {
  formattedAddress: string;
  house: string;
  street: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  validationGranularity?: string;
  geocodeGranularity?: string;
  addressComplete?: boolean;
  hasUnconfirmedComponents?: boolean;
  hasInferredComponents?: boolean;
  hasReplacedComponents?: boolean;
  extras?: ReturnType<typeof component>[];
  omitGeometry?: boolean;
  omitPlaceId?: boolean;
}): GoogleAddressValidationResponse {
  const city = opts.city ?? "South Bend";
  const state = opts.state ?? "IN";
  const zip = opts.zip ?? "46613";
  return {
    result: {
      verdict: {
        inputGranularity: "PREMISE",
        validationGranularity: opts.validationGranularity ?? "PREMISE",
        geocodeGranularity: opts.geocodeGranularity ?? "PREMISE",
        addressComplete: opts.addressComplete ?? true,
        hasUnconfirmedComponents: opts.hasUnconfirmedComponents ?? false,
        hasInferredComponents: opts.hasInferredComponents ?? false,
        hasReplacedComponents: opts.hasReplacedComponents ?? false,
      },
      address: {
        formattedAddress: opts.formattedAddress,
        postalAddress: {
          regionCode: "US",
          postalCode: zip,
          administrativeArea: state,
          locality: city,
          addressLines: [`${opts.house} ${opts.street}`],
        },
        addressComponents: [
          component("street_number", opts.house),
          component("route", opts.street),
          component("locality", city),
          component("administrative_area_level_1", state),
          component("postal_code", zip),
          ...(opts.extras ?? []),
        ],
      },
      geocode: opts.omitGeometry
        ? { placeId: opts.omitPlaceId ? undefined : opts.placeId ?? "ChIJ-test" }
        : {
            location: { latitude: opts.lat ?? 41.652, longitude: opts.lng ?? -86.251 },
            placeId: opts.omitPlaceId ? undefined : opts.placeId ?? "ChIJ-test",
          },
    },
  };
}

describe("Google Address Validation request builder", () => {
  it("uses US / South Bend / IN and does not inject a ZIP", () => {
    const body = buildGoogleValidationRequest("1818 South Jackson St");
    assert.equal(body.address.regionCode, "US");
    assert.equal(body.address.locality, "South Bend");
    assert.equal(body.address.administrativeArea, "IN");
    assert.deepEqual(body.address.addressLines, ["1818 South Jackson St"]);
    assert.equal(body.address.postalCode, undefined);
    assert.equal(extractUserZip("1818 South Jackson St"), undefined);
  });

  it("preserves an explicit user ZIP and still does not invent 46613/46614", () => {
    const body = buildGoogleValidationRequest("1918 W Indiana Ave, 46613");
    assert.equal(body.address.postalCode, "46613");
    assert.equal(streetLineForValidation("1918 W Indiana Ave, 46613"), "1918 W Indiana Ave");
    const noZip = buildGoogleValidationRequest("1918 W Indiana Ave");
    assert.equal(noZip.address.postalCode, undefined);
  });
});

describe("Google Address Validation adapter (A–I)", () => {
  it("A. premise-level exact address verifies", () => {
    const input = "1918 W Indiana Ave";
    const decision = evaluateGoogleValidation(
      input,
      premiseResponse({
        formattedAddress: "1918 West Indiana Avenue, South Bend, IN 46613, USA",
        house: "1918",
        street: "West Indiana Avenue",
        zip: "46613",
        placeId: "ChIJ-indiana",
      })
    );
    assert.equal(decision.status, "verified");
    assert.equal(decision.candidate?.houseNumber, "1918");
    assert.equal(decision.candidate?.zip, "46613");
    assert.equal(decision.meta.validationGranularity, "PREMISE");
    assert.equal(decision.meta.addressComplete, true);
    assert.ok(decision.meta.geometryOk);
  });

  it("B. harmless suffix/directional normalization may verify", () => {
    const decision = evaluateGoogleValidation(
      "1818 South Jackson Street",
      premiseResponse({
        formattedAddress: "1818 S Jackson St, South Bend, IN 46613, USA",
        house: "1818",
        street: "S Jackson St",
        zip: "46613",
        placeId: "ChIJ-jackson",
      })
    );
    assert.equal(decision.status, "verified");
    assert.equal(decision.meta.materialStreetOrHouseChange, false);
  });

  it("C. wrong street same house number cannot verify", () => {
    const decision = evaluateGoogleValidation(
      "2221 South Olive St",
      premiseResponse({
        formattedAddress: "2221 South Michigan Street, South Bend, IN 46614, USA",
        house: "2221",
        street: "South Michigan Street",
        zip: "46614",
        hasReplacedComponents: true,
        extras: [component("route", "South Michigan Street", { replaced: true })],
      })
    );
    assert.notEqual(decision.status, "verified");
    assert.equal(decision.meta.materialStreetOrHouseChange, true);
  });

  it("D. wrong house same street cannot verify", () => {
    const decision = evaluateGoogleValidation(
      "1818 South Jackson St",
      premiseResponse({
        formattedAddress: "1816 S Jackson St, South Bend, IN 46613, USA",
        house: "1816",
        street: "S Jackson St",
        zip: "46613",
        hasReplacedComponents: true,
        extras: [component("street_number", "1816", { replaced: true })],
      })
    );
    assert.notEqual(decision.status, "verified");
    assert.equal(decision.meta.materialStreetOrHouseChange, true);
  });

  it("E. materially changed street needs review, not auto-verified", () => {
    const decision = evaluateGoogleValidation(
      "2107 South Mead St",
      premiseResponse({
        formattedAddress: "2107 South Meade Street, South Bend, IN 46613, USA",
        house: "2107",
        street: "South Meade Street",
        zip: "46613",
        extras: [component("route", "South Meade Street", { spellCorrected: true })],
      })
    );
    assert.equal(decision.status, "needs_review");
    assert.ok(decision.suggestedCorrection);
    assert.match(decision.suggestedCorrection.explanation, /mead/i);
    assert.equal(decision.candidate?.street, "South Meade Street");
  });

  it("F. route-only result is not verified", () => {
    const decision = evaluateGoogleValidation(
      "Jackson Street, South Bend",
      premiseResponse({
        formattedAddress: "Jackson Street, South Bend, IN 46613, USA",
        house: "",
        street: "Jackson Street",
        zip: "46613",
        validationGranularity: "ROUTE",
        geocodeGranularity: "ROUTE",
      })
    );
    assert.notEqual(decision.status, "verified");
    assert.equal(decision.meta.validationGranularity, "ROUTE");
  });

  it("G. wrong ZIP is not Quick Route verified", () => {
    for (const zip of ["46601", "46616", "46628"]) {
      const decision = evaluateGoogleValidation(
        "1918 W Indiana Ave",
        premiseResponse({
          formattedAddress: `1918 West Indiana Avenue, South Bend, IN ${zip}, USA`,
          house: "1918",
          street: "West Indiana Avenue",
          zip,
        })
      );
      assert.notEqual(decision.status, "verified", zip);
    }
  });

  it("H. wrong city is not verified", () => {
    const decision = evaluateGoogleValidation(
      "1616 Philippa St",
      premiseResponse({
        formattedAddress: "1616 Philippa Street, Fort Wayne, IN 46802, USA",
        house: "1616",
        street: "Philippa Street",
        city: "Fort Wayne",
        zip: "46802",
        lat: 41.08,
        lng: -85.14,
      })
    );
    assert.notEqual(decision.status, "verified");
    assert.equal(decision.meta.inServiceArea, false);
  });

  it("I. missing geometry is not verified", () => {
    const decision = evaluateGoogleValidation(
      "1918 W Indiana Ave",
      premiseResponse({
        formattedAddress: "1918 West Indiana Avenue, South Bend, IN 46613, USA",
        house: "1918",
        street: "West Indiana Avenue",
        zip: "46613",
        omitGeometry: true,
      })
    );
    assert.notEqual(decision.status, "verified");
    assert.equal(decision.meta.geometryOk, false);
  });

  it("does not treat HTTP-shaped completeness as verification by itself", () => {
    const adapted = adaptGoogleValidationResponse(
      "2221 South Olive St",
      premiseResponse({
        formattedAddress: "2221 South Michigan Street, South Bend, IN 46614, USA",
        house: "2221",
        street: "South Michigan Street",
        zip: "46614",
        addressComplete: true,
      })
    );
    assert.equal(adapted.meta.addressComplete, true);
    assert.equal(adapted.meta.materialStreetOrHouseChange, true);
    const decision = evaluateGoogleValidation("2221 South Olive St", {
      result: adapted.meta && premiseResponse({
        formattedAddress: "2221 South Michigan Street, South Bend, IN 46614, USA",
        house: "2221",
        street: "South Michigan Street",
        zip: "46614",
      }).result,
    });
    assert.notEqual(decision.status, "verified");
  });
});
