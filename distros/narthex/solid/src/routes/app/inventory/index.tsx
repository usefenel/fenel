import { useNavigate } from "@solidjs/router";

export default function InventoryRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:inventory", { replace: true });
  return null;
}
