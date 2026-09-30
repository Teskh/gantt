import { describe, expect, it } from "vitest";
import { moveTargetIndex } from "./project-order";

const projects = [
  { id: 1, displayOrder: 0 },
  { id: 2, displayOrder: 1 },
  { id: 3, displayOrder: 2 },
  { id: 4, displayOrder: 3 },
];

describe("moveTargetIndex", () => {
  it("moves a row down between two other rows", () => {
    // Rows without the dragged one: [2, 3, 4]; slot 2 is between 3 and 4.
    expect(moveTargetIndex(projects, [1, 2, 3, 4], 1, 2)).toBe(2);
  });

  it("moves a row to the top and to the bottom", () => {
    expect(moveTargetIndex(projects, [1, 2, 3, 4], 4, 0)).toBe(0);
    expect(moveTargetIndex(projects, [1, 2, 3, 4], 1, 3)).toBe(3);
  });

  it("returns null when the drop leaves the row where it was", () => {
    expect(moveTargetIndex(projects, [1, 2, 3, 4], 2, 1)).toBeNull();
  });

  it("keeps hidden projects anchored to the rows around them", () => {
    // Project 3 is not rendered; dropping 1 after row 2 lands before 3.
    expect(moveTargetIndex(projects, [1, 2, 4], 1, 1)).toBe(1);
    // Dropping 1 at the end lands after 4, past hidden project 3.
    expect(moveTargetIndex(projects, [1, 2, 4], 1, 2)).toBe(3);
  });

  it("breaks display-order ties by id like the server does", () => {
    const tied = projects.map((project) => ({ ...project, displayOrder: 0 }));
    expect(moveTargetIndex(tied, [1, 2, 3, 4], 4, 1)).toBe(1);
  });
});
