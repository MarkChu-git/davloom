import { Heading } from "@astryxdesign/core/Heading";
import { Stack } from "@astryxdesign/core/Stack";
import { createFileRoute } from "@tanstack/react-router";

const DeepRoute = () => (
  <Stack padding={6}>
    <Heading level={1}>Deep route</Heading>
  </Stack>
);

export const Route = createFileRoute("/_app/design-check/deep/page")({ component: DeepRoute });
