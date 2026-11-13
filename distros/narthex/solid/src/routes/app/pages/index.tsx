import { useNavigate } from "@solidjs/router";

export default function PagesRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:page", { replace: true });
  return null;
}
