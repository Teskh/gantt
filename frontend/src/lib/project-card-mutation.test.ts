import { describe, expect, it } from "vitest";
import { readProjectCardMutation } from "./project-card-mutation";

describe("readProjectCardMutation", () => {
  it("accepts both legacy responses and responses containing a complete card", async () => {
    const legacy = await readProjectCardMutation(
      new Response(JSON.stringify({ definitionId: 4 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
      "Unable to save"
    );
    expect(legacy.definitionId).toBe(4);
    expect(legacy.card).toBeUndefined();

    const compatible = await readProjectCardMutation(
      new Response(JSON.stringify({
        definitionId: 4,
        card: {
          projectId: 10,
          baseProjectId: 2,
          statuses: [],
          availableDefinitions: [],
          activity: [],
        },
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
      "Unable to save"
    );
    expect(compatible.card?.projectId).toBe(10);
  });

  it("uses the API error without requiring a particular success contract", async () => {
    await expect(readProjectCardMutation(
      new Response(JSON.stringify({ error: "Status has changed" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
      "Unable to save"
    )).rejects.toThrow("Status has changed");
  });
});
