import { useNavigate } from "@solidjs/router";

export default function EmailTemplatesRedirect() {
  const navigate = useNavigate();
  navigate("/app/types/entity:email_template", { replace: true });
  return null;
}
