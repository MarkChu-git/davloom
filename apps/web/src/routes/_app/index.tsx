import { Heading } from "@astryxdesign/core/Heading";
import { Stack } from "@astryxdesign/core/Stack";
import { BrandMark } from "@davloom/ui";
import { createFileRoute } from "@tanstack/react-router";

const Home = () => (
  <Stack gap={4} padding={6}>
    <BrandMark />
    <Heading level={1}>Your storage. Your rules.</Heading>
  </Stack>
);

export const Route = createFileRoute("/_app/")({ component: Home });
