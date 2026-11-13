// Browser DOM admission only. This projection never edits the Markup value or
// defines which tags other render targets (email, Telegram, etc.) support.
// Stored attributes must not become arbitrary Solid properties: innerHTML,
// event handlers, ref and children are executable host APIs, not HTML data.
const TAGS = new Set((
  "a abbr address article aside audio b bdi bdo blockquote br button caption cite code col colgroup " +
  "data datalist dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 " +
  "header hgroup hr i img input ins kbd label legend li main mark menu meter nav ol optgroup option " +
  "output p picture pre progress q rp rt ruby s samp section select small source span strong sub " +
  "summary sup table tbody td textarea tfoot th thead time tr track u ul var video wbr"
).split(" "));
const ATTRS = new Set((
  "abbr accept alt autocomplete checked class cols colspan controls datetime dir disabled for height " +
  "high href id kind label lang list loop low max maxlength media min minlength multiple muted name " +
  "open optimum pattern placeholder poster preload readonly rel required reversed role rows rowspan " +
  "scope selected size span src srclang start step target title type value width wrap"
).split(" "));
const BOOLEAN_ATTRS = new Set("checked controls disabled loop multiple muted open readonly required reversed selected".split(" "));
const CSS_PROPERTIES = new Set((
  "background-color border border-bottom border-color border-left border-radius border-right border-style " +
  "border-top border-width color display flex flex-basis flex-direction flex-grow flex-shrink flex-wrap " +
  "font-family font-size font-style font-weight gap height justify-content align-items line-height " +
  "list-style-type margin margin-bottom margin-left margin-right margin-top max-height max-width min-height " +
  "min-width object-fit opacity overflow overflow-wrap padding padding-bottom padding-left padding-right " +
  "padding-top text-align text-decoration text-transform vertical-align white-space width word-break"
).split(" "));

function previewUrl(value: string, link: boolean): string | undefined {
  // URL parses ASCII tab/newline-obfuscated schemes exactly as the browser.
  try {
    const url = new URL(value, "https://preview.invalid/");
    if (url.protocol === "https:" || url.protocol === "http:" ||
      (link && (url.protocol === "mailto:" || url.protocol === "tel:"))) return value;
    // Raster data images are useful in authored content. SVG/HTML data and all
    // object URLs are excluded because their content has not been inspected.
    if (!link && /^data:image\/(?:png|gif|jpeg|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  } catch { /* invalid browser URL */ }
  return undefined;
}

function previewStyle(value: string): string {
  // Keep ordinary typography/layout without loading CSS resources, installing
  // custom properties, or positioning stored content over the surrounding app.
  return value.split(";").filter((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon === -1) return false;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const css = declaration.slice(colon + 1);
    return CSS_PROPERTIES.has(property) && !/[\\<>@]/.test(css) &&
      !/url\s*\(|expression\s*\(|var\s*\(|\/\*|!\s*important/i.test(css);
  }).join(";");
}

export function browserPreviewElement(tag: unknown, attrs: ReadonlyArray<{ key: unknown; value: unknown }>): {
  tag: keyof HTMLElementTagNameMap;
  attrs: Record<string, string | boolean>;
} {
  const requestedTag = typeof tag === "string" ? tag.toLowerCase() : "div";
  const safeTag = (TAGS.has(requestedTag) ? requestedTag : "div") as keyof HTMLElementTagNameMap;
  const safeAttrs: Record<string, string | boolean> = Object.create(null);
  for (const attr of attrs) {
    if (typeof attr.key !== "string" || typeof attr.value !== "string") continue;
    const key = attr.key.toLowerCase();
    if (key === "style") {
      safeAttrs.style = previewStyle(attr.value);
    } else if (ATTRS.has(key) || /^(?:data|aria)-[a-z][a-z0-9-]*$/.test(key)) {
      if (key === "href" || key === "src" || key === "poster") {
        const value = previewUrl(attr.value, key === "href");
        if (value !== undefined) safeAttrs[key] = value;
      } else {
        // Markup carries HTML attributes as strings. Solid spreads properties,
        // so a present boolean attribute (including "") must become true.
        safeAttrs[key] = BOOLEAN_ATTRS.has(key) ? true : attr.value;
      }
    }
  }
  // A preview may contain forms and fields, but cannot submit credentials or
  // acquire external form ownership. Buttons select nodes; they never submit.
  if (safeTag === "button") safeAttrs.type = "button";
  if (safeTag === "input" && ["submit", "image"].includes(String(safeAttrs.type ?? "").toLowerCase())) {
    safeAttrs.type = "button";
  }
  if (safeTag === "a") safeAttrs.rel = "noopener noreferrer";
  return { tag: safeTag, attrs: safeAttrs };
}
