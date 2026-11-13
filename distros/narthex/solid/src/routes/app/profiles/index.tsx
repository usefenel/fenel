import { useNavigate } from "@solidjs/router";

export default function ProfilesRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:profile", { replace: true });
  return null;
}
