import { createFileRoute } from "@tanstack/react-router";
import { FileExplorerPage } from "../../../features/files/FileExplorerPage";
import { normalizePath } from "../../../features/files/paths";

interface FilesSearch {
  path?: string;
  file?: string;
}

const FilesRoute = () => {
  const { path = "/", file } = Route.useSearch();
  // A new folder starts with a fresh search, selection and loading state.
  return <FileExplorerPage key={path} path={path} selectedName={file} />;
};

export const Route = createFileRoute("/_app/_dashboard/files")({
  // The router keeps every search value as text (router.tsx).
  validateSearch: (search: Record<string, unknown>): FilesSearch => ({
    path: typeof search.path === "string" ? normalizePath(search.path) : undefined,
    file: typeof search.file === "string" && search.file !== "" ? search.file : undefined,
  }),
  head: () => ({ meta: [{ title: "Files | Davloom" }] }),
  component: FilesRoute,
});
