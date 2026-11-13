-- Add AI provider integration types
ALTER TYPE integration_type ADD VALUE IF NOT EXISTS 'anthropic';
ALTER TYPE integration_type ADD VALUE IF NOT EXISTS 'openai';
