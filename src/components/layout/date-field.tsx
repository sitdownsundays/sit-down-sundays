import { Input } from "@/components/ui/input";
import { FormField } from "./form-field";

interface DateFieldProps {
  label: string;
  htmlFor: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
}

export function DateField({
  label,
  htmlFor,
  value,
  onChange,
  error,
  hint,
  required,
}: DateFieldProps) {
  return (
    <FormField label={label} htmlFor={htmlFor} error={error} hint={hint} required={required}>
      <Input id={htmlFor} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}
