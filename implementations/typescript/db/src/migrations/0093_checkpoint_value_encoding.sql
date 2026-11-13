ALTER TABLE function_instances ADD COLUMN variables_encoding text;
ALTER TABLE function_instances ADD COLUMN trigger_event_encoding text;
ALTER TABLE traces ADD COLUMN values_encoding text;
