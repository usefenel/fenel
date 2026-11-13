import { useNavigate } from "@solidjs/router";

export default function ItemsRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:item", { replace: true });
  return null;
}
