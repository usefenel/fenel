// ---------------------------------------------------------------------------
// Google Places — geocoding provider
//
// Direct fetch against the Google Places API (New) for autocomplete +
// place details. Requires GOOGLE_PLACES_API_KEY env var; when unset the
// exports return empty results and `googlePlacesEnabled` is false so
// routes can short-circuit to 503.
//
// Phase 14a sub-step 1a — collapses the old `register/get` singleton
// indirection (engine/src/geocoding.ts) into pure module exports.
// ---------------------------------------------------------------------------

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

const apiKey = process.env["GOOGLE_PLACES_API_KEY"];

export const googlePlacesEnabled = Boolean(apiKey);

if (googlePlacesEnabled) {
  console.log("[google-places] Address autocomplete enabled");
} else {
  console.warn(
    "[google-places] GOOGLE_PLACES_API_KEY not set — address autocomplete disabled",
  );
}

export type Address = {
  formatted: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  countryName?: string;
  coordinates?: { lat: number; lng: number };
  placeId?: string;
};

export type AddressSuggestion = {
  label: string;
  placeId: string;
  secondary?: string;
};

export type AutocompleteOptions = {
  country?: string;
  location?: { lat: number; lng: number };
  limit?: number;
  sessionToken?: string;
  language?: string;
};

export async function googlePlacesAutocomplete(
  input: string,
  options?: AutocompleteOptions,
): Promise<AddressSuggestion[]> {
  if (!apiKey) return [];
  if (!input || input.length < 2) return [];

  const body: Record<string, unknown> = {
    input,
    includedPrimaryTypes: ["street_address", "route", "premise", "subpremise", "locality"],
  };

  if (options?.country) {
    body.includedRegionCodes = [options.country.toUpperCase()];
  }

  if (options?.location) {
    body.locationBias = {
      circle: {
        center: { latitude: options.location.lat, longitude: options.location.lng },
        radius: 50000,
      },
    };
  }

  if (options?.language) {
    body.languageCode = options.language;
  }

  if (options?.sessionToken) {
    body.sessionToken = options.sessionToken;
  }

  const res = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("[google-places] autocomplete failed:", res.status, await res.text());
    return [];
  }

  const data = await res.json() as {
    suggestions?: Array<{
      placePrediction?: {
        placeId: string;
        text: { text: string };
        structuredFormat?: {
          mainText: { text: string };
          secondaryText?: { text: string };
        };
      };
    }>;
  };

  return (data.suggestions ?? [])
    .filter((s) => s.placePrediction)
    .slice(0, options?.limit ?? 5)
    .map((s) => ({
      label: s.placePrediction!.structuredFormat?.mainText.text ?? s.placePrediction!.text.text,
      placeId: s.placePrediction!.placeId,
      secondary: s.placePrediction!.structuredFormat?.secondaryText?.text,
    }));
}

export async function googlePlacesDetails(placeId: string): Promise<Address | null> {
  if (!apiKey) return null;

  const fields = [
    "formattedAddress",
    "addressComponents",
    "location",
  ].join(",");

  const res = await fetch(`${DETAILS_URL}/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fields,
    },
  });

  if (!res.ok) {
    console.error("[google-places] details failed:", res.status, await res.text());
    return null;
  }

  const data = await res.json() as {
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    addressComponents?: Array<{
      longText: string;
      shortText: string;
      types: string[];
    }>;
  };

  const components = data.addressComponents ?? [];
  const find = (type: string) => components.find((c) => c.types.includes(type));

  const streetNumber = find("street_number")?.longText ?? "";
  const route = find("route")?.longText ?? "";
  const street = [streetNumber, route].filter(Boolean).join(" ") || undefined;

  return {
    formatted: data.formattedAddress ?? "",
    street,
    city: find("locality")?.longText ?? find("postal_town")?.longText,
    region: find("administrative_area_level_1")?.longText,
    postalCode: find("postal_code")?.longText,
    country: find("country")?.shortText,
    countryName: find("country")?.longText,
    coordinates: data.location
      ? { lat: data.location.latitude, lng: data.location.longitude }
      : undefined,
    placeId,
  };
}
