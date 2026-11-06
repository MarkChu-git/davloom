import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Heading } from "@astryxdesign/core/Heading";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { BrandMark } from "@davloom/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppearanceSwitch } from "../../../features/appearance/AppearanceSwitch";

/** Puts design system components beside Davloom's own, for the compatibility tests to inspect. */
const DesignCheck = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [lastAction, setLastAction] = useState("None");

  return (
    <Stack gap={6} padding={6}>
      <Heading level={1}>Design check</Heading>
      <BrandMark />
      <AppearanceSwitch />
      <Button label="Primary action" variant="primary" />
      <Button label="Open dialog" onClick={() => setIsDialogOpen(true)} />
      <Dialog isOpen={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogHeader title="Design check dialog" />
      </Dialog>
      <DropdownMenu
        button={{ label: "Actions" }}
        items={[
          { label: "Rename", onClick: () => setLastAction("Rename") },
          { label: "Delete", onClick: () => setLastAction("Delete") },
        ]}
      />
      <Text data-testid="last-action">{lastAction}</Text>
    </Stack>
  );
};

export const Route = createFileRoute("/_app/design-check/")({ component: DesignCheck });
