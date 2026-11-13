import { useParams, useNavigate } from "@solidjs/router";

// Slice 13-J — bespoke profile detail retired. The generic per-instance
// page at /app/types/entity:profile/<id> covers fields, all four
// declared relations (handles / phones / tags / intents) plus relationships
// with full Add/Remove, ref-resolved labels, soft-archive, avatar, and
// auxiliary tables (tagHistory / activeFlows / entitlements / purchases).
//
// Redirect kept so any persisted bookmark or hard link works.
export default function ProfileDetailRedirect() {
  const navigate = useNavigate();
  const params = useParams();
  navigate(`/app/types/entity:profile/${params.id ?? ""}`, { replace: true });
  return null;
}
