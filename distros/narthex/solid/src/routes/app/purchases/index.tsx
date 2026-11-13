import { useNavigate } from "@solidjs/router";

export default function PurchasesRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:purchase", { replace: true });
  return null;
}
