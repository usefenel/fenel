import { useNavigate } from "@solidjs/router";

export default function ProxyLinksRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:proxy_link", { replace: true });
  return null;
}
