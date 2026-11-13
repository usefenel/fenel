/**
 * Default embedded styles for the Fenel form widget.
 * Injected as a <style> tag when the widget initializes on an external site.
 */
export const WIDGET_CSS = `
.fenel-form-widget {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  max-width: 480px;
  margin: 0 auto;
}

.fenel-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.fenel-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.fenel-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #333;
}

.fenel-required {
  color: #c62828;
  margin-left: 2px;
}

.fenel-input,
.fenel-textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #333;
  background: #fff;
  transition: border-color 0.15s;
}

.fenel-input:focus,
.fenel-textarea:focus {
  outline: none;
  border-color: #1565c0;
  box-shadow: 0 0 0 2px rgba(21, 101, 192, 0.15);
}

.fenel-textarea {
  resize: vertical;
  min-height: 70px;
}

.fenel-checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #333;
  cursor: pointer;
}

.fenel-checkbox-label input {
  margin-top: 2px;
}

.fenel-radio-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.fenel-radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #333;
  cursor: pointer;
}

.fenel-submit {
  padding: 0.65rem 1.5rem;
  background: #1565c0;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.fenel-submit:hover {
  background: #0d47a1;
}

.fenel-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.fenel-error {
  color: #c62828;
  font-size: 0.8rem;
  padding: 0.4rem 0.6rem;
  background: #fce4ec;
  border-radius: 4px;
}

.fenel-success {
  color: #1e7e34;
  font-size: 0.9rem;
  padding: 1rem;
  background: #e6f4ea;
  border-radius: 6px;
  text-align: center;
}

.fenel-loading {
  color: #999;
  text-align: center;
  padding: 2rem;
}
`;
