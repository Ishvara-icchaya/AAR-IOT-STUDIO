import type { Scrubber2FieldMeta } from "@/lib/scrubber2Fields";

type Props = {
  fields: Scrubber2FieldMeta[];
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  filter?: (f: Scrubber2FieldMeta) => boolean;
};

export function Scrubber2FieldPicker({ fields, value, onChange, placeholder = "Select field…", filter }: Props) {
  const list = filter ? fields.filter(filter) : fields;
  return (
    <select
      className="scrubber2-input"
      style={{ minWidth: 160 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {list.map((f) => (
        <option key={f.path} value={f.path}>
          {f.path} ({f.type})
        </option>
      ))}
    </select>
  );
}
