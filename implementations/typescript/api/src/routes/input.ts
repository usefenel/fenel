// ---------------------------------------------------------------------------
// /api/input — input strategy endpoints (autocomplete, enrichment)
//
// Bridges frontend input fields to remote providers (geocoding, etc.).
// Local strategies (normalize-email, etc.) run client-side — no endpoint needed.
//
// Phase 12c-routes sub-step 4 — disposition sweep.
// Phase 14a sub-step 1a — drops the plug-in singleton indirection; calls
// the google-places module directly.
//
// Both routes (POST /address/autocomplete + POST /address/details) are
// B-permanent: single irreducible third-party API calls (geocoding
// provider). No port target; the third-party API is the IO leaf. This
// is where the workstream's "default to Fenel; TS for irreducible IO"
// first principle reaches its natural limit.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
  googlePlacesEnabled,
  googlePlacesAutocomplete,
  googlePlacesDetails,
} from "../google-places";

const inputRoutes = new Hono();

// ---------------------------------------------------------------------------
// POST /api/input/address/autocomplete
//   Body: { input: string, country?: string, language?: string, sessionToken?: string }
//   Returns: { suggestions: AddressSuggestion[] }
// ---------------------------------------------------------------------------

inputRoutes.post("/address/autocomplete", async (c) => {
  if (!googlePlacesEnabled) {
    return c.json({ error: "Address autocomplete not configured" }, 503);
  }

  const body = await c.req.json<{
    input: string;
    country?: string;
    language?: string;
    sessionToken?: string;
  }>();

  if (!body.input || body.input.length < 2) {
    return c.json({ suggestions: [] });
  }

  try {
    const suggestions = await googlePlacesAutocomplete(body.input, {
      country: body.country,
      language: body.language,
      sessionToken: body.sessionToken,
      limit: 5,
    });
    return c.json({ suggestions });
  } catch (err) {
    console.error("[input] address autocomplete failed:", err);
    return c.json({ error: "Autocomplete failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/input/address/details
//   Body: { placeId: string }
//   Returns: Address
// ---------------------------------------------------------------------------

inputRoutes.post("/address/details", async (c) => {
  if (!googlePlacesEnabled) {
    return c.json({ error: "Address autocomplete not configured" }, 503);
  }

  const body = await c.req.json<{ placeId: string }>();
  if (!body.placeId) {
    return c.json({ error: "placeId required" }, 400);
  }

  try {
    const address = await googlePlacesDetails(body.placeId);
    if (!address) {
      return c.json({ error: "Place not found" }, 404);
    }
    return c.json(address);
  } catch (err) {
    console.error("[input] address details failed:", err);
    return c.json({ error: "Details lookup failed" }, 500);
  }
});

export { inputRoutes };
