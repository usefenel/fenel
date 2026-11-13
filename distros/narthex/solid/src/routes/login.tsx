import { onSettled } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { localReturnPath } from "../lib/auth";

/** Old sign-in links keep their destination; Home owns the dialog. */
export default function LoginRedirect() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  onSettled(() => navigate("/", {
    replace: true,
    state: { signIn: true, next: localReturnPath(search.next ?? "/") },
  }));
  return null;
}
