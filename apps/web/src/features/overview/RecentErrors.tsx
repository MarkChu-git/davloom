import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Popover } from "@astryxdesign/core/Popover";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { useTooltip } from "@astryxdesign/core/Tooltip";
import { ChartScatter, LayoutGrid, List as ListIcon, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { OperationError } from "../api/queries";
import { FileName } from "../files/FileName";
import { formatRelative } from "../shell/format";
import { ExpandableRows } from "../shell/ExpandableList";
import { ErrorTimeline } from "./charts";
import { Age, CauseMark, ErrorDetails, ErrorSubject } from "./ErrorParts";
import { causeOf, kindOf, nameOf } from "./errors";
import { isErrorView, setErrorView, useErrorView, type ErrorView } from "./errorView";

interface ViewChoice {
  view: ErrorView;
  label: string;
  icon: LucideIcon;
}

const VIEWS: readonly ViewChoice[] = [
  { view: "list", label: "List", icon: ListIcon },
  { view: "timeline", label: "Timeline", icon: ChartScatter },
  { view: "tiles", label: "Tiles", icon: LayoutGrid },
];

/**
 * One choice of view: a picture named by its view, with the same word in a tooltip. SegmentedControl
 * has no tooltip of its own, so the choice takes Astryx's tooltip hook as Astryx Button does, and as
 * Button does it leaves the tooltip out of the choice's description: a tooltip that repeats the
 * name would have a screen reader read the word twice.
 */
const ViewChoiceItem = ({ choice }: { choice: ViewChoice }) => {
  const { ref: tooltipRef, renderTooltip } = useTooltip({ placement: "above" });
  return (
    <>
      <SegmentedControlItem
        ref={tooltipRef}
        value={choice.view}
        label={choice.label}
        icon={<Icon icon={choice.icon} size="sm" />}
        isLabelHidden
      />
      {renderTooltip(choice.label)}
    </>
  );
};

/** The choice of view beside the panel's title: three pictures, each named in a tooltip. */
export const ErrorViewSwitch = () => {
  const view = useErrorView();
  return (
    <SegmentedControl
      label="Show errors as"
      size="sm"
      value={view}
      onChange={(next) => {
        if (isErrorView(next)) {
          setErrorView(next);
        }
      }}
    >
      {VIEWS.map((choice) => (
        <ViewChoiceItem key={choice.view} choice={choice} />
      ))}
    </SegmentedControl>
  );
};

/** One line per error, its cause as a picture, opened in place like the rows of keys. */
const ErrorList = ({ errors }: { errors: readonly OperationError[] }) => (
  <ExpandableRows
    edge="outset"
    records={errors.map((error) => {
      const name = nameOf(error);
      return {
        id: error.id,
        icon: <CauseMark cause={causeOf(error)} />,
        // The cause leads the line, so the name leaves out the picture of its kind.
        title: <FileName name={name} kind={kindOf(error)} weight="semibold" hasIcon={false} />,
        meta: <Age at={error.at} />,
        details: <ErrorDetails error={error} />,
        toggleLabel: `Details for ${name}`,
      };
    })}
  />
);

/** A tile with an error's cause large, its age and its file; a tap shows its details beside it. */
const ErrorTile = ({ error }: { error: OperationError }) => {
  const [isOpen, setIsOpen] = useState(false);
  // The tile anchors its details once it is drawn.
  const [tile, setTile] = useState<HTMLElement | null>(null);
  const anchor = useMemo(() => (tile === null ? null : { current: tile }), [tile]);
  const cause = causeOf(error);
  const name = nameOf(error);
  return (
    <VStack ref={setTile}>
      <ClickableCard
        label={`${name}, ${cause.label}, ${formatRelative(error.at)}`}
        onClick={() => {
          // A tap or click on the tile's face reaches the card rather than its button, so focus
          // would stay where it was, and the details would give it back there when they close.
          // Focusing the tile's own button first sends it back to the tile, as Enter does.
          tile?.querySelector("button")?.focus({ preventScroll: true });
          setIsOpen(true);
        }}
        padding={3}
        variant="muted"
      >
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" hAlign="between">
            <CauseMark cause={cause} isLarge />
            <Age at={error.at} />
          </HStack>
          <FileName name={name} kind={kindOf(error)} />
        </VStack>
      </ClickableCard>
      {anchor === null ? null : (
        <Popover
          anchorRef={anchor}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          label={name}
          width="20rem"
          content={
            // The details can open away from their tile, so they start with its name.
            <VStack gap={3}>
              <ErrorSubject error={error} />
              <ErrorDetails error={error} />
            </VStack>
          }
        />
      )}
    </VStack>
  );
};

/** Two tiles side by side on a phone, and up to four in a wide window. */
const ErrorTiles = ({ errors }: { errors: readonly OperationError[] }) => (
  <Grid columns={{ minWidth: 120, max: 4, repeat: "fit" }} gap={3}>
    {errors.map((error) => (
      <ErrorTile key={error.id} error={error} />
    ))}
  </Grid>
);

/** The recent operation errors in the view chosen beside the panel's title. */
export const RecentErrors = ({
  errors,
  readAt,
}: {
  errors: readonly OperationError[];
  /** When the errors were read, in milliseconds since the epoch. */
  readAt: number;
}) => {
  const view = useErrorView();
  if (errors.length === 0) {
    return <EmptyState title="No failed operations in the last 24 hours" />;
  }
  if (view === "timeline") {
    return <ErrorTimeline errors={errors} now={readAt} />;
  }
  if (view === "tiles") {
    return <ErrorTiles errors={errors} />;
  }
  return <ErrorList errors={errors} />;
};
