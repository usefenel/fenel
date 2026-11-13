import { render } from "@solidjs/web";
import { ValueCard, ValueCardCaption } from "./value-card";
import { TooltipLayer } from "./tooltip";
import { LocusContextMenu } from "./locus-context-menu";
import { codeName, displayNameText, displayNameTooltipCode, humanName, type DisplayName } from "./display-name";

// Before/after fixture for code names shown without a human label. In the
// baseline build (the preceding commit's card, tooltip and menu) a surface
// only takes plain strings, so the fixture passes the text it would show.
const baseline = !!(globalThis as { displayNameBaseline?: boolean }).displayNameBaseline;
const shown = (name: DisplayName) => baseline ? displayNameText(name) : name;
const tooltipCode = (name: DisplayName) => baseline ? undefined : displayNameTooltipCode(name);
const parameters = [humanName("Text"), codeName("s")];

render(() => <>
  <main style="padding:24px;font-family:Arial,sans-serif;max-width:820px;margin:auto;display:grid;gap:24px;">
    <section data-cards style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
      <div data-card="label" style="height:120px"><ValueCard heading={<ValueCardCaption caption={shown(humanName("Reversed words")) as never} typeLabel="String" typeIcon="type" />}>
        <span>fox brown quick the</span></ValueCard></div>
      <div data-card="code" style="height:120px"><ValueCard heading={<ValueCardCaption caption={shown(codeName("reversedWords")) as never} typeLabel="String" typeIcon="type" />}>
        <span>fox brown quick the</span></ValueCard></div>
      <div data-card="unnamed" style="height:120px"><ValueCard heading={<ValueCardCaption caption="" unnamed typeLabel="String" typeIcon="type" />}>
        <span>fox brown quick the</span></ValueCard></div>
    </section>
    <section data-inputs style="display:flex;gap:48px;padding:12px 0 60px;">
      {parameters.map(parameter => <button type="button" data-input={parameter.text}
        style="width:22px;height:22px;border-radius:50%;border:2px solid #64748b;background:#fff;"
        aria-label={`Supply ${parameter.text}`} data-tooltip={`${parameter.text}: missing data`}
        data-tooltip-code={tooltipCode(parameter)} />)}
    </section>
  </main>
  <LocusContextMenu x={420} y={250} label="Inputs" onClose={() => {}} items={parameters.map(parameter => ({
    id: parameter.text, label: parameter.text, icon: "arrow-down",
    ...(baseline ? {} : { labelCode: displayNameTooltipCode(parameter) }),
  }))} />
  <TooltipLayer />
</>, document.body.appendChild(document.createElement("div")));
(globalThis as { displayNameFixture?: boolean }).displayNameFixture = true;
