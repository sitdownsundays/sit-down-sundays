import { Input } from "@/components/ui/input";
import { FormField } from "./form-field";

interface TimeFieldProps {
  label: string;
  htmlFor: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
}

export function TimeField({
  label,
  htmlFor,
  value,
  onChange,
  error,
  hint,
  required,
}: TimeFieldProps) {
  return (
    <FormField label={label} htmlFor={htmlFor} error={error} hint={hint} required={required}>
      <Input id={htmlFor} type="time" value={value} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}
