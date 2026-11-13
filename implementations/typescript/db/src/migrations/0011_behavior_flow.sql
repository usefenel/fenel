-- Add behavior_flow column to form_definitions
-- Links a form to a flow that defines behavioral rules (visibility, validation, computed values)
ALTER TABLE form_definitions ADD COLUMN IF NOT EXISTS behavior_flow TEXT;
