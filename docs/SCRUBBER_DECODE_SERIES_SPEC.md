# Scrubber — generic **Decode Series** step (locked spec)

**Status:** specification locked for implementation. **No Base64-only scrubber primitive** — Base64 is one **mode** of this generic step.

**Final spec line:** The Scrubber shall support a generic **Decode Series** step that normalizes scalar, array, CSV, Base64 binary, and hex binary telemetry into a standard numeric series output with metadata and aggregations. Base64 is only one mode of this generic step, not a dedicated scrubber primitive.

---

## Step identity

| Field | Value |
|--------|--------|
| `step_type` | `decode_series` |

### Where this lives in `scrubberStudio`

Under **`scrubberStudio.draft`** (or **`publishedBody`** when frozen), add an optional array:

| Key | Type | Description |
|-----|------|-------------|
| `decodeSeriesSteps` | `object[]` | Ordered list of step configs. Each object with `step_type: "decode_series"` is executed after **Derived Fields** (`scalarFields`) and before **Function Based** (`functionBased`). |

Field names may be **snake_case** (spec) or **camelCase** (`sourcePath`, `dataType`, …); the engine accepts both.

---

## v1 supported modes

| `mode` | Behavior (summary) |
|--------|---------------------|
| `scalar` | Single value → one-sample series |
| `array` | JSON array → numeric series |
| `base64_binary` | Base64 decode → unpack typed binary → numeric series |
| `csv_numbers` | Split by comma → trim → parse numbers |
| `hex_binary` | Hex decode → unpack typed binary → numeric series |

---

## v1 supported binary `data_type` values

For `base64_binary` and `hex_binary` (and any future packed-binary modes):

- `int16`
- `int32`
- `float32`

**Deferred:** `float64` (optional later).

For `scalar` and `array`, `data_type` drives numeric parsing (e.g. `float`).

---

## Core config (reference)

```json
{
  "step_type": "decode_series",
  "source_path": "$.body.pack.current",
  "target_path": "$.decoded.pack.current",
  "mode": "base64_binary",
  "encoding": "base64",
  "data_type": "int32",
  "byte_order": "little",
  "scale": 1,
  "offset": 0,
  "unit": "mA",
  "sample_rate_hz": null,
  "store_samples": true,
  "max_samples_to_store": 1000,
  "aggregations": ["avg", "min", "max", "latest", "count"]
}
```

**Native array example:**

```json
{
  "step_type": "decode_series",
  "source_path": "$.body.current_samples",
  "target_path": "$.decoded.current",
  "mode": "array",
  "data_type": "float",
  "unit": "A",
  "scale": 1000,
  "aggregations": ["avg", "min", "max", "latest", "count"]
}
```

---

## Standard output shape

Always emit the same top-level structure: `samples`, `meta`, `aggregations`.

### `store_samples: true` (after truncation by `max_samples_to_store`)

```json
{
  "samples": [-376, -413, -407],
  "meta": {
    "unit": "mA",
    "data_type": "int32",
    "sample_rate_hz": null,
    "source_mode": "base64_binary"
  },
  "aggregations": {
    "count": 3,
    "min": -413,
    "max": -376,
    "avg": -398.6667,
    "latest": -407
  }
}
```

### `store_samples: false`

Aggregations reflect the **full** decoded series (before optional drop of stored samples). `samples` is always present as an array (empty when not stored).

```json
{
  "samples": [],
  "meta": {
    "sample_count": 3,
    "samples_stored": false,
    "unit": "mA"
  },
  "aggregations": {
    "count": 3,
    "min": -413,
    "max": -376,
    "avg": -398.6667,
    "latest": -407
  }
}
```

`meta` should consistently include provenance such as `source_mode` and resolved `data_type` where applicable; when samples are not stored, include `sample_count` and `samples_stored: false`.

---

## Processing order (normative)

1. Read `source_path`.
2. Decode based on `mode`.
3. Convert to a homogeneous numeric series (per `data_type`).
4. Apply `scale` (default `1`).
5. Apply `offset` (default `0`).
6. Enforce security / size limits (`max_decoded_bytes`, `max_samples`, `max_csv_length`, `max_hex_length`, `max_processing_ms`). If decoded sample count exceeds `max_samples`, fail with `MAX_SAMPLES_EXCEEDED`.
7. Calculate **aggregations** on the **full** numeric series from step 3 after scale/offset (steps 4–5).
8. Build `samples`: if `store_samples` is `false`, use `[]` and set `meta.sample_count` / `meta.samples_stored: false`. If `store_samples` is `true`, populate with up to `max_samples_to_store` elements from the **trailing** end of that same series (**v1**), so the stored tail aligns with `latest`.
9. Assemble `meta` (include `source_mode`, `data_type`, `unit`, `sample_rate_hz`, etc.).
10. Write `{ "samples", "meta", "aggregations" }` to `target_path`.

---

## Mode-specific rules

### `scalar`

```json
{ "mode": "scalar", "data_type": "float" }
```

Single JSON value → one-sample series.

### `array`

```json
{ "mode": "array", "data_type": "float" }
```

JSON array → numeric series (each element parsed per `data_type`).

### `base64_binary`

```json
{
  "mode": "base64_binary",
  "encoding": "base64",
  "data_type": "int16",
  "byte_order": "little"
}
```

Base64 decode → unpack typed binary → numeric series. `byte_order` required.

### `csv_numbers`

```json
{ "mode": "csv_numbers", "data_type": "float" }
```

Split on comma → trim → parse each token as number; invalid token → structured error.

### `hex_binary`

```json
{
  "mode": "hex_binary",
  "data_type": "int32",
  "byte_order": "little"
}
```

Hex string decode → unpack typed binary → numeric series. `byte_order` required.

---

## v1 validation rules

| Rule | Detail |
|------|--------|
| `source_path` | Required |
| `target_path` | Required |
| `mode` | Required; must be one of v1 modes |
| `data_type` | Required |
| `byte_order` | Required for `base64_binary` and `hex_binary` |
| `scale` | Default `1` |
| `offset` | Default `0` |
| `store_samples` | Default `true` |
| `max_samples_to_store` | Default `1000` |
| `aggregations` | Default `["latest", "count"]` |
| `encoding` | Required when mode implies encoding (e.g. `base64` for `base64_binary`) |

---

## Structured step errors

Errors returned from the scrubber runtime should be structured and include identifying fields, for example:

```json
{
  "step_type": "decode_series",
  "source_path": "$.body.pack.current",
  "error_code": "INVALID_BASE64",
  "message": "Unable to decode base64 series field."
}
```

### Error codes (v1)

| Code | When |
|------|------|
| `SOURCE_PATH_MISSING` | Path resolves to no value where a value is required |
| `UNSUPPORTED_MODE` | `mode` not in v1 set |
| `UNSUPPORTED_DATA_TYPE` | `data_type` not supported for this `mode` |
| `INVALID_BASE64` | Base64 decode failure |
| `INVALID_HEX` | Hex decode failure (odd length, non-hex, etc.) |
| `INVALID_CSV_TOKEN` | CSV token not parseable as number |
| `BINARY_LENGTH_MISMATCH` | Byte length not a multiple of type width |
| `MAX_SAMPLES_EXCEEDED` | Decoded sample count exceeds security `max_samples` |
| `MAX_PROCESSING_TIME` | Step exceeded `SCRUBBER_DECODE_SERIES_MAX_PROCESSING_MS` (default 50 ms) |
| `NON_NUMERIC_VALUE` | Scalar/array element cannot be coerced to numeric |

---

## Security / performance limits

Implement hard limits with documented defaults:

| Limit | Recommended default |
|--------|---------------------|
| `max_decoded_bytes` | 1 MB (binary after base64/hex decode) |
| `max_samples` | 10,000 (count of numeric samples after decode) |
| `max_samples_to_store` | 1,000 (config default; may be overridden per step) |
| `max_csv_length` | Reasonable cap tied to payload policy (document in implementation) |
| `max_hex_length` | Same |
| `max_processing_ms` | 50 ms per step (soft target / watchdog; document behavior: fail vs truncate) |

---

## Scrubber → to be supported modes (deferred)

Do **not** implement in v1; reserve for later versions under the same `step_type: decode_series` (or documented extension):

- `object_array` — e.g. `[{ "t", "v" }, …]` with explicit field paths per element
- `timestamp_value_pair` — parallel `timestamps` + `values` object shape
- `gzip_base64_binary` — e.g. `base64(gzip(typed buffer))`
- **Protobuf / packed binary with schema** — schema-driven unpack

---

## Implementation notes (non-normative)

- Prefer **explicit** `mode` and `data_type` over auto-detection in v1.
- Keep a single code path: **decode → typed array → scale/offset → aggregate → emit**.
- Publish JSON Schema (or equivalent) for step config validated at save time and optionally at runtime.

---

## Related docs

- [SCRUBBER_DATA_OBJECTS_VIEW.md](./SCRUBBER_DATA_OBJECTS_VIEW.md) — data object / view context (if applicable to downstream consumers).
- [ROADMAP.md](./ROADMAP.md) — backlog pointer for scrubber UI and engine work.
