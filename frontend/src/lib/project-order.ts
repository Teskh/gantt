export interface OrderedProject {
  id: number;
  displayOrder: number;
}

// Same order the server uses: display_order, then id.
export const compareProjectOrder = (a: OrderedProject, b: OrderedProject) =>
  a.displayOrder - b.displayOrder || a.id - b.id;

/**
 * Converts a drop slot in the rendered rows into the target index the server's
 * move-to endpoint expects. `visibleIds` are the rendered rows in order and `slot`
 * is the gap (0..visibleIds.length) the dragged row was dropped into; projects that
 * are not rendered stay below the row they followed.
 */
export const moveTargetIndex = (
  allProjects: OrderedProject[],
  visibleIds: number[],
  movingId: number,
  slot: number
): number | null => {
  const ordered = [...allProjects].sort(compareProjectOrder).map((project) => project.id);
  const currentIndex = ordered.indexOf(movingId);
  if (currentIndex < 0) return null;
  const withoutMoving = ordered.filter((id) => id !== movingId);
  const visibleWithoutMoving = visibleIds.filter((id) => id !== movingId);

  const clampedSlot = Math.max(0, Math.min(visibleWithoutMoving.length, slot));
  // Land right after the row above the slot (or before the first row).
  const target = visibleWithoutMoving.length === 0
    ? currentIndex
    : clampedSlot === 0
      ? withoutMoving.indexOf(visibleWithoutMoving[0])
      : withoutMoving.indexOf(visibleWithoutMoving[clampedSlot - 1]) + 1;
  return target === currentIndex ? null : target;
};
