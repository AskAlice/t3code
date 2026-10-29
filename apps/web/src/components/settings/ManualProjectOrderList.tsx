import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { cn } from "~/lib/utils";
import {
  projectGroupsSpanEnvironments,
  type SidebarProjectSnapshot,
} from "~/sidebarProjectGrouping";
import { useEnvironmentMachines, usePrimaryEnvironmentId } from "~/state/environments";
import { useUiStateStore } from "~/uiStateStore";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";

export function ManualProjectOrderList() {
  const groups = useSidebarProjectGroups();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const machineByEnvironmentId = useEnvironmentMachines();
  const showEnvironments = projectGroupsSpanEnvironments(groups);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null) return;
    const fromIndex = groups.findIndex((group) => group.projectKey === active.id);
    const toIndex = groups.findIndex((group) => group.projectKey === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    useUiStateStore.getState().reorderProjectGroups(groups, fromIndex, toIndex);
  };

  if (groups.length < 2) return null;

  return (
    <div className="mt-2 border-t border-border/50 py-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={groups.map((group) => group.projectKey)}
          strategy={verticalListSortingStrategy}
        >
          <ol aria-label="Manual project order">
            {groups.map((group, index) => (
              <SortableProjectRow key={group.projectKey} group={group} position={index + 1}>
                {showEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={machineByEnvironmentId}
                  />
                ) : null}
              </SortableProjectRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableProjectRow({
  group,
  position,
  children,
}: {
  readonly group: SidebarProjectSnapshot;
  readonly position: number;
  readonly children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.projectKey });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 py-1.5",
        isDragging && "relative z-10 rounded-md bg-background shadow-md",
      )}
    >
      <ProjectFavicon project={group} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{group.displayName}</span>
      {children}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${group.displayName}, position ${position}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
    </li>
  );
}
