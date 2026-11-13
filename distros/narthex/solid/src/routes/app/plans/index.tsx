import { useNavigate } from "@solidjs/router";

export default function PlansRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:plan", { replace: true });
  return null;
}
