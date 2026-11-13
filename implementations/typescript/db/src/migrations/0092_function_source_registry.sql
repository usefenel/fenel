-- Immutable source ownership is a physical relationship, never user JSON.
ALTER TABLE functions
  ADD COLUMN source_registry_id uuid REFERENCES registries(id);

CREATE INDEX functions_source_registry_idx ON functions(source_registry_id)
  WHERE source_registry_id IS NOT NULL;
