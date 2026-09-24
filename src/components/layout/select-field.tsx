import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "./form-field";

interface SelectFieldProps {
  label: string;
  htmlFor: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

export function SelectField({
  label,
  htmlFor,
  value,
  onValueChange,
  options,
  placeholder,
  error,
  hint,
  required,
}: SelectFieldProps) {
  return (
    <FormField label={label} htmlFor={htmlFor} error={error} hint={hint} required={required}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={htmlFor} className="w-full">
          <SelectValue placeholder={placeholder ?? "Select…"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
