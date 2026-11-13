// ---------------------------------------------------------------------------
// Built-in input strategies + default channels per type
//
// This file owns the *channel* metadata — what UX surfaces a type can be
// entered through (text input, map picker, GPS, contacts import, etc.).
// The coercion side moved to input-layer.ts (parseInput) + input-parsers.ts
// in slice 10-A. Channels still reference strategies by id (e.g.
// "normalize-email") for trigger / debounce hints; the actual normalization
// happens through parseInput.
//
// Types declare default input channels. Fields can override.
// ---------------------------------------------------------------------------

import type { InputStrategyDef, InputChannel } from "./types";

// ---------------------------------------------------------------------------
// Strategy registry — all built-in strategy definitions
// ---------------------------------------------------------------------------

export const builtinInputStrategies: InputStrategyDef[] = [
  {
    id: "normalize-email",
    name: "Email normalizer",
    mode: "local",
    defaultTrigger: "blur",
  },
  {
    id: "normalize-phone",
    name: "Phone normalizer",
    mode: "local",
    defaultTrigger: "blur",
  },
  {
    id: "detect-handle",
    name: "Handle detector",
    mode: "local",
    defaultTrigger: "blur",
  },
  {
    id: "autocomplete-address",
    name: "Address autocomplete",
    mode: "remote",
    interaction: "autocomplete",
    defaultTrigger: "live",
    outputType: "address",
  },
];

// ---------------------------------------------------------------------------
// Default channels per type — types declare how data can enter them
//
// Keyed by type name (format name, entity name, or schema type).
// First channel is the default (shown initially).
// Fields can override via `channels` or `input`.
// ---------------------------------------------------------------------------

export const defaultChannels: Record<string, InputChannel[]> = {
  // --- Address: type + autocomplete, map picker, GPS ---
  address: [
    {
      kind: "text",
      id: "type-address",
      name: "Type address",
      icon: "keyboard",
      strategy: "autocomplete-address",
      trigger: "live",
      minLength: 3,
      debounceMs: 300,
    },
    {
      kind: "widget",
      id: "pick-on-map",
      name: "Pick on map",
      icon: "map",
      widget: "map-picker",
    },
    {
      kind: "action",
      id: "current-location",
      name: "Current location",
      icon: "location",
      action: "geolocation",
    },
  ],

  // --- Phone: type + normalize, import from contacts ---
  phone: [
    {
      kind: "text",
      id: "type-phone",
      name: "Type phone",
      icon: "keyboard",
      strategy: "normalize-phone",
      trigger: "blur",
    },
    {
      kind: "action",
      id: "from-contacts",
      name: "From contacts",
      icon: "contacts",
      action: "pick-contact-phone",
    },
  ],

  // --- Email: type + normalize ---
  email: [
    {
      kind: "text",
      id: "type-email",
      name: "Type email",
      icon: "keyboard",
      strategy: "normalize-email",
      trigger: "blur",
    },
  ],

  // --- Handle: type + detect platform ---
  handle: [
    {
      kind: "text",
      id: "type-handle",
      name: "Type handle or URL",
      icon: "keyboard",
      strategy: "detect-handle",
      trigger: "blur",
    },
  ],

  // --- Date: type + calendar picker ---
  date: [
    {
      kind: "text",
      id: "type-date",
      name: "Type date",
      icon: "keyboard",
    },
    {
      kind: "widget",
      id: "calendar-picker",
      name: "Pick from calendar",
      icon: "calendar",
      widget: "calendar-picker",
    },
  ],

  // --- Color: type hex + color picker ---
  color: [
    {
      kind: "text",
      id: "type-color",
      name: "Type hex code",
      icon: "keyboard",
    },
    {
      kind: "widget",
      id: "color-picker",
      name: "Pick color",
      icon: "palette",
      widget: "color-picker",
    },
  ],
};

/**
 * Get default input channels for a type.
 * Returns undefined if the type has no default channels.
 */
export function getDefaultChannels(typeName: string): InputChannel[] | undefined {
  return defaultChannels[typeName];
}

/**
 * `Inputable` typeclass instances derived from the static `defaultChannels`
 * map — same data, exposed through the typeclass registry so consumers can
 * resolve via `Inputable a` rather than a separate keyed lookup.
 */
export const builtinInputableInstances: { typeName: string; args: [string]; methods: { channels: InputChannel[] } }[] =
  Object.entries(defaultChannels).map(([typeName, channels]) => ({
    typeName: "Inputable",
    args: [typeName],
    methods: { channels },
  }));

/**
 * Get a strategy definition by ID.
 */
export function getStrategyDef(strategyId: string): InputStrategyDef | undefined {
  return builtinInputStrategies.find((s) => s.id === strategyId);
}
