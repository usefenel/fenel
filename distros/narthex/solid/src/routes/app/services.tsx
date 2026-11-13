import { For } from "solid-js";
import { canonical } from "@fenel/engine/locale";
import { createRepositoryRegistry } from "@fenel/engine/repository-registry";
import { stdModule } from "@fenel/engine/modules/std";
import { controlModule } from "@fenel/engine/modules/control";
import { ioModule } from "@fenel/engine/modules/io";
import { ecomModule } from "@fenel/engine/modules/ecom";
import { twitterModule } from "@fenel/engine/modules/twitter";
import { socialModule } from "@fenel/engine/modules/social";
import { aiModule } from "@fenel/engine/modules/ai";
import type { Interface } from "@fenel/engine/types";

const reg = createRepositoryRegistry([stdModule, controlModule, ioModule, ecomModule, twitterModule, socialModule, aiModule]);
const capabilities = reg.listCapabilities();

export default function ServicesPage() {
  return (
    <div>
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "1.5rem" }}>
        <h2 style={{ margin: 0 }}>Services</h2>
      </div>
      <p style={{ color: "var(--text-secondary)", "margin-bottom": "1.5rem" }}>
        External capabilities available to flows. Each service is backed by an integration (credentials).
      </p>
      <div style={{ display: "grid", gap: "1rem", "grid-template-columns": "repeat(auto-fill, minmax(300px, 1fr))" }}>
        <For each={capabilities}>
          {(cap: Interface) => (
            <div style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              "border-radius": "8px",
              padding: "1.25rem",
            }}>
              <h3 style={{ margin: "0 0 0.5rem" }}>{canonical(cap.label ?? cap.name)}</h3>
              <div style={{ "font-size": "0.85rem", color: "var(--text-secondary)" }}>
                <For each={cap.methods}>
                  {(method) => (
                    <div style={{ padding: "0.25rem 0", "border-bottom": "1px solid var(--border)" }}>
                      <strong>{method.name}</strong>
                      <span style={{ "margin-left": "0.5rem", opacity: 0.7 }}>
                        ({method.params.length} params)
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <div style={{ "margin-top": "0.75rem" }}>
                <For each={reg.listProviders(cap.name)}>
                  {(provider) => (
                    <span style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      background: "var(--bg-tertiary)",
                      "border-radius": "4px",
                      "font-size": "0.75rem",
                      "margin-right": "0.4rem",
                    }}>
                      {provider.label ? canonical(provider.label) : String(provider.args[0])}
                    </span>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
