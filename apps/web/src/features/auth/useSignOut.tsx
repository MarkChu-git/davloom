import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { signOut } from "../api/account";

/**
 * Signs this browser out once the person confirms (a `confirm` action, apps/api/verification.ts),
 * forgets what the Dashboard read with the session, and opens the sign-in page. Render `element`.
 */
export const useSignOut = () => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useImperativeAlertDialog();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const run = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch {
      // A session the server no longer knows is signed out already.
    }
    client.clear();
    await navigate({ to: "/sign-in" });
  };
  const ask = () =>
    confirm.show({
      title: "Sign out?",
      description: "This browser leaves the Dashboard until you sign in again.",
      actionLabel: "Sign out",
      actionVariant: "primary",
      onAction: () => {
        confirm.hide();
        void run();
      },
    });
  return { isSigningOut, signOut: ask, element: confirm.element };
};
